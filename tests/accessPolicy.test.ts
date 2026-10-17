/** Rodada 8 — autorização central, moderação de texto e identidade resolvida pelo servidor. */
import { describe, it, expect, beforeEach } from 'vitest';
import { can, deriveAccessState, resolveRole, bestGrant } from '../src/access/policy';
import { textModeration } from '../src/moderation/text';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import { resolveIdentity, JoinRefused } from '../server/src/identity/resolve';
import type { Services } from '../server/src/services';

describe('estado de acesso derivado', () => {
  it('visitante, registrado, jogador, suspenso, banido', () => {
    expect(deriveAccessState(null)).toBe('VISITOR');
    expect(deriveAccessState({ status: 'ACTIVE', grants: [] })).toBe('REGISTERED');
    expect(deriveAccessState({ status: 'ACTIVE', grants: ['DEV_GRANTED'] })).toBe('PLAYER');
    expect(deriveAccessState({ status: 'SUSPENDED', suspendedUntil: Date.now() + 60_000, grants: ['PAID'] })).toBe('SUSPENDED');
    expect(deriveAccessState({ status: 'SUSPENDED', suspendedUntil: Date.now() - 1, grants: ['PAID'] })).toBe('PLAYER'); // suspensão vencida
    expect(deriveAccessState({ status: 'BANNED', grants: ['STAFF'] })).toBe('BANNED');
    expect(bestGrant(['DEV_GRANTED', 'PAID'])).toBe('PAID');
  });
  it('espectador nunca dirige, picha, usa item ou empurra — nem com conta de jogador', () => {
    for (const cap of ['vehicle.use', 'graffiti.create', 'action.perform', 'item.hold', 'push'] as const) {
      expect(can('PLAYER', cap, 'player')).toBe(true);
      expect(can('PLAYER', cap, 'spectator')).toBe(false);
      expect(can('VISITOR', cap, 'spectator')).toBe(false);
      expect(can('REGISTERED', cap)).toBe(false);
      expect(can('SUSPENDED', cap)).toBe(false);
    }
  });
  it('o pedido de papel do cliente só rebaixa', () => {
    expect(resolveRole('VISITOR', 'player')).toBe('spectator');
    expect(resolveRole('REGISTERED', 'player')).toBe('spectator');
    expect(resolveRole('SUSPENDED', 'player')).toBe('spectator');
    expect(resolveRole('PLAYER', 'spectator')).toBe('spectator');
    expect(resolveRole('PLAYER', 'player')).toBe('player');
    expect(resolveRole('BANNED', 'spectator')).toBeNull();
  });
  it('visitante lê o chat geral mas não escreve', () => {
    expect(can('VISITOR', 'chat.read')).toBe(true);
    expect(can('VISITOR', 'chat.write')).toBe(false);
    expect(can('SUSPENDED', 'chat.write')).toBe(false);
  });
});

describe('moderação de texto central', () => {
  it('apelido: tamanho, caracteres, reservados e variações', () => {
    expect(textModeration.check('Maria_RJ', 'nickname')).toEqual({ ok: true, text: 'Maria_RJ' });
    expect(textModeration.check('ab', 'nickname').ok).toBe(false);
    expect(textModeration.check('com espaço', 'nickname')).toEqual({ ok: false, reason: 'caracteres' });
    for (const n of ['ADMIN', 'Adm1n', 'admin_oficial', 'MOD', 'mod2', 'Sistema', 'SUPORTE', 'Suporte.Oficial', 'system', 'staff_pv']) {
      expect(textModeration.check(n, 'nickname').ok, n).toBe(false);
    }
    expect(textModeration.check('modelo_carioca', 'nickname').ok).toBe(true); // "mod" só exato
    expect(textModeration.nicknameKey('João.Silva')).toBe(textModeration.nicknameKey('joao_silva'));
    expect(textModeration.nicknameKey('J0ao')).toBe(textModeration.nicknameKey('joao'));
  });
  it('chat: palavrão e spam bloqueados; texto normal passa', () => {
    expect(textModeration.check('bora pro trio!', 'chat').ok).toBe(true);
    expect(textModeration.check('vai tomar no cu', 'chat').ok).toBe(false);
    expect(textModeration.check('compre em www.site.com', 'chat').ok).toBe(false);
    expect(textModeration.check('x'.repeat(201), 'chat')).toEqual({ ok: false, reason: 'longo' });
  });
});

describe('identidade resolvida pelo servidor', () => {
  let s: Services;
  beforeEach(() => { s = { store: new MemoryDataStore(), tickets: new TicketService() }; delete process.env.PV_TEST; delete process.env.PV_ALLOW_ANON_PLAYERS; });
  it('sem ticket → espectador visitante (o cliente pedir "player" não adianta)', async () => {
    const id = await resolveIdentity(s, { role: 'player' }, 'manifestacao');
    expect(id).toMatchObject({ role: 'spectator', state: 'VISITOR', userId: null });
  });
  it('ticket de conta sem licença → espectador; com DEV_GRANTED → jogador; ticket é de uso único', async () => {
    const u = await s.store.users.create({ email: 'a@b.c', passwordHash: 'x' });
    await s.store.profiles.create({ userId: u.id, nickname: 'Ana', nicknameKey: 'ana' });
    const t1 = s.tickets.issue({ userId: u.id, authSessionId: 's1', role: 'player' });
    expect(await resolveIdentity(s, { ticket: t1, role: 'player' }, 'manifestacao')).toMatchObject({ role: 'spectator', state: 'REGISTERED', nickname: 'Ana' });
    await expect(resolveIdentity(s, { ticket: t1 }, 'manifestacao')).rejects.toBeInstanceOf(JoinRefused);
    await s.store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'test' });
    const t2 = s.tickets.issue({ userId: u.id, authSessionId: 's1', role: 'player' });
    expect(await resolveIdentity(s, { ticket: t2 }, 'manifestacao')).toMatchObject({ role: 'player', state: 'PLAYER', grant: 'DEV_GRANTED' });
  });
  it('banido não entra; suspenso só assiste', async () => {
    const u = await s.store.users.create({ email: 'b@b.c', passwordHash: 'x' });
    await s.store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'test' });
    await s.store.users.update(u.id, { status: 'SUSPENDED', suspendedUntil: new Date(Date.now() + 3600_000) });
    expect(await resolveIdentity(s, { ticket: s.tickets.issue({ userId: u.id, authSessionId: 'x', role: 'player' }) }, 'e')).toMatchObject({ role: 'spectator', state: 'SUSPENDED' });
    await s.store.users.update(u.id, { status: 'BANNED' });
    await expect(resolveIdentity(s, { ticket: s.tickets.issue({ userId: u.id, authSessionId: 'x', role: 'spectator' }) }, 'e')).rejects.toMatchObject({ reason: 'banido' });
  });
  it('ticket forjado/expirado é recusado', async () => {
    await expect(resolveIdentity(s, { ticket: 'inventado' }, 'e')).rejects.toBeInstanceOf(JoinRefused);
    const u = await s.store.users.create({ email: 'c@b.c', passwordHash: 'x' });
    const t = s.tickets.issue({ userId: u.id, authSessionId: 'x', role: 'player' }, Date.now() - 120_000);
    await expect(resolveIdentity(s, { ticket: t }, 'e')).rejects.toBeInstanceOf(JoinRefused);
  });
  it('servidor de TESTE (PV_TEST=1): bots entram como jogador anônimo', async () => {
    process.env.PV_TEST = '1';
    expect(await resolveIdentity(s, { name: 'bot1' }, 'e')).toMatchObject({ role: 'player', test: true, nickname: 'bot1' });
    delete process.env.PV_TEST;
  });
});
