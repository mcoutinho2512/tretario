/**
 * Rodada 9.1 — inscrição em evento é da IDENTIDADE (conta), não da conexão: sala REAL no mesmo processo (Colyseus +
 * API, banco em memória, PV_TEST=1), contas reais (sessão → ticket → sala) e clientes do SDK com mensagens CRUAS.
 *   A (conta) inscreve na corrida, passa o 1º checkpoint · a conexão cai (fluxo de reconexão da sala) e volta → ainda
 *   inscrita, MESMO progresso · a mesma conta entra de novo (login duplicado, ticket novo) → a inscrição vale na sessão
 *   nova, contagem igual (sem duplicar) · B cai e não volta (graça vencida) → desiste (DNF 'saiu').
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { packMove } from '../src/net/rules';
import { pointOnAxis } from '../src/world/zones';
import type { AgendaEntry } from '../src/events/schedule';
import { freePortBlock } from './fixtures/freePort';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(2);
const GRACE_S = 3;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const axis: [number, number][] = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')).pvAxis;
const P = (t: number, s: number) => { const p = pointOnAxis(axis, t, s); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; };
const START = P(0.135, 10), CP1 = P(0.12, 10), CP2 = P(0.1, 10);
const AGENDA = [{
  id: 'teste-id', format: 'corrida', name: 'Teste identidade', description: '', zones: ['CIDADE_NOVA'],
  recurrence: { everyMin: 60, offsetMin: 0.5, registrationMin: 0.4, startingS: 2, durationMin: 3 },
  capacity: 4, minParticipants: 1, rewards: [], npcCrowd: 0,
  race: { vehicle: 'bicycle', laps: 1, timeLimitS: 150, start: { id: 's', at: START, radius: 8 }, checkpoints: [{ id: 'c1', at: CP1, radius: 7 }, { id: 'c2', at: CP2, radius: 7 }] },
}];

let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
const rooms: Room[] = [];

async function account(nick: string) {
  const u = await store.users.create({ email: `${nick.toLowerCase()}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  return { id: u.id, cookie: await login(u.id) };
}
/** "login": sessão NOVA (cookie novo) */
async function login(userId: string) {
  const token = `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-sessao`;
  await store.sessions.create({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return `${COOKIE}=${token}`;
}

interface Bot { room: Room; msgs: Record<string, any[]>; seq: number; x: number; z: number }
const KEEP = ['agenda', 'evt_res', 'race', 'race_def', 'evt_result', 'enter_ok', 'enter_denied', 'spawn', 'resume', 'session_replaced'];
async function enter(cookie: string, at: { x: number; z: number }): Promise<Bot> {
  const r = await fetch(api + '/api/session/ticket', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'player' }) });
  expect(r.status).toBe(200);
  const { ticket } = await r.json() as { ticket: string };
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, ticket, testSpawn: at });
  rooms.push(room);
  const b: Bot = { room, msgs: {}, seq: 0, x: at.x, z: at.z };
  room.onMessage('*', () => {});
  for (const t of KEEP) room.onMessage(t, (m: unknown) => { (b.msgs[t] ??= []).push(m); });
  return b;
}
const until = async (f: () => unknown, ms = 15000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await w(50); } };
async function drive(b: Bot, to: { x: number; z: number }, v = 6.5) {
  for (;;) {
    const d = Math.hypot(to.x - b.x, to.z - b.z);
    if (d < 0.05) return;
    const st = Math.min(d, v * 0.1);
    const h = Math.atan2(to.x - b.x, to.z - b.z);
    b.x += ((to.x - b.x) / d) * st; b.z += ((to.z - b.z) / d) * st;
    b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: h, speed: v, loco: 4, seq: ++b.seq }));
    await w(100);
  }
}
const lastAgenda = (b: Bot, inst: string) => (b.msgs.agenda?.at(-1)?.list as AgendaEntry[] | undefined)?.find((e) => e.inst === inst);
const wsClose = (r: Room) => (r.connection.transport as unknown as { ws: { close: () => void } }).ws.close();

describe.skipIf(skip)('inscrição em evento pela identidade — sala real', () => {
  beforeAll(async () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'pv-agenda-id-'));
    const file = pjoin(dir, 'agenda.json');
    writeFileSync(file, JSON.stringify(AGENDA));
    Object.assign(process.env, { PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_AGENDA_FILE: file, PV_AGENDA_EPOCH: 'now', PV_GRACE_S: String(GRACE_S) });
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
    // caminho fora do literal: o tsc da raiz não segue para os módulos do servidor com imports `.ts` (o vitest resolve)
    const srvMod = (m: string) => import(/* @vite-ignore */ `../server/src/${m}`);
    await srvMod('http/routes.ts');
    http = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    await Promise.race([gameServer?.close(), w(2000)]);
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('queda+reconexão mantém inscrição e checkpoint; login duplicado passa a inscrição sem duplicar; graça vencida desiste', async () => {
    const accA = await account('Aninha'), accB = await account('Bentinho');
    const A = await enter(accA.cookie, { x: -920, z: 437 });
    const B = await enter(accB.cookie, { x: -919, z: 433 });
    A.room.reconnection.minUptime = 0;
    await until(() => (A.msgs.agenda?.at(-1)?.list as AgendaEntry[] | undefined)?.find((e) => e.id === 'teste-id')?.state === 'REGISTRATION', 20000);
    const inst = (A.msgs.agenda.at(-1).list as AgendaEntry[]).find((e) => e.id === 'teste-id')!.inst;
    A.room.send('enter', { id: 'st14_0', seq: A.seq });
    B.room.send('enter', { id: 'st14_1', seq: B.seq });
    await until(() => A.msgs.enter_ok?.length && B.msgs.enter_ok?.length);
    A.x = A.msgs.enter_ok[0].x; A.z = A.msgs.enter_ok[0].z;
    A.room.send('evt_join', { inst }); B.room.send('evt_join', { inst });
    await until(() => A.msgs.evt_res?.length && B.msgs.evt_res?.length);
    expect(A.msgs.evt_res[0]).toMatchObject({ inst, ok: true });
    expect(B.msgs.evt_res[0]).toMatchObject({ inst, ok: true });
    await until(() => lastAgenda(A, inst)?.count === 2 && lastAgenda(A, inst)?.joined === true);

    // A vai à largada, larga e passa o 1º checkpoint (decidido pelo servidor)
    await drive(A, START);
    await until(() => A.msgs.race?.some((m: any) => m.t >= 0), 40000);
    await drive(A, CP1);
    await until(() => A.msgs.race?.at(-1)?.cp === 1);

    // ---- queda sem LEAVE consentido → graça → reconexão pelo token (mesmo sessionId)
    const sid = A.room.sessionId;
    const nAgenda = A.msgs.agenda.length, nRace = A.msgs.race.length;
    wsClose(A.room);
    await until(() => A.msgs.resume?.length, 8000);
    expect(A.room.sessionId).toBe(sid);
    await until(() => A.msgs.agenda.length > nAgenda && A.msgs.race.length > nRace + 1);
    expect(lastAgenda(A, inst)).toMatchObject({ joined: true, count: 2 });
    expect(A.msgs.race.at(-1)).toMatchObject({ inst, cp: 1 });
    expect(A.msgs.race.some((m: any) => m.status === 'dnf' || m.status === 'dq')).toBe(false);
    expect(A.msgs.race_def.length).toBeGreaterThanOrEqual(2); // o estado do formato veio de novo na volta

    // ---- a MESMA conta entra de novo (sessão e ticket novos): a nova assume, a inscrição vai junto
    const A2 = await enter(await login(accA.id), { x: -900, z: 420 });
    await until(() => A.msgs.session_replaced?.length);
    await until(() => lastAgenda(A2, inst)?.joined === true, 6000);
    expect(lastAgenda(A2, inst)!.count).toBe(2); // sem duplicar
    await until(() => A2.msgs.race?.length);
    expect(A2.msgs.race.at(-1)).toMatchObject({ inst, cp: 1, total: 2 });
    await until(() => A2.msgs.race_def?.length, 4000); // estado do formato na sessão nova (depois dos ouvintes)
    expect(A2.msgs.race_def[0]).toMatchObject({ inst });
    A2.room.send('evt_join', { inst });
    await until(() => A2.msgs.evt_res?.length);
    expect(A2.msgs.evt_res[0]).toMatchObject({ inst, ok: false, r: 'ja_inscrito' });
    expect(lastAgenda(B, inst)!.count).toBe(2);

    // ---- B cai e não volta: vencida a graça, desiste (DNF 'saiu'); a contagem cai
    B.room.reconnection.enabled = false;
    wsClose(B.room);
    await w(GRACE_S * 1000 + 600);
    await until(() => lastAgenda(A2, inst)?.count === 1, 4000);
    // A2 desiste pedindo (evt_leave): ninguém mais em prova → termina com resultado
    A2.room.send('evt_leave', { inst });
    await until(() => A2.msgs.evt_result?.length, 8000);
    const rows = A2.msgs.evt_result[0].rows as { name: string; status: string; reason?: string }[];
    expect(rows.find((r) => r.name === 'Bentinho')).toMatchObject({ status: 'dnf', reason: 'saiu' });
    expect(rows.find((r) => r.name === 'Aninha')).toMatchObject({ status: 'dnf', reason: 'desistiu' });
    expect(rows).toHaveLength(2);
  }, 120_000);
});
