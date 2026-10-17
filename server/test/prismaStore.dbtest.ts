/**
 * Rodada 8 — PrismaDataStore contra PostgreSQL REAL (schema próprio, migrado por server/tools/test-db.ts).
 * Não roda no `npm run verify`: só em `npm run test:db` (exige o banco local: docker compose up -d db).
 */
import { describe, it, expect } from 'vitest';
import { dataStoreContract } from '../../tests/dataStoreContract';
import { createPrismaStore, parseDatabaseUrl } from '../src/data/prisma';
import { MemoryDataStore } from '../src/data/memory';
import { TicketService } from '../src/identity/tickets';
import { AuthService } from '../src/auth/service';
import { DevelopmentMailProvider } from '../src/auth/mail';
import { grantAccess } from '../src/access/admin';
import { seedEvents, readEventDefs } from '../src/events/seed';
import { ChatService, type ChatIdentity } from '../src/chat/ChatService';

const URL_ = process.env.DATABASE_URL ?? '';
if (!/schema=/.test(URL_) || parseDatabaseUrl(URL_).schema === 'public') throw new Error('test:db precisa de DATABASE_URL com ?schema=<schema de teste> (nunca public)');

dataStoreContract('prisma', () => createPrismaStore(URL_));

describe('PrismaDataStore — fluxo de conta no banco real', () => {
  it('cadastro → senha só como hash → login após "reinício" (nova conexão) → acesso concedido persiste', async () => {
    const mk = async () => {
      const store = await createPrismaStore(URL_);
      const auth = new AuthService({ store, tickets: new TicketService(), mail: new DevelopmentMailProvider(false), secret: 'teste', currentEventId: () => 'manifestacao', scrypt: { logN: 10, r: 8, p: 1 } });
      return { store, auth };
    };
    const email = `db${Date.now()}@exemplo.test`, password = 'Ipanema#2026';
    const nick = `Db${Date.now().toString(36)}`;
    const a = await mk();
    await seedEvents(a.store, readEventDefs().events);
    const reg = await a.auth.register({ body: { email, password, confirm: password, nickname: nick }, cookies: {}, ip: '1.1.1.1', headers: {} });
    expect(reg.status).toBe(201);
    const u = (await a.store.users.byEmail(email))!;
    expect(u.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(JSON.stringify(u)).not.toContain(password);
    await grantAccess({ store: a.store, actor: 'teste' }, email);
    expect((await a.store.audit.list(20)).some((x) => x.action === 'GRANT_ACCESS' && x.targetId === u.id)).toBe(true);
    await a.store.close();

    const b = await mk();
    const login = await b.auth.login({ body: { email, password }, cookies: {}, ip: '1.1.1.1', headers: {} });
    expect(login.status ?? 200).toBe(200);
    expect((login.body as { me: { user: { nickname: string }; access: { state: string } } }).me).toMatchObject({ user: { nickname: nick }, access: { state: 'PLAYER' } });
    expect((await b.store.events.groups('manifestacao')).map((g) => g.id)).toContain('manifestacao:neutro');
    await b.store.close();
  });

  it('memória e prisma concordam no mesmo cenário de acesso', async () => {
    const p = await createPrismaStore(URL_);
    for (const s of [p, new MemoryDataStore()]) {
      const u = await s.users.create({ email: `c${Math.random().toString(36).slice(2)}@exemplo.test`, passwordHash: 'x' });
      await s.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: 'manifestacao', source: 't' });
      expect((await s.access.active(u.id, 'manifestacao', new Date())).length, s.kind).toBe(1);
      expect((await s.access.active(u.id, 'cotidiano', new Date())).length, s.kind).toBe(0);
    }
    await p.close();
  });

  it('mute por identidade (8.1): sobrevive a reinício (nova instância), par único, cascata ao apagar a conta, denúncia com apelido', async () => {
    const mkUser = async (s: Awaited<ReturnType<typeof createPrismaStore>>, nick: string) => {
      const u = await s.users.create({ email: `${nick}${Math.random().toString(36).slice(2)}@exemplo.test`, passwordHash: 'x' });
      await s.profiles.create({ userId: u.id, nickname: nick + u.id.slice(0, 6), nicknameKey: (nick + u.id.slice(0, 6)).toLowerCase() });
      return u.id;
    };
    const a = await createPrismaStore(URL_);
    const owner = await mkUser(a, 'dono'), target = await mkUser(a, 'alvo');
    // ChatService grava pelo DataStore real (mute pela entidade no mundo)
    const ident = (userId: string, nickname: string): ChatIdentity => ({ userId, nickname, state: 'PLAYER', role: 'player', groupKey: null });
    const conns: Record<string, { type: string; msg: any }[]> = {};
    const out = (sid: string) => ({ send: (type: string, msg: unknown) => { (conns[sid] ??= []).push({ type, msg }); } });
    const hooks = { nidOf: () => 0, posOf: () => undefined, near: () => {}, broadcast: () => {}, identityOfNid: (nid: number) => (nid === 7 ? { sid: 'T', userId: target, nickname: 'Teste123' } : undefined) };
    const svc1 = new ChatService(hooks, { store: a, log: () => {}, secret: 's' });
    svc1.join('O', ident(owner, 'Dono'), out('O'));
    await svc1.settled('O');
    expect(svc1.mute('O', { nid: 7, on: true })).toEqual({ ok: true });
    await svc1.settled('O');
    const ref = svc1.mutedBy('O')[0].ref;
    // par único: repetir não duplica
    await a.mutes.add(owner, target, 'outro apelido');
    expect(await a.mutes.list(owner)).toHaveLength(1);
    expect((await a.mutes.list(owner))[0]).toMatchObject({ ownerUserId: owner, mutedUserId: target, mutedNicknameAtTime: 'Teste123' });
    await a.close();

    // "reinício": store e ChatService novos → a lista volta do banco, com o mesmo ref
    const b = await createPrismaStore(URL_);
    const svc2 = new ChatService(hooks, { store: b, log: () => {}, secret: 's' });
    svc2.join('O2', ident(owner, 'Dono'), out('O2'));
    await svc2.settled('O2');
    expect(svc2.mutedBy('O2')).toMatchObject([{ ref, nick: 'Teste123' }]);
    expect(conns.O2.find((m) => m.type === 'chat_mutes')?.msg.list).toHaveLength(1);
    // denúncia guarda o apelido do momento
    const rep = await b.reports.create({ reporterUserId: owner, targetUserId: target, targetType: 'CHAT_MESSAGE', targetRef: 'chat:t:1', category: 'SPAM', details: null, evidence: {}, eventId: null, reportedNicknameAtTime: 'Teste123' });
    expect((await b.reports.list({ limit: 50 })).find((r) => r.id === rep.id)?.reportedNicknameAtTime).toBe('Teste123');
    // desmutar remove; mutar de novo e apagar a conta do alvo → cascata
    expect(await b.mutes.remove(owner, target)).toBe(true);
    expect(await b.mutes.remove(owner, target)).toBe(false);
    await b.mutes.add(owner, target, 'Teste123');
    await b.db.user.delete({ where: { id: target } });
    expect(await b.mutes.list(owner)).toEqual([]);
    await b.mutes.add(owner, await mkUser(b, 'outro'), null);
    await b.db.user.delete({ where: { id: owner } });
    expect(await b.db.muteRelationship.count({ where: { ownerUserId: owner } })).toBe(0);
    await b.close();
  });
});
