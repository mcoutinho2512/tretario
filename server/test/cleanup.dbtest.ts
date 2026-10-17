/**
 * Rodada 8.1 — CleanupService contra PostgreSQL REAL (npm run test:db): 100 válidos + 100 vencidos, duas passadas,
 * duas instâncias (dois PrismaDataStore = dois "servidores") concorrentes, e o plano de consulta usa os índices.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createPrismaStore, parseDatabaseUrl, type PrismaDataStore } from '../src/data/prisma';
import { CleanupService } from '../src/cleanup/CleanupService';

const URL_ = process.env.DATABASE_URL ?? '';
const MIN = 60_000, NOW = Date.now();
const cfg = { intervalMs: 0, firstDelayMs: 0, sessionGraceMs: 60 * MIN, codeGraceMs: 60 * MIN, batch: 500, maxRunMs: 30_000 };
const open: PrismaDataStore[] = [];
const mk = async () => { const s = await createPrismaStore(URL_) as PrismaDataStore; open.push(s); return s; };
afterAll(async () => { for (const s of open) await s.close(); });

/** zera as tabelas efêmeras e semeia 100 válidos + 100 vencidos (+ revogadas/usadas dentro e fora da carência) */
async function seed(db: PrismaDataStore['db'], tag: string) {
  await db.session.deleteMany({}); await db.verificationCode.deleteMany({});
  const u = await db.user.create({ data: { email: `cleanup-${tag}-${NOW}@exemplo.test`, passwordHash: 'scrypt$x' } });
  const d = (ms: number) => new Date(NOW + ms);
  const S = [], C = [];
  for (let i = 0; i < 100; i++) {
    S.push({ userId: u.id, tokenHash: `${tag}v${i}`, expiresAt: d(30 * 24 * 60 * MIN) });
    S.push({ userId: u.id, tokenHash: `${tag}x${i}`, expiresAt: d(-2 * 60 * MIN - i * MIN) });
    C.push({ userId: u.id, purpose: 'EMAIL_VERIFY' as const, codeHash: `${tag}cv${i}`, expiresAt: d(10 * MIN) });
    C.push({ userId: u.id, purpose: 'PASSWORD_RESET' as const, codeHash: `${tag}cx${i}`, expiresAt: d(-2 * 60 * MIN - i * MIN) });
  }
  S.push({ userId: u.id, tokenHash: `${tag}g`, expiresAt: d(-10 * MIN) }); // na carência: fica
  S.push({ userId: u.id, tokenHash: `${tag}r1`, expiresAt: d(60 * MIN), revokedAt: d(-2 * 60 * MIN) }); // some
  S.push({ userId: u.id, tokenHash: `${tag}r2`, expiresAt: d(60 * MIN), revokedAt: d(-MIN) }); // fica
  C.push({ userId: u.id, purpose: 'EMAIL_VERIFY' as const, codeHash: `${tag}u1`, expiresAt: d(10 * MIN), consumedAt: d(-2 * 60 * MIN) }); // some
  C.push({ userId: u.id, purpose: 'EMAIL_VERIFY' as const, codeHash: `${tag}u2`, expiresAt: d(10 * MIN), consumedAt: d(-5 * MIN) }); // fica
  await db.session.createMany({ data: S }); await db.verificationCode.createMany({ data: C });
  return { sessionsGone: 101, sessionsKept: 102, codesGone: 101, codesKept: 101 };
}

describe('CleanupService — PostgreSQL', () => {
  it('100 válidos + 100 vencidos: 1ª passada apaga só os vencidos, 2ª apaga 0', async () => {
    const store = await mk();
    const exp = await seed(store.db, 'a');
    const c = new CleanupService(store, { config: { ...cfg, batch: 40 }, now: () => NOW, log: () => {} });
    const m1 = await c.run();
    expect(m1.error).toBeUndefined();
    expect(m1.expiredSessionsDeleted).toBe(exp.sessionsGone);
    expect(m1.expiredOtpDeleted).toBe(exp.codesGone);
    expect(await store.db.session.count()).toBe(exp.sessionsKept);
    expect(await store.db.verificationCode.count()).toBe(exp.codesKept);
    expect(await store.db.session.count({ where: { tokenHash: { startsWith: 'av' } } })).toBe(100);
    const m2 = await c.run();
    expect(m2.expiredSessionsDeleted + m2.expiredOtpDeleted).toBe(0);
    expect(await store.db.session.count()).toBe(exp.sessionsKept);
  });

  it('duas instâncias (dois PrismaDataStore) concorrentes: total = esperado, sem erros', async () => {
    const a = await mk(), b = await mk();
    const exp = await seed(a.db, 'b');
    const ca = new CleanupService(a, { config: { ...cfg, batch: 25 }, now: () => NOW, log: () => {} });
    const cb = new CleanupService(b, { config: { ...cfg, batch: 25 }, now: () => NOW, log: () => {} });
    const [x, y] = await Promise.all([ca.run(), cb.run()]);
    expect(x.error ?? y.error).toBeUndefined();
    expect(x.expiredSessionsDeleted + y.expiredSessionsDeleted).toBe(exp.sessionsGone);
    expect(x.expiredOtpDeleted + y.expiredOtpDeleted).toBe(exp.codesGone);
    expect(await a.db.session.count()).toBe(exp.sessionsKept);
    expect(await a.db.verificationCode.count()).toBe(exp.codesKept);
  });

  it('plano de consulta da limpeza usa os índices de expiresAt (e revokedAt/consumedAt)', async () => {
    const store = await mk();
    const plan = async (table: string, other: string) => {
      const rows = await store.db.$transaction(async (tx) => {
        // tabela pequena: desliga a varredura sequencial para o planejador mostrar se o índice SERVE. Colunas são
        // timestamp SEM fuso (comparar com now()/timestamptz anularia o índice); SQL cru não passa pelo schema do
        // adaptador → tabela qualificada com o schema de teste
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN SELECT id FROM "${parseDatabaseUrl(URL_).schema}"."${table}" WHERE "expiresAt" < LOCALTIMESTAMP OR "${other}" < LOCALTIMESTAMP LIMIT 500`);
      });
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    };
    const ps = await plan('Session', 'revokedAt'), pc = await plan('VerificationCode', 'consumedAt');
    expect(ps).toContain('Session_expiresAt_idx'); expect(ps).toContain('Session_revokedAt_idx');
    expect(pc).toContain('VerificationCode_expiresAt_idx'); expect(pc).toContain('VerificationCode_consumedAt_idx');
    expect(ps).not.toMatch(/Seq Scan/);
  });
});
