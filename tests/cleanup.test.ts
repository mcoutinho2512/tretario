/** Rodada 8.1 — CleanupService (memória): só apaga o vencido, idempotente, sem sobreposição, métricas e log sem segredos. */
import { describe, it, expect } from 'vitest';
import { MemoryDataStore } from '../server/src/data/memory';
import type { DataStore } from '../server/src/data/types';
import { CleanupService, cleanupConfigFromEnv, formatCleanupLine } from '../server/src/cleanup/CleanupService';
import { TicketService } from '../server/src/identity/tickets';
import { Backoff, Window } from '../server/src/auth/rateLimit';
import { SessionService, SESSION_COOKIE, sha256 } from '../server/src/auth/session';
import { requireUser } from '../server/src/http/session';

const MIN = 60_000, NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const cfg = { intervalMs: 0, firstDelayMs: 0, sessionGraceMs: 60 * MIN, codeGraceMs: 60 * MIN, batch: 500, maxRunMs: 30_000 };

/** 100 válidos + 100 vencidos (fora da carência) + casos na/fora da carência; devolve o que DEVE sumir */
async function seed(store: DataStore, tag = 'u') {
  const u = await store.users.create({ email: `${tag}@exemplo.test`, passwordHash: 'scrypt$x' });
  const keep = new Set<string>(), gone = new Set<string>(), keepC = new Set<string>(), goneC = new Set<string>();
  for (let i = 0; i < 100; i++) {
    keep.add((await store.sessions.create({ userId: u.id, tokenHash: `${tag}v${i}`, expiresAt: new Date(NOW + 30 * 24 * 60 * MIN), uaHash: null })).id);
    gone.add((await store.sessions.create({ userId: u.id, tokenHash: `${tag}x${i}`, expiresAt: new Date(NOW - 2 * 60 * MIN - i * MIN), uaHash: null })).id);
    keepC.add((await store.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: `${tag}cv${i}`, expiresAt: new Date(NOW + 10 * MIN) })).id);
    goneC.add((await store.codes.create({ userId: u.id, purpose: 'PASSWORD_RESET', codeHash: `${tag}cx${i}`, expiresAt: new Date(NOW - 2 * 60 * MIN - i * MIN) })).id);
  }
  // vencida há 10 min (DENTRO da carência de 60): fica
  keep.add((await store.sessions.create({ userId: u.id, tokenHash: `${tag}g1`, expiresAt: new Date(NOW - 10 * MIN), uaHash: null })).id);
  // revogada há 2 h (fora da carência): some; revogada agora: fica
  const r1 = await store.sessions.create({ userId: u.id, tokenHash: `${tag}r1`, expiresAt: new Date(NOW + 60 * MIN), uaHash: null });
  const r2 = await store.sessions.create({ userId: u.id, tokenHash: `${tag}r2`, expiresAt: new Date(NOW + 60 * MIN), uaHash: null });
  await store.sessions.revoke(r1.id); await store.sessions.revoke(r2.id);
  setRevoked(store, r1.id, new Date(NOW - 2 * 60 * MIN)); setRevoked(store, r2.id, new Date(NOW - MIN));
  gone.add(r1.id); keep.add(r2.id);
  // código usado há 2 h: some; usado há 5 min: fica
  const c1 = await store.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: `${tag}u1`, expiresAt: new Date(NOW + 10 * MIN) });
  const c2 = await store.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: `${tag}u2`, expiresAt: new Date(NOW + 10 * MIN) });
  setConsumed(store, c1.id, new Date(NOW - 2 * 60 * MIN)); setConsumed(store, c2.id, new Date(NOW - 5 * MIN));
  goneC.add(c1.id); keepC.add(c2.id);
  return { keep, gone, keepC, goneC };
}
// acesso direto aos mapas do MemoryDataStore (o contrato público grava "agora" do relógio real)
const mem = (s: DataStore) => s as unknown as { s: Map<string, { revokedAt: Date | null }>; c: Map<string, { consumedAt: Date | null }> };
const setRevoked = (s: DataStore, id: string, at: Date) => { mem(s).s.get(id)!.revokedAt = at; };
const setConsumed = (s: DataStore, id: string, at: Date) => { mem(s).c.get(id)!.consumedAt = at; };

describe('CleanupService — memória', () => {
  it('100 válidos + 100 vencidos: 1ª passada apaga exatamente os vencidos, 2ª apaga 0, válidos intactos', async () => {
    const store = new MemoryDataStore();
    const { keep, gone, keepC, goneC } = await seed(store);
    const lines: string[] = [];
    const c = new CleanupService(store, { config: { ...cfg, batch: 37 }, now: () => NOW, log: (l) => lines.push(l) });
    const m1 = await c.run();
    expect(m1.expiredSessionsDeleted).toBe(gone.size);
    expect(m1.expiredOtpDeleted).toBe(goneC.size);
    expect(m1.error).toBeUndefined();
    expect([...mem(store).s.keys()].sort()).toEqual([...keep].sort());
    expect([...mem(store).c.keys()].sort()).toEqual([...keepC].sort());
    const m2 = await c.run();
    expect(m2.expiredSessionsDeleted + m2.expiredOtpDeleted).toBe(0);
    expect(c.totals).toMatchObject({ runs: 2, errors: 0, expiredSessionsDeleted: gone.size, expiredOtpDeleted: goneC.size });
    expect(lines).toHaveLength(2);
  });

  it('carência de código nunca menor que a validade do código (15 min)', async () => {
    const store = new MemoryDataStore();
    const u = await store.users.create({ email: 'g@exemplo.test', passwordHash: 'x' });
    const c1 = await store.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: 'h', expiresAt: new Date(NOW + 10 * MIN) });
    setConsumed(store, c1.id, new Date(NOW - 5 * MIN));
    const m = await new CleanupService(store, { config: { ...cfg, codeGraceMs: 0 }, now: () => NOW, log: () => {} }).run();
    expect(m.expiredOtpDeleted).toBe(0);
  });

  it('duas passadas concorrentes (mesma instância e duas instâncias): total = esperado, sem erros', async () => {
    const store = new MemoryDataStore();
    const { gone, goneC } = await seed(store);
    const a = new CleanupService(store, { config: { ...cfg, batch: 23 }, now: () => NOW, log: () => {} });
    const b = new CleanupService(store, { config: { ...cfg, batch: 23 }, now: () => NOW, log: () => {} });
    const [x, y, z] = await Promise.all([a.run(), a.run(), b.run()]);
    expect(x).toBe(y); // em voo: a segunda chamada recebe a mesma execução
    expect(x.expiredSessionsDeleted + z.expiredSessionsDeleted).toBe(gone.size);
    expect(x.expiredOtpDeleted + z.expiredOtpDeleted).toBe(goneC.size);
    expect(x.error ?? z.error).toBeUndefined();
    expect(a.totals.runs).toBe(1);
  });

  it('tickets e limites em memória: só os vencidos/esquecidos saem', async () => {
    const tickets = new TicketService();
    for (let i = 0; i < 50; i++) tickets.issue({ userId: `u${i}`, authSessionId: `s${i}`, role: 'player' }, NOW - 5 * MIN);
    const live = tickets.issue({ userId: 'v', authSessionId: 'sv', role: 'player' }, NOW);
    const bo = new Backoff({ free: 1, baseMs: 1000, maxMs: 60_000, forgetMs: 60 * MIN });
    bo.fail('velho', NOW - 2 * 60 * MIN); bo.fail('novo', NOW - 100); bo.fail('novo', NOW - 100);
    const w = new Window({ max: 3, windowMs: 10 * MIN });
    w.hit('velho', NOW - 20 * MIN); w.hit('novo', NOW - MIN);
    const c = new CleanupService(new MemoryDataStore(), {
      config: cfg, now: () => NOW, log: () => {},
      sweepers: [{ kind: 'tickets', sweep: (n) => tickets.sweep(n) }, { kind: 'rateLimit', sweep: (n) => bo.sweep(n) + w.sweep(n) }],
    });
    const m = await c.run();
    expect(m.expiredTicketsDeleted).toBe(50);
    expect(m.rateLimitKeysDeleted).toBe(2);
    expect(tickets.size).toBe(1);
    expect(tickets.consume(live, NOW)).toMatchObject({ userId: 'v' });
    expect(bo.size).toBe(1); expect(bo.wait('novo', NOW)).toBeGreaterThan(0);
    expect(w.size).toBe(1);
    expect((await c.run()).expiredTicketsDeleted).toBe(0);
  });

  it('métricas completas e linha de log sem token, hash, código ou e-mail', async () => {
    const store = new MemoryDataStore();
    const email = 'segredo.pessoa@exemplo.test';
    const u = await store.users.create({ email, passwordHash: 'scrypt$senha' });
    const sess = new SessionService(store, () => NOW - 40 * 24 * 60 * MIN);
    const { token, session } = await sess.create(u.id, 'UA');
    await store.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: 'abcdef0123456789hashdocodigo', expiresAt: new Date(NOW - 3 * 60 * MIN) });
    const lines: string[] = [];
    const m = await new CleanupService(store, { config: cfg, now: () => NOW, log: (l) => lines.push(l) }).run();
    expect(Object.keys(m).sort()).toEqual(['batches', 'durationMs', 'expiredOtpDeleted', 'expiredSessionsDeleted', 'expiredTicketsDeleted', 'rateLimitKeysDeleted', 'startedAt', 'truncated'].sort());
    expect(m).toMatchObject({ expiredSessionsDeleted: 1, expiredOtpDeleted: 1, truncated: false });
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line).toMatch(/^\[cleanup\] sessões −1 · códigos −1 /);
    for (const secret of [token, sha256(token), session.tokenHash, 'abcdef0123456789hashdocodigo', email, 'exemplo.test', u.id, session.id, 'scrypt']) expect(line).not.toContain(secret);
    expect(formatCleanupLine({ ...m, error: 'x' })).toContain('ERRO: x');
  });

  it('erro do banco não derruba: métricas com erro, próxima passada segue', async () => {
    const store = new MemoryDataStore();
    let fail = true;
    const orig = store.sessions.deleteExpired;
    store.sessions.deleteExpired = async (...a) => { if (fail) throw new Error('banco fora'); return orig(...a); };
    const c = new CleanupService(store, { config: cfg, now: () => NOW, log: () => {} });
    expect((await c.run()).error).toBe('banco fora');
    fail = false;
    expect((await c.run()).error).toBeUndefined();
    expect(c.totals).toMatchObject({ runs: 2, errors: 1 });
  });

  it('start() não bloqueia, roda depois do atraso e stop() cancela', async () => {
    const store = new MemoryDataStore();
    let n = 0;
    const c = new CleanupService(store, { config: { ...cfg, intervalMs: 60_000, firstDelayMs: 10 }, log: () => { n++; } });
    c.start();
    expect(n).toBe(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(n).toBe(1);
    c.stop();
    const off = new CleanupService(store, { config: { ...cfg, intervalMs: 0, firstDelayMs: 1 }, log: () => { n++; } }).start();
    await new Promise((r) => setTimeout(r, 20));
    expect(n).toBe(1);
    off.stop();
  });

  it('variáveis de ambiente', () => {
    expect(cleanupConfigFromEnv({})).toMatchObject({ intervalMs: 10 * MIN, sessionGraceMs: 60 * MIN, codeGraceMs: 60 * MIN, batch: 500 });
    expect(cleanupConfigFromEnv({ CLEANUP_INTERVAL_MINUTES: '0', CLEANUP_BATCH: '50', CLEANUP_SESSION_GRACE_MINUTES: '5', CLEANUP_CODE_GRACE_MINUTES: 'x' }))
      .toMatchObject({ intervalMs: 0, batch: 50, sessionGraceMs: 5 * MIN, codeGraceMs: 60 * MIN });
    expect(cleanupConfigFromEnv({ CLEANUP_BATCH: '0' }).batch).toBe(500);
  });

  it('sessão apagada pela limpeza = sessão vencida para a autenticação (null, sem exceção)', async () => {
    const store = new MemoryDataStore();
    const u = await store.users.create({ email: 'r@exemplo.test', passwordHash: 'x' });
    const old = new SessionService(store, () => NOW - 31 * 24 * 60 * MIN - 2 * 60 * MIN);
    const { token } = await old.create(u.id);
    const cur = new SessionService(store, () => NOW);
    const cookies = { [SESSION_COOKIE]: token };
    expect(await cur.resolve(cookies)).toBeNull(); // vencida, ainda no banco
    expect(await requireUser({ cookies }, store, new Date(NOW))).toBeNull();
    expect((await new CleanupService(store, { config: cfg, now: () => NOW, log: () => {} }).run()).expiredSessionsDeleted).toBe(1);
    expect(await store.sessions.byTokenHash(sha256(token))).toBeNull();
    expect(await cur.resolve(cookies)).toBeNull(); // apagada: mesmo resultado
    expect(await requireUser({ cookies }, store, new Date(NOW))).toBeNull();
  });
});
