/** Rodada 8 — API de aparência/perfil/preferências/grupo: servidor é a autoridade, cada conta só edita a si mesma. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import { setServices } from '../server/src/services';
import { router } from '../server/src/http/router';
import { SESSION_COOKIE, hashToken } from '../server/src/http/session';
import { currentEvent, meExtras } from '../server/src/http/profile';
import { loadPlayerLook } from '../server/src/identity/appearance';
import { validateAppearance } from '../src/characters/validateAppearance';
import type { CharacterAppearance } from '../src/characters/bodyTypes';

let srv: Server, base = '';
const store = new MemoryDataStore();

async function account(nick: string, grant = true) {
  const u = await store.users.create({ email: `${nick}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  if (grant) await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  const token = `tok-${nick}-${Math.random()}`;
  await store.sessions.create({ userId: u.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return { id: u.id, cookie: `${SESSION_COOKIE}=${token}` };
}

async function api(method: string, path: string, cookie?: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() as any };
}

const LOOK: CharacterAppearance = { body: 'mulher', skin: 0x8a5636, hair: 0x2b1c12, top: 0xd23c3c, bottom: 0x1f2430, shoes: 0x222222, scale: 1, accessory: 'oculos', acc: 0x1f1f1f, topStyle: 'regata', bottomStyle: 'bermuda', shoeStyle: 'chinelo', hairStyle: 'afro', shirtDesign: 0 };

beforeAll(async () => {
  await import('../server/src/http/profile');
  setServices({ store, tickets: new TicketService() });
  srv = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

describe('aparência (GET/PUT /api/me/appearance)', () => {
  it('sem sessão → 401; com sessão grava e devolve a versão validada', async () => {
    expect((await api('GET', '/api/me/appearance')).status).toBe(401);
    expect((await api('PUT', '/api/me/appearance', undefined, { appearance: LOOK })).status).toBe(401);
    const a = await account('Carioca1');
    expect((await api('GET', '/api/me/appearance', a.cookie)).body.appearance).toBeNull();
    const put = await api('PUT', '/api/me/appearance', a.cookie, { appearance: LOOK });
    expect(put.status).toBe(200);
    expect(put.body.appearance).toEqual(LOOK);
    expect((await api('GET', '/api/me/appearance', a.cookie)).body.appearance).toEqual(LOOK);
  });
  it('nunca confia no cliente: corpo inválido → 400; peças/cores/design inválidos saneados', async () => {
    const a = await account('Carioca2');
    expect((await api('PUT', '/api/me/appearance', a.cookie, { appearance: { body: 'robo' } })).status).toBe(400);
    const r = await api('PUT', '/api/me/appearance', a.cookie, { appearance: { ...LOOK, body: 'idoso', hairStyle: 'rabo', topStyle: 'regata', skin: -5, accessory: 'espada', shirtDesign: 100, extra: 'x' } });
    expect(r.status).toBe(200);
    expect(r.body.appearance.hairStyle).toBe('curto'); // idoso não tem rabo de cavalo
    expect(r.body.appearance.topStyle).toBe('polo'); // idoso não tem regata → roupa base
    expect(r.body.appearance.accessory).toBe('nenhum');
    expect(r.body.appearance.shirtDesign).toBe(0); // design de campanha não é camisa
    expect(r.body.appearance.extra).toBeUndefined();
    expect(r.body.appearance.skin).toBe(0xe0ac85);
  });
  it('um jogador não edita o avatar de outro (só existe "minha" aparência)', async () => {
    const a = await account('Carioca3'), b = await account('Carioca4');
    await api('PUT', '/api/me/appearance', a.cookie, { appearance: LOOK });
    // B tenta mandar o id de A no corpo, na URL e como outro usuário: só a própria conta muda
    await api('PUT', '/api/me/appearance', b.cookie, { userId: a.id, appearance: { ...LOOK, body: 'homem', top: 0x00ff00 } });
    expect((await api('PUT', `/api/profile/Carioca3`, b.cookie, { appearance: { body: 'homem' } })).status).toBe(404);
    expect((await api('PUT', `/api/me/appearance/${a.id}`, b.cookie, { appearance: { body: 'homem' } })).status).toBe(404);
    expect((await api('GET', '/api/me/appearance', a.cookie)).body.appearance).toEqual(LOOK);
    expect((await api('GET', '/api/me/appearance', b.cookie)).body.appearance.body).toBe('homem');
  });
  it('a sala carrega a aparência do BANCO para a conta (não as opções do cliente)', async () => {
    const a = await account('Carioca5');
    await api('PUT', '/api/me/appearance', a.cookie, { appearance: LOOK });
    const look = await loadPlayerLook(store, a.id, currentEvent().id);
    expect(look.appearance).toEqual(LOOK);
    const none = await account('Carioca6');
    expect((await loadPlayerLook(store, none.id, currentEvent().id)).appearance.body).toBe('homem');
  });
  it('sessão revogada não vale', async () => {
    const a = await account('Carioca7');
    const s = await store.sessions.byTokenHash(hashToken(a.cookie.split('=')[1]));
    await store.sessions.revoke(s!.id);
    expect((await api('GET', '/api/me/appearance', a.cookie)).status).toBe(401);
  });
});

describe('perfil público e preferências', () => {
  it('GET /api/profile/:nickname devolve só o PublicProfile', async () => {
    const a = await account('PerfilRio');
    await api('PUT', '/api/me/appearance', a.cookie, { appearance: LOOK });
    const r = await api('GET', '/api/profile/perfilrio');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['appearance', 'displayName', 'level', 'nickname', 'since', 'supporter', 'title']); // rodada 11: nível e título equipado são públicos
    expect(r.body.since).toMatch(/^\d{4}-\d{2}$/);
    expect(JSON.stringify(r.body)).not.toContain('@');
    expect((await api('GET', '/api/profile/ninguem123')).status).toBe(404);
  });
  it('PUT /api/me/preferences aceita só campos conhecidos', async () => {
    const a = await account('PrefRio');
    const r = await api('PUT', '/api/me/preferences', a.cookie, { preferences: { names: 'PROXIMOS', chatCollapsed: true, quality: 'turbo', admin: true } });
    expect(r.body.preferences).toEqual({ names: 'PROXIMOS', chatCollapsed: true });
    const r2 = await api('PUT', '/api/me/preferences', a.cookie, { quality: 'high' });
    expect(r2.body.preferences).toEqual({ names: 'PROXIMOS', chatCollapsed: true, quality: 'high' });
    expect((await api('GET', '/api/me/preferences', a.cookie)).body.preferences.quality).toBe('high');
  });
});

describe('grupo do evento (EventMembership)', () => {
  it('evento atual com grupos dos DADOS; escolher, trocar e sair', async () => {
    const ev = await api('GET', '/api/events/current');
    expect(ev.body.event.id).toBe(currentEvent().id);
    const keys = ev.body.groups.map((g: { key: string }) => g.key);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(ev.body.membership).toBeNull();
    const a = await account('GrupoRio', false); // conta sem licença também escolhe grupo (REGISTERED: group.join)
    expect((await api('PUT', '/api/events/current/membership', undefined, { groupKey: keys[0] })).status).toBe(401);
    expect((await api('PUT', '/api/events/current/membership', a.cookie, { groupKey: 'inexistente' })).status).toBe(400);
    for (const k of keys) {
      const r = await api('PUT', '/api/events/current/membership', a.cookie, { groupKey: k });
      expect(r.body.membership).toEqual({ eventId: currentEvent().id, groupKey: k });
      expect((await api('GET', '/api/events/current', a.cookie)).body.membership.groupKey).toBe(k);
      expect((await loadPlayerLook(store, a.id, currentEvent().id)).groupKey).toBe(k);
    }
    expect((await meExtras(store, a.id)).membership?.groupKey).toBe(keys[keys.length - 1]);
    await api('DELETE', '/api/events/current/membership', a.cookie);
    expect((await api('GET', '/api/events/current', a.cookie)).body.membership).toBeNull();
  });
  it('conta suspensa não entra em grupo', async () => {
    const a = await account('SuspRio');
    await store.users.update(a.id, { status: 'SUSPENDED', suspendedUntil: new Date(Date.now() + 3600_000) });
    const keys = (await api('GET', '/api/events/current')).body.groups.map((g: { key: string }) => g.key);
    expect((await api('PUT', '/api/events/current/membership', a.cookie, { groupKey: keys[0] })).status).toBe(403);
  });
});

describe('validador único de aparência', () => {
  it('idempotente e completa com o padrão do corpo', () => {
    const v = validateAppearance({ body: 'idosa' })!;
    expect(validateAppearance(v)).toEqual(v);
    expect(v.topStyle).toBe('camiseta');
    expect(validateAppearance(null)).toBeNull();
    expect(validateAppearance({ ...LOOK, shirtDesign: 200, topStyle: 'regata' })!.shirtDesign).toBe(0);
    expect(validateAppearance({ ...LOOK, shirtDesign: 200, topStyle: 'camiseta' })!.shirtDesign).toBe(200);
  });
});
