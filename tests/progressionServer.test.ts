/**
 * Rodada 9 — progressão na sala REAL (Colyseus + API no mesmo processo, banco em memória, PV_TEST=1), conta real
 * (sessão → ticket → sala) e mensagens CRUAS do SDK:
 *   entra → recebe `prog` (só BEM-VINDO) → anda 40 m com movimentos forjados (validados) → missão conclui → teleporte
 *   do servidor de teste pelas 4 zonas → CONHEÇA A PRESIDENTE VARGAS conclui + subida de nível → tentativas do cliente
 *   (missão em destaque inexistente, `prog` forjado) não mudam nada → sai → banco tem o progresso (gravado na saída) →
 *   logout/login com sessão e conexão NOVAS → mesmo XP/missões/conquistas. Outro jogador não recebe o `prog` de ninguém.
 * PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { packMove } from '../src/net/rules';
import { pointOnAxis, type ZoneDefinition } from '../src/world/zones';
import type { ProgressionMessage, ProgressionNotice } from '../src/progression/types';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = 29100 + (process.pid % 400) * 2;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'resume', 'denied', 'chat_hello', 'chat', 'chat_mutes', 'spawn'];
const manifest = JSON.parse(readFileSync(new URL('../public/world/manifest.json', import.meta.url), 'utf8')) as { pvAxis: [number, number][] };
const zoneDefs = (JSON.parse(readFileSync(new URL('../public/world/zones.json', import.meta.url), 'utf8')) as { zones: ZoneDefinition[] }).zones;
const anchor = (id: string) => { const z = zoneDefs.find((d) => d.id === id)!; return pointOnAxis(manifest.pvAxis, z.anchor!.t, z.anchor!.side); };

interface Peer { room: Room; progs: ProgressionMessage[]; notes: ProgressionNotice[]; corrections: (number | string)[][]; seq: number }

let http: HttpServer, api = '';
let gameServer: { close(): Promise<void> } | null = null;
let store: import('../server/src/data/memory').MemoryDataStore;
let hashToken: (t: string) => string, COOKIE = '';
const peers: Peer[] = [];

async function account(nick: string) {
  const u = await store.users.create({ email: `${nick.toLowerCase()}@exemplo.test`, passwordHash: 'x' });
  await store.users.update(u.id, { emailVerified: true });
  await store.profiles.create({ userId: u.id, nickname: nick, nicknameKey: nick.toLowerCase() });
  await store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
  return { id: u.id };
}
async function login(userId: string) {
  const token = `tok-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}-sessao`;
  await store.sessions.create({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000), uaHash: null });
  return `${COOKIE}=${token}`;
}
async function enter(cookie: string, at: { x: number; z: number }): Promise<Peer> {
  const r = await fetch(`${api}/api/session/ticket`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ role: 'player' }) });
  const t = await r.json() as { ticket: string };
  const room = await new Client(`ws://127.0.0.1:${PORT}`).joinOrCreate('presidente_vargas', { ...APP, ticket: t.ticket, testSpawn: at });
  const p: Peer = { room, progs: [], notes: [], corrections: [], seq: 0 };
  for (const q of QUIET) room.onMessage(q, () => {});
  room.onMessage('*', () => {});
  room.onMessage('prog', (m: ProgressionMessage) => p.progs.push(m));
  room.onMessage('prog_ev', (n: ProgressionNotice) => p.notes.push(n));
  room.onMessage('correct', (c: (number | string)[]) => p.corrections.push(c));
  peers.push(p);
  return p;
}
const until = async (fn: () => unknown, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await w(40); } return false; };
const last = (p: Peer) => p.progs[p.progs.length - 1]?.p;

/** anda `meters` a partir de (x,z) na direção `h` com movimentos a 10 Hz dentro do limite de velocidade (o servidor valida) */
async function walk(p: Peer, from: { x: number; z: number }, h: number, meters: number) {
  const step = 1.1;
  let x = from.x, z = from.z;
  for (let d = 0; d < meters; d += step) {
    x += Math.sin(h) * step; z += Math.cos(h) * step;
    p.room.send('move', packMove({ x, y: 0.15, z, heading: h, speed: 5, loco: 1, seq: ++p.seq }));
    await w(100);
  }
  return { x, z };
}

describe.skipIf(skip)('progressão — sala real', () => {
  beforeAll(async () => {
    process.env.PV_TEST = '1';
    process.env.PV_STORE = 'memory';
    process.env.PV_GRAFFITI_STORE = 'memory';
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
    http = createServer(async (req, res) => { if (!(await router.handle(req, res))) { res.writeHead(404); res.end(); } });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const { listenGameServer } = await srvMod('testServer.ts') as { listenGameServer(port: number): Promise<{ close(): Promise<void> }> };
    gameServer = await listenGameServer(PORT);
  }, 60_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(peers.map((p) => p.room.leave())), w(1500)]);
    await Promise.race([gameServer?.close(), w(2000)]);
    await new Promise<void>((r) => http.close(() => r()));
  });

  it('anda e cruza as zonas → missão de exploração conclui → XP persiste após sair e entrar com sessão nova', async () => {
    const A = await account('Exploradora');
    const central = anchor('CENTRAL');
    const a = await enter(await login(A.id), central);
    const other = await enter(await login((await account('Vizinho')).id), { x: central.x + 4, z: central.z });
    expect(await until(() => a.progs.length > 0)).toBe(true);
    expect(a.progs[0].persistent).toBe(true);
    expect(last(a)!.active.map((m) => m.missionId)).toEqual(['boas_vindas']);
    expect(last(a)!.seen ?? []).not.toContain('welcome');

    // 40 m a pé (movimentos forjados, mas dentro da regra): BEM-VINDO + PRIMEIROS PASSOS
    await walk(a, central, central.heading, 40);
    expect(await until(() => last(a)?.completedMissions.includes('boas_vindas'))).toBe(true);
    expect(a.notes.some((n) => n.kind === 'mission' && n.id === 'boas_vindas')).toBe(true);
    expect(last(a)!.active.map((m) => m.missionId)).toEqual(expect.arrayContaining(['conheca_pv', 'entre_no_clima', 'mobilidade']));
    a.room.send('prog_seen', { k: 'welcome' });

    // pelas zonas (teleporte do SERVIDOR de teste; não conta distância)
    for (const z of ['CAMPO_DE_SANTANA', 'RIO_BRANCO', 'CANDELARIA', 'CENTRAL']) {
      const p = anchor(z);
      a.room.send('test_tp', { x: p.x, z: p.z });
      await w(2400); // histerese da zona (1,2 s) + 2 Hz
    }
    expect(await until(() => last(a)?.completedMissions.includes('conheca_pv'), 6000)).toBe(true);
    expect(a.corrections.filter((c) => c[4] === 'teleporte').length).toBe(4);
    const s = last(a)!;
    expect(s.level).toBeGreaterThanOrEqual(2);
    expect(s.achievements).toEqual(expect.arrayContaining(['primeiros_passos', 'inicio_ao_fim']));
    expect(s.unlocks).toContain('acc:bolsa');
    expect(a.notes.some((n) => n.kind === 'level')).toBe(true);
    expect(s.xp).toBe(50 + 25 + 200 + 100); // BEM-VINDO + PRIMEIROS PASSOS + CONHEÇA + DO INÍCIO AO FIM (sem XP da distância em si)

    // o cliente não manda em nada: missão em destaque inexistente, `prog`/XP forjados
    a.room.send('mission_track', { id: 'nao_existe' });
    a.room.send('prog_seen', { k: 'X'.repeat(400) });
    await w(700);
    expect(last(a)!.tracked ?? null).toBeNull();
    expect(last(a)!.xp).toBe(s.xp);
    expect(last(a)!.seen).toEqual(['welcome']);
    // o vizinho não recebeu nada da exploradora
    expect(other.progs.every((m) => m.p.xp === other.progs[0].p.xp)).toBe(true);
    expect(other.notes.filter((n) => n.id === 'conheca_pv')).toEqual([]);

    // sai (gravação na saída) → banco tem o progresso
    await a.room.leave();
    await w(400);
    const rec = await store.progression.load(A.id);
    expect(rec?.xp).toBe(s.xp);
    expect(rec?.completed.map((c) => c.missionId).sort()).toEqual(['boas_vindas', 'conheca_pv']);
    expect(rec?.grants.map((g) => g.item)).toEqual(expect.arrayContaining(['acc:bolsa', 'title:Conhece a avenida']));

    // logout/login: sessão (cookie) e conexão NOVAS → mesmo progresso
    const b = await enter(await login(A.id), central);
    expect(await until(() => b.progs.length > 0)).toBe(true);
    const r = last(b)!;
    expect(b.progs[0].persistent).toBe(true);
    expect(r.xp).toBe(s.xp);
    expect(r.level).toBe(s.level);
    expect(r.completedMissions.sort()).toEqual(['boas_vindas', 'conheca_pv']);
    expect(r.seen).toEqual(['welcome']);
    // API do editor: itens liberados da própria conta
    const me = await fetch(`${api}/api/me/progress`, { headers: { cookie: await login(A.id) } }).then((x) => x.json()) as { unlocks: string[]; xp: number };
    expect(me.unlocks).toContain('acc:bolsa');
    expect((await fetch(`${api}/api/me/progress`)).status).toBe(401);
  }, 60_000);
});
