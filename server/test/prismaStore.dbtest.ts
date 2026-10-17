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
});
