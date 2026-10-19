/**
 * Rodada 10 — TORCIDAS na sala REAL (Colyseus + API no mesmo processo, banco em memória, PV_TEST=1, contas reais):
 *   conta escolhe a torcida (PUT /api/me/supporter) → entra → `NetPlayer.sup` = índice+1 · inscrita num CONFRONTO vivo:
 *   troca de torcida fica PENDENTE e troca de grupo do evento é ADIADA (identidade mantém o grupo da inscrição) ·
 *   desiste do evento → as duas se aplicam · sai e entra de novo (login novo) → mesma torcida · sem conta: escolha só
 *   da sessão · NPCs nunca entram na contagem de jogadores. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { pointOnAxis } from '../src/world/zones';
import type { AgendaEntry } from '../src/events/schedule';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = 26100 + (process.pid % 400) * 2;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const SUP = JSON.parse(readFileSync('public/gameplay/supporters.json', 'utf8')) as { neutralId: string; groups: { id: string }[] };
const ids = SUP.groups.map((g) => g.id);
const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const P = (t: number, s: number) => { const p = pointOnAxis(axis, t, s); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; };
const SPOT = P(0.25, 0);
const AGENDA = [{
  id: 'confronto-teste', format: 'confronto_grupos', name: 'Confronto teste', description: '', zones: ['CENTRAL'],
  recurrence: { everyMin: 60, offsetMin: 0.6, registrationMin: 0.55, startingS: 2, durationMin: 2 },
  capacity: 10, minParticipants: 0, rewards: [], groupRules: { allowed: ['grupo-13', 'grupo-22'], friendlyFire: false },
  combatPolicy: 'CONTESTED', clash: { zones: ['CENTRAL'], respawn: [SPOT, SPOT], protectMs: 2000, pointsPerKnockdown: 1, pointsPerHoldSecond: 0 },
}];

let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
let rooms: Set<any>;
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
interface Bot { room: Room; msgs: Record<string, any[]> }
async function enter(o: Record<string, unknown>): Promise<Bot> {
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, testSpawn: SPOT, ...o });
  opened.push(room);
  const b: Bot = { room, msgs: {} };
  room.onMessage('*', () => {});
  for (const t of ['agenda', 'evt_res', 'sup_res']) room.onMessage(t, (m: unknown) => { (b.msgs[t] ??= []).push(m); });
  return b;
}
async function enterAccount(cookie: string) {
  const r = await call('POST', '/api/session/ticket', cookie, { role: 'player' });
  expect(r.status).toBe(200);
  return enter({ ticket: r.body.ticket });
}
const until = async (f: () => unknown, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(50); } };
const supOf = (b: Bot) => (b.room.state as { players?: Map<string, { sup: number }> } | undefined)?.players?.get(b.room.sessionId)?.sup;
const serverRoom = () => [...rooms][0] as { identities: Map<string, { groupKey: string | null }>; state: { players: Map<string, { sup: number }> } };

describe.skipIf(skip)('torcidas — sala real', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'pv-agenda-sup-'));
    const file = pjoin(dir, 'agenda.json');
    writeFileSync(file, JSON.stringify(AGENDA));
    Object.assign(process.env, { PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_AGENDA_FILE: file, PV_AGENDA_EPOCH: 'now' });
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

  it('escolha persiste, sup na rede, troca pendente/adiada no confronto, aplicada na saída e preservada no relogin', async () => {
    const A = await account('Torcedora');
    // API: inválida → 400; válida → aplicada; logo em seguida → cooldown
    expect((await call('PUT', '/api/me/supporter', A.cookie, { group: 'nao_existe' })).status).toBe(400);
    const put = await call('PUT', '/api/me/supporter', A.cookie, { group: ids[0] });
    expect(put).toMatchObject({ status: 200, body: { current: ids[0], pending: null, sup: 1, deferred: false } });
    const cd = await call('PUT', '/api/me/supporter', A.cookie, { group: ids[1] });
    expect(cd).toMatchObject({ status: 429, body: { error: 'cooldown' } });
    expect((await call('GET', '/api/me/supporter', 'x=y')).status).toBe(401);
    expect((await call('PUT', '/api/events/current/membership', A.cookie, { groupKey: 'grupo-13' })).status).toBe(200);
    // perfil público mostra a torcida
    expect((await call('GET', '/api/profile/Torcedora', '')).body.supporter).toBe(ids[0]);

    const B = await enterAccount(A.cookie);
    await until(() => supOf(B) === 1);

    // inscreve no confronto (grupo-13)
    await until(() => (B.msgs.agenda?.at(-1)?.list as AgendaEntry[] | undefined)?.find((e) => e.id === 'confronto-teste')?.state === 'REGISTRATION', 20000);
    const inst = (B.msgs.agenda.at(-1).list as AgendaEntry[]).find((e) => e.id === 'confronto-teste')!.inst;
    B.room.send('evt_join', { inst });
    await until(() => B.msgs.evt_res?.length);
    expect(B.msgs.evt_res[0]).toMatchObject({ ok: true });
    await w(1300); // a sala informa os eventos vivos da conta a 1 Hz

    // dentro do evento: torcida fica PENDENTE (sem cooldown), grupo do evento ADIADO
    // (dentro do evento o pedido não espera o cooldown: só é aplicado no fim)
    const dfr = await call('PUT', '/api/me/supporter', A.cookie, { group: ids[2] });
    expect(dfr).toMatchObject({ status: 200, body: { current: ids[0], pending: ids[2], deferred: true, sup: 1 } });
    const mem = await call('PUT', '/api/events/current/membership', A.cookie, { groupKey: 'grupo-22' });
    expect(mem.body).toMatchObject({ deferred: true });
    B.room.send('appearance', {}); // "salvei": a sala relê do banco
    await w(600);
    expect(serverRoom().identities.get(B.room.sessionId)?.groupKey).toBe('grupo-13'); // placar/fogo amigo coerentes
    expect(supOf(B)).toBe(1);

    // desiste do evento → no próximo segundo a sala aplica as duas
    B.room.send('evt_leave', { inst });
    await until(() => supOf(B) === 3, 5000);
    await until(() => serverRoom().identities.get(B.room.sessionId)?.groupKey === 'grupo-22', 5000);
    expect((await call('GET', '/api/me/supporter', A.cookie)).body).toMatchObject({ current: ids[2], pending: null, sup: 3 });

    // sai e entra de novo com login novo: a torcida vem do banco
    await B.room.leave();
    const B2 = await enterAccount(await login(A.id));
    await until(() => supOf(B2) === 3);

    // sem conta (servidor de teste): escolha só da sessão; mensagem `sup` segue a mesma política
    const V = await enter({ name: 'Visitante', sup: ids[3] });
    await until(() => supOf(V) === 4);
    V.room.send('sup', { group: SUP.neutralId });
    await until(() => V.msgs.sup_res?.length);
    expect(V.msgs.sup_res[0]).toMatchObject({ ok: false, r: 'cooldown' });
    // conta não troca pela mensagem (só pela API)
    B2.room.send('sup', { group: ids[1] });
    await until(() => B2.msgs.sup_res?.length);
    expect(B2.msgs.sup_res[0]).toMatchObject({ ok: false });

    // NPCs (concentrações/torcida simulada) nunca contam como jogador
    const m = (await (await fetch(`${api}/api/metrics/public`)).json()) as { playersOnline: number };
    expect(m.playersOnline).toBe(serverRoom().state.players.size);
    expect(serverRoom().state.players.size).toBe(2);
  }, 90_000);
});
