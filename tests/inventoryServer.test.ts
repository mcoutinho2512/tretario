/**
 * Rodada 11 — INVENTÁRIO na sala REAL (Colyseus + API no mesmo processo, banco em memória, PV_TEST=1) com CLIENTES
 * FORJADOS (mensagens cruas do SDK / fetch — o que o DevTools conseguiria mandar):
 *   aparência estrita com item bloqueado → 403 (e o não estrito cai no padrão) · design bloqueado e item de confronto
 *   sem posse → `prop_denied` · título não ganho → recusado (API e sala) · título ganho (conquista) → persistido em
 *   Profile.titleKey, PÚBLICO em NetPlayer.title para outro jogador e de volta no relogin · nível público
 *   (NetPlayer.lvl) · bandeira pelo acesso rápido (`prop`) conta na missão ENTRE NO CLIMA. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { packMove } from '../src/net/rules';
import { pointOnAxis, type ZoneDefinition } from '../src/world/zones';
import { DESIGN_BY_KEY } from '../src/social/designs';
import { freePortBlock } from './fixtures/freePort';
import type { ProgressionMessage } from '../src/progression/types';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
let PORT = 0; // bloco livre de verdade (tests/fixtures/freePort.ts)
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { pvAxis: [number, number][] };
const zoneDefs = (JSON.parse(readFileSync('public/world/zones.json', 'utf8')) as { zones: ZoneDefinition[] }).zones;
const anchor = (id: string) => { const z = zoneDefs.find((d) => d.id === id)!; return pointOnAxis(manifest.pvAxis, z.anchor!.t, z.anchor!.side); };

let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
let rooms: Set<unknown>;
const opened: Room[] = [];

async function account(nick: string) {
  const u = await store.users.create({ email: `${nick.toLowerCase()}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  return { id: u.id, cookie: await login(u.id) };
}
async function login(userId: string) {
  const token = `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-sessao`;
  await store.sessions.create({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return `${COOKIE}=${token}`;
}
const call = async (method: string, path: string, cookie: string, body?: unknown) => {
  const r = await fetch(api + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
interface Peer { room: Room; msgs: Record<string, any[]>; seq: number }
async function enter(o: Record<string, unknown>): Promise<Peer> {
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, testSpawn: anchor('CENTRAL'), ...o });
  opened.push(room);
  const p: Peer = { room, msgs: {}, seq: 0 };
  room.onMessage('*', () => {});
  for (const t of ['prop_denied', 'title_res', 'prog', 'sup_res']) room.onMessage(t, (m: unknown) => { (p.msgs[t] ??= []).push(m); });
  return p;
}
async function enterAccount(cookie: string) {
  const r = await call('POST', '/api/session/ticket', cookie, { role: 'player' });
  expect(r.status).toBe(200);
  return enter({ ticket: r.body.ticket });
}
const until = async (f: () => unknown, ms = 6000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(40); } };
type Pl = { prop: number; design: number; title: string; lvl: number; shirtDesign: number; accessory: string };
const me = (p: Peer) => (p.room.state as { players?: Map<string, Pl> } | undefined)?.players?.get(p.room.sessionId);
/** como OUTRO cliente vê a entidade de `p` */
const seenBy = (viewer: Peer, p: Peer) => (viewer.room.state as { players?: Map<string, Pl> } | undefined)?.players?.get(p.room.sessionId);
const lastProg = (p: Peer) => (p.msgs.prog?.at(-1) as ProgressionMessage | undefined)?.p;
const serverRoom = () => [...rooms][0] as { items: { free: boolean } };

describe.skipIf(skip)('inventário — sala real e clientes forjados', () => {
  beforeAll(async () => {
    PORT = await freePortBlock(2);
    Object.assign(process.env, { PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory' });
    const { MemoryDataStore } = await import('../server/src/data/memory');
    const { TicketService } = await import('../server/src/identity/tickets');
    const { setServices } = await import('../server/src/services');
    const { seedEvents } = await import('../server/src/events/seed');
    store = new MemoryDataStore();
    setServices({ store, tickets: new TicketService() });
    await seedEvents(store);
    const sess = await import('../server/src/http/session');
    hashToken = sess.hashToken; COOKIE = sess.SESSION_COOKIE;
    const { router } = await import('../server/src/http/router');
    const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);
    await srvMod('http/routes.ts');
    rooms = (await srvMod('PresidenteVargasRoom.ts')).liveRooms;
    http = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(opened.map((r) => r.leave())), w(1500)]);
    await Promise.race([gameServer?.close(), w(2000)]);
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('aparência: pedido ESTRITO com item bloqueado → 403; liberado → 200; o não estrito cai no padrão (sem vantagem)', async () => {
    const A = await account('Vestida');
    const locked = { ...APP, topStyle: 'camiseta', shirtDesign: 208 }; // recompensa de nível 3
    const r1 = await call('PUT', '/api/me/appearance', A.cookie, { appearance: locked, strict: true });
    expect(r1).toMatchObject({ status: 403, body: { error: 'bloqueado', items: ['shirt:208'] } });
    expect(await store.appearances.get(A.id)).toBeNull(); // nada gravado
    const r2 = await call('PUT', '/api/me/appearance', A.cookie, { appearance: locked });
    expect(r2.status).toBe(200);
    expect(r2.body.appearance.shirtDesign).toBe(0);
    const ok = await call('PUT', '/api/me/appearance', A.cookie, { appearance: { ...APP, topStyle: 'camiseta', shirtDesign: 205, accessory: 'bone' }, strict: true });
    expect(ok).toMatchObject({ status: 200, body: { appearance: { shirtDesign: 205, accessory: 'bone' } } });
    expect((await call('PUT', '/api/me/appearance', 'x=y', { appearance: locked, strict: true })).status).toBe(401);
  });

  it('mão: design bloqueado e item de confronto sem posse → prop_denied; com posse/livre → aceito', async () => {
    const a = await enter({ name: 'Forjada' });
    await until(() => me(a));
    a.room.send('prop', { p: 1, d: DESIGN_BY_KEY.get('mar_e_mata')!.id }); // arte de nível 2
    await until(() => a.msgs.prop_denied?.length);
    expect(a.msgs.prop_denied[0]).toBe('bloqueado');
    expect(me(a)!.prop ?? 0).toBe(0);
    const room = serverRoom();
    const wasFree = room.items.free;
    room.items.free = false; // como em produção sem `freeCombatProps`: só o que foi pego no chão
    await w(80);
    a.room.send('prop', { p: 12, d: 0 });
    await until(() => a.msgs.prop_denied?.length >= 2);
    expect(a.msgs.prop_denied[1]).toBe('sem_item');
    expect(me(a)!.prop ?? 0).toBe(0);
    room.items.free = true;
    await w(80);
    a.room.send('prop', { p: 12, d: 0 });
    await until(() => me(a)!.prop === 12);
    room.items.free = wasFree;
    a.room.send('prop', { p: 99, d: 0 });
    await until(() => a.msgs.prop_denied?.length >= 3);
    expect(a.msgs.prop_denied[2]).toBe('item_invalido');
  });

  it('título: não ganho → recusado; ganho na conquista (sessão sem conta) → público para outro jogador', async () => {
    const a = await enter({ name: 'Faladora' });
    const b = await enter({ name: 'Vizinha' });
    await until(() => me(a) && seenBy(b, a));
    await until(() => me(a)!.lvl === 1); // nível público
    a.room.send('title', { t: 'Boa de papo' });
    await until(() => a.msgs.title_res?.length);
    expect(a.msgs.title_res[0]).toEqual({ ok: false, reason: 'bloqueado' });
    expect(me(a)!.title).toBe('');
    a.room.send('chat_send', { ch: 'geral', text: 'oi, avenida' }); // conquista BOA CONVERSA → título
    await until(() => lastProg(a)?.titles?.includes('Boa de papo'));
    await w(450);
    a.room.send('title', { t: 'Boa de papo' });
    await until(() => a.msgs.title_res?.length >= 2);
    expect(a.msgs.title_res[1]).toEqual({ ok: true, title: 'Boa de papo' });
    await until(() => seenBy(b, a)?.title === 'Boa de papo');
    expect(seenBy(b, a)!.lvl).toBe(1);
    await w(450);
    a.room.send('title', { t: 'x'.repeat(200) });
    await until(() => a.msgs.title_res?.length >= 3);
    expect(a.msgs.title_res[2]).toEqual({ ok: false, reason: 'invalido' });
    await w(450);
    a.room.send('title', { t: null }); // desequipar
    await until(() => seenBy(b, a)?.title === '');
  });

  it('título da CONTA: API recusa o não ganho; ganho → Profile.titleKey, rede e relogin; perfil público', async () => {
    const A = await account('Titular');
    expect((await call('PUT', '/api/me/title', A.cookie, { title: 'Boa de papo' }))).toMatchObject({ status: 403, body: { error: 'bloqueado' } });
    expect((await call('PUT', '/api/me/title', A.cookie, { title: 42 }))).toMatchObject({ status: 400, body: { error: 'titulo_invalido' } });
    const a = await enterAccount(A.cookie);
    const b = await enter({ name: 'Plateia' });
    await until(() => me(a) && seenBy(b, a) && lastProg(a));
    a.room.send('chat_send', { ch: 'geral', text: 'bom dia' });
    await until(() => lastProg(a)?.titles?.includes('Boa de papo'));
    const put = await call('PUT', '/api/me/title', A.cookie, { title: 'Boa de papo' });
    expect(put).toMatchObject({ status: 200, body: { title: 'Boa de papo' } });
    expect(await store.titles.get(A.id)).toBe('Boa de papo');
    await until(() => seenBy(b, a)?.title === 'Boa de papo'); // a sala ouviu a troca pela API
    expect((await call('GET', '/api/me/title', A.cookie)).body).toEqual({ title: 'Boa de papo', titles: ['Boa de papo'] });
    expect((await call('GET', '/api/profile/Titular', '')).body).toMatchObject({ title: 'Boa de papo', level: 1 });
    // pela sala também grava na conta
    a.room.send('title', { t: null });
    await until(() => a.msgs.title_res?.length);
    expect(a.msgs.title_res[0]).toEqual({ ok: true, title: null });
    await until(() => seenBy(b, a)?.title === '');
    expect(await store.titles.get(A.id)).toBeNull();
    await w(450);
    a.room.send('title', { t: 'Boa de papo' });
    await until(() => seenBy(b, a)?.title === 'Boa de papo');
    // sai e entra com sessão nova: o título vem do banco
    await a.room.leave();
    await w(400);
    const a2 = await enterAccount(await login(A.id));
    await until(() => me(a2)?.title === 'Boa de papo');
    await until(() => seenBy(b, a2)?.title === 'Boa de papo');
  });

  it('missão: bandeira pelo acesso rápido (mesmo `prop`) conta em ENTRE NO CLIMA', async () => {
    const A = await account('Bandeirista');
    const at = anchor('CENTRAL');
    const a = await enterAccount(A.cookie);
    await until(() => lastProg(a));
    // BEM-VINDO: 40 m a pé (movimentos forjados dentro da regra)
    let x = at.x, z = at.z;
    for (let d = 0; d < 40; d += 1.1) { x += Math.sin(at.heading) * 1.1; z += Math.cos(at.heading) * 1.1; a.room.send('move', packMove({ x, y: 0.15, z, heading: at.heading, speed: 5, loco: 1, seq: ++a.seq })); await w(100); }
    await until(() => lastProg(a)?.active.some((m) => m.missionId === 'entre_no_clima'), 8000);
    a.room.send('prop', { p: 1, d: 0 }); // tecla 1 do acesso rápido = bandeira pequena
    await until(() => lastProg(a)?.active.find((m) => m.missionId === 'entre_no_clima')?.values.bandeira === 1, 6000);
  }, 30_000);
});
