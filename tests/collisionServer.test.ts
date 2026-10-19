/**
 * Rodada 12 — COLISÃO ENTRE CORPOS no servidor REAL (subprocesso, PV_TEST=1, banco em memória) com clientes do SDK
 * FORJADOS (mandam movimentos crus, sem a colisão do cliente): A anda contra B e o servidor não deixa atravessar;
 * spawn em ponto ocupado vai para ponto livre; "unstuck" só quando preso de verdade; encostado (0,64 m) o soco acerta;
 * /metrics expõe collisionMs e neighborQueries. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { BODY } from '../src/physics/bodies';
import { freePortBlock } from './fixtures/freePort';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const PORT = await freePortBlock(4);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'mode_ok', 'mode_denied', 'knock', 'action', 'push_denied', 'act_denied', 'prop_denied', 'cbt_act', 'cbt_self', 'cbt_dummy', 'items', 'prog', 'ads', 'evt'];
const SPAWN = (JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { spawn: { p: [number, number] } }).spawn;
const DATA = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: { id: number; key: string }[] };
const ID = (k: string) => DATA.actions.find((a) => a.key === k)!.id;
/** área livre perto do spawn (testes em pontos distintos não se encostam) */
const AT = (dx: number, dz = 0) => ({ x: SPAWN.p[0] + 6 + dx, z: SPAWN.p[1] + dz });

interface Peer { room: Room; sid: string; msgs: { type: string; m: any }[]; seq: number }
let srv: ChildProcess | null = null;
const rooms: Room[] = [];

async function join(ep: string, name: string, at: { x: number; z: number }): Promise<Peer> {
  const room = await new Client(ep).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at });
  rooms.push(room);
  const p: Peer = { room, sid: room.sessionId, msgs: [], seq: 0 };
  for (const t of QUIET) room.onMessage(t, () => {});
  for (const t of ['correct', 'spawn', 'unstuck_denied', 'cbt_hit', 'cbt_denied']) room.onMessage(t, (m) => p.msgs.push({ type: t, m }));
  room.onMessage('*', () => {});
  for (let i = 0; i < 60 && !p.msgs.some((x) => x.type === 'spawn'); i++) await w(40);
  return p;
}
const of = (p: Peer, type: string) => p.msgs.filter((x) => x.type === type).map((x) => x.m);
const pos = (viewer: Peer, who: Peer) => { const s = (viewer.room.state as { players: Map<string, { x: number; z: number }> }).players.get(who.sid)!; return { x: s.x, z: s.z }; };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const move = (p: Peer, at: { x: number; z: number }, h = 0) => p.room.send('move', [at.x, 0, at.z, h, 1.4, 1, ++p.seq + 1000]);
/** anda (cliente forjado, sem colisão local) em passos de 0,14 m a cada 100 ms; segue a correção do servidor */
async function walk(p: Peer, from: { x: number; z: number }, to: { x: number; z: number }, steps: number) {
  let cur = { ...from };
  let n0 = of(p, 'correct').length;
  for (let i = 0; i < steps; i++) {
    const dx = to.x - cur.x, dz = to.z - cur.z, l = Math.hypot(dx, dz);
    if (l < 0.02) break;
    const st = Math.min(l, 0.14);
    cur = { x: cur.x + (dx / l) * st, z: cur.z + (dz / l) * st };
    move(p, cur, Math.atan2(dx, dz));
    await w(100);
    const c = of(p, 'correct');
    if (c.length > n0) { n0 = c.length; const last = c.at(-1) as number[]; cur = { x: last[0], z: last[2] }; }
  }
  return cur;
}

describe.skipIf(skip)('colisão entre corpos — servidor real, cliente forjado', () => {
  let ep = '';
  beforeAll(async () => {
    srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(PORT), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', PV_PROTECT_MS: '300', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let ready = false;
    srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
    srv.stderr!.on('data', () => {});
    for (let i = 0; i < 200 && !ready; i++) await w(100);
    if (!ready) throw new Error('servidor de teste não subiu');
    ep = `ws://127.0.0.1:${PORT}`;
  }, 40_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    if (srv?.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('A anda contra B parado e NÃO atravessa: o servidor corrige (motivo "corpo"); B não é empurrado', async () => {
    const A = await join(ep, 'Ana', AT(0, 0)), B = await join(ep, 'Beto', AT(0, 3));
    await w(300);
    const b0 = pos(A, B);
    const end = await walk(A, AT(0, 0), AT(0, 6), 50);
    await w(300);
    const a = pos(A, A), b = pos(A, B);
    expect(of(A, 'correct').some((c) => c[4] === 'corpo')).toBe(true);
    expect(a.z).toBeLessThan(b.z); // ficou do lado de cá
    expect(dist(a, b)).toBeGreaterThanOrEqual(2 * BODY.radius - BODY.serverTolerance - 0.02);
    expect(dist(end, b)).toBeGreaterThanOrEqual(2 * BODY.radius - BODY.serverTolerance - 0.02);
    expect(dist(b, b0)).toBeLessThan(1e-3); // quem está parado nunca é corrigido nem empurrado
    expect(of(B, 'correct').filter((c) => c[4] === 'corpo')).toEqual([]);
  }, 20_000);

  it('na diagonal o servidor deixa deslizar pela tangente (não trava seco)', async () => {
    const A = await join(ep, 'Caio', AT(8, 0)), B = await join(ep, 'Dani', AT(8.45, 1.5)) // a reta de A passa a 0,3 m do centro de B;
    await w(300);
    await walk(A, AT(8, 0), AT(8.4, 4), 60);
    await w(300);
    const a = pos(A, A), b = pos(A, B);
    expect(a.z).toBeGreaterThan(b.z + 0.5); // passou por B contornando
  }, 20_000);

  it('10 corpos fechando um corredor: quem tenta atravessar a fila fica do lado de cá', async () => {
    const wall = [] as Peer[];
    for (let i = 0; i < 10; i++) wall.push(await join(ep, `Fila${i}`, AT(40 - 3.2 + i * 0.72, 3)));
    const A = await join(ep, 'Kiko', AT(40, 0));
    await w(400);
    await walk(A, AT(40, 0), AT(40.2, 7), 60);
    await w(300);
    const a = pos(A, A);
    expect(a.z).toBeLessThan(AT(0, 3).z); // não passou da fila
    for (const q of wall) expect(dist(a, pos(A, q))).toBeGreaterThanOrEqual(2 * BODY.radius - BODY.serverTolerance - 0.02);
  }, 30_000);

  it('spawn em ponto OCUPADO vai para um ponto livre próximo', async () => {
    const P = AT(16, 0);
    const A = await join(ep, 'Eva', P);
    await w(250);
    const B = await join(ep, 'Fabi', P), C = await join(ep, 'Gil', P);
    await w(400);
    const a = pos(A, A), b = pos(A, B), c = pos(A, C);
    expect(dist(a, P)).toBeLessThan(1e-3); // o primeiro fica onde pediu (posição em float32 no estado)
    for (const [u, v] of [[a, b], [a, c], [b, c]] as const) expect(dist(u, v)).toBeGreaterThanOrEqual(2 * BODY.radius);
    expect(dist(b, P)).toBeLessThan(2.5); expect(dist(c, P)).toBeLessThan(2.5);
  }, 20_000);

  it('"unstuck": negado quando não está preso; cercado por 3 corpos, vai para um ponto livre', async () => {
    const C0 = AT(24, 0);
    const A = await join(ep, 'Hugo', C0);
    A.room.send('unstuck', 1);
    expect(await (async () => { for (let i = 0; i < 40; i++) { if (of(A, 'unstuck_denied').length) return true; await w(50); } return false; })()).toBe(true);
    const ring = [0, 1, 2].map((i) => ({ x: C0.x + Math.cos((i / 3) * Math.PI * 2) * 0.72, z: C0.z + Math.sin((i / 3) * Math.PI * 2) * 0.72 }));
    for (const [i, r] of ring.entries()) await join(ep, `Cerca${i}`, r);
    await w(400);
    A.room.send('unstuck', 1);
    let fixed: number[] | undefined;
    for (let i = 0; i < 40 && !fixed; i++) { fixed = of(A, 'correct').find((c) => c[4] === 'livre'); await w(50); }
    expect(fixed).toBeTruthy();
    const a = pos(A, A);
    expect(dist(a, C0)).toBeGreaterThan(0.6);
    expect(dist(a, C0)).toBeLessThan(6.5);
  }, 20_000);

  it('combate: dois corpos ENCOSTADOS (0,64 m) — o soco acerta; colisão não impede acerto legítimo', async () => {
    const A = await join(ep, 'Igor', AT(32, 0)), B = await join(ep, 'Juli', AT(32, 2 * BODY.radius + 0.01));
    await w(500); // proteção (PV_PROTECT_MS = 300)
    move(A, AT(32, 0), 0);
    await w(150);
    A.room.send('cbt', { a: ID('soco'), h: 0, seq: A.seq + 1000 });
    let hit = false;
    for (let i = 0; i < 40 && !hit; i++) { hit = of(B, 'cbt_hit').some((h) => h.r === 'hit'); await w(50); }
    expect(hit).toBe(true);
  }, 20_000);

  it('/metrics expõe o custo da colisão (collisionMs, neighborQueries, corpos)', async () => {
    await fetch(`http://127.0.0.1:${PORT + 1}/metrics`); // abre a janela deste consumidor
    await w(1500);
    const m = await (await fetch(`http://127.0.0.1:${PORT + 1}/metrics`)).json() as Record<string, number>;
    expect(m).toHaveProperty('collisionMs');
    expect(m).toHaveProperty('neighborQueries');
    expect(m.collisionBodies).toBeGreaterThanOrEqual(8);
    expect(m.neighborQueriesPerSec).toBeGreaterThanOrEqual(0);
  }, 10_000);
});
