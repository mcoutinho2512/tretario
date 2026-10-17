/** Rodada 8 — administração de acesso, releitura de identidades na sala, eventos no banco e caminho PAID (mock). */
import { describe, it, expect } from 'vitest';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import type { ConnectionIdentity } from '../server/src/identity/resolve';
import { recheckIdentities } from '../server/src/identity/recheck';
import { ban, grantAccess, revokeAccess, suspend, unsuspend, unban, listReports, recordGraffitiRemoval, AdminError } from '../server/src/access/admin';
import { MockPaymentProvider, PaymentService } from '../server/src/payments/provider';
import { readEventDefs, seedEvents } from '../server/src/events/seed';
import { deriveAccessState, bestGrant } from '../src/access/policy';
import type { Services } from '../server/src/services';

const EV = 'manifestacao';

async function user(store: MemoryDataStore, email = 'p@exemplo.test') {
  return store.users.create({ email, passwordHash: 'scrypt$x' });
}
const ident = (userId: string, o: Partial<ConnectionIdentity> = {}): ConnectionIdentity =>
  ({ userId, authSessionId: 's', nickname: 'P', state: 'PLAYER', grant: 'DEV_GRANTED', role: 'player', groupKey: null, test: false, ...o });

describe('CLI de operador (biblioteca)', () => {
  it('cada ação grava AuditLog e ModerationAction; nada de segredo no log', async () => {
    const store = new MemoryDataStore();
    const u = await user(store);
    const c = { store, actor: 'cli:op' };
    await grantAccess(c, 'P@Exemplo.test', { eventId: EV, hours: 24 });
    expect(await revokeAccess(c, 'p@exemplo.test')).toBe(1);
    await suspend(c, 'p@exemplo.test', 3, 'flood');
    await unsuspend(c, 'p@exemplo.test');
    await ban(c, 'p@exemplo.test', 'ódio');
    await unban(c, 'p@exemplo.test');
    await listReports(c, 'OPEN');
    await recordGraffitiRemoval(c, 42, 'pichação ofensiva', 'arquivo');
    const actions = (await store.audit.list()).map((a) => a.action).reverse();
    expect(actions).toEqual(['GRANT_ACCESS', 'REVOKE_ACCESS', 'SUSPEND', 'UNSUSPEND', 'BAN', 'UNBAN', 'LIST_REPORTS', 'REMOVE_GRAFFITI']);
    expect((await store.moderation.forUser(u.id)).map((m) => m.action)).toEqual(['GRANT_ACCESS', 'REVOKE_ACCESS', 'SUSPEND', 'UNSUSPEND', 'BAN', 'UNBAN']);
    expect((await store.audit.list())[0]).toMatchObject({ targetType: 'GRAFFITI', targetId: '42', meta: { reason: 'pichação ofensiva', via: 'arquivo' } });
    expect(JSON.stringify(await store.audit.list())).not.toMatch(/scrypt|passwordHash|token/);
    await expect(grantAccess(c, 'ninguem@exemplo.test')).rejects.toBeInstanceOf(AdminError);
    await expect(suspend(c, 'p@exemplo.test', 0, 'x')).rejects.toMatchObject({ code: 'argumento_invalido' });
    await expect(ban(c, 'p@exemplo.test', '')).rejects.toMatchObject({ code: 'argumento_invalido' });
  });
});

describe('sala relê identidades (mudanças feitas pela CLI em outro processo)', () => {
  it('suspenso → rebaixado; banido → desconectado; concessão revogada → rebaixado; espectador suspenso → atualizado', async () => {
    const store = new MemoryDataStore();
    const s: Services = { store, tickets: new TicketService() };
    const c = { store, actor: 'cli:op' };
    const [a, b, d, e] = await Promise.all(['a', 'b', 'd', 'e'].map((x) => user(store, `${x}@exemplo.test`)));
    for (const x of ['a', 'b', 'd', 'e']) await grantAccess(c, `${x}@exemplo.test`);
    const ids = new Map<string, ConnectionIdentity>([
      ['c1', ident(a.id)], ['c2', ident(b.id)], ['c3', ident(d.id)], ['c4', ident(e.id, { role: 'spectator' })],
      ['c5', ident(a.id, { role: 'spectator' })], ['bot', { ...ident('x'), userId: null, test: true }],
    ]);
    expect(await recheckIdentities(s, ids, EV)).toEqual([]); // nada mudou: nada a fazer
    await suspend(c, 'a@exemplo.test', 1, 'flood');
    await ban(c, 'b@exemplo.test', 'ameaça');
    await revokeAccess(c, 'd@exemplo.test');
    await suspend(c, 'e@exemplo.test', 1, 'spam');
    const acts = Object.fromEntries((await recheckIdentities(s, ids, EV)).map((x) => [x.sessionId, [x.kind, x.identity.state]]));
    expect(acts).toEqual({
      c1: ['downgrade', 'SUSPENDED'], c2: ['kick', 'BANNED'], c3: ['downgrade', 'REGISTERED'], c4: ['update', 'SUSPENDED'], c5: ['update', 'SUSPENDED'],
    });
  });
});

describe('eventos espelhados no banco', () => {
  it('grupos de public/events viram EventGroup "<evento>:<chave>"; membership válida', async () => {
    const store = new MemoryDataStore();
    const defs = readEventDefs();
    expect(await seedEvents(store, defs.events)).toBe(defs.events.length);
    await seedEvents(store, defs.events); // idempotente
    const gs = await store.events.groups(EV);
    expect(gs.map((g) => g.id)).toEqual(['manifestacao:grupo-13', 'manifestacao:grupo-22', 'manifestacao:neutro']);
    expect(gs[2]).toMatchObject({ neutral: true, designKey: 'paz' });
    const u = await user(store);
    await store.events.setMembership(u.id, EV, 'manifestacao:neutro');
    await expect(store.events.setMembership(u.id, EV, 'manifestacao:inventado')).rejects.toThrow();
  });
});

describe('pagamento (SOMENTE mock): webhook confirmado → PAID', () => {
  it('cobrança → webhook assinado → concessão PAID idempotente; assinatura falsa ignorada; reembolso revoga', async () => {
    const store = new MemoryDataStore();
    const mock = new MockPaymentProvider('segredo');
    const pay = new PaymentService(store, mock);
    const u = await user(store);
    const facts = async () => {
      const grants = (await store.access.active(u.id, EV, new Date())).map((g) => g.grant);
      return { state: deriveAccessState({ status: 'ACTIVE', grants }), grant: bestGrant(grants) };
    };
    const { payment, charge } = await pay.startCheckout(u.id, { amountCents: 990, eventId: EV });
    expect(payment.status).toBe('PENDING');
    // webhook forjado (sem assinatura válida) não concede nada
    expect(await pay.onWebhook(payment.id, JSON.stringify({ providerRef: charge.providerRef, status: 'PAID' }), { 'x-mock-signature': '00' })).toBeNull();
    expect(await facts()).toEqual({ state: 'REGISTERED', grant: 'NONE' });
    const wh = mock.simulate(charge.providerRef, 'PAID');
    const g = await pay.onWebhook(payment.id, wh.body, wh.headers);
    expect(g).toMatchObject({ grant: 'PAID', paymentId: payment.id, eventId: EV });
    expect(await pay.onWebhook(payment.id, wh.body, wh.headers)).toMatchObject({ id: g!.id }); // repetido: mesma licença
    expect((await store.access.list(u.id)).length).toBe(1);
    expect(await facts()).toEqual({ state: 'PLAYER', grant: 'PAID' });
    expect((await store.payments.byId(payment.id))?.status).toBe('PAID');
    await mock.refund(charge.providerRef);
    const rf = mock.simulate(charge.providerRef, 'REFUNDED');
    await pay.onWebhook(payment.id, rf.body, rf.headers);
    expect(await facts()).toEqual({ state: 'REGISTERED', grant: 'NONE' });
  });
});
