/**
 * Rodada 9 — CONFRONTO com LATÊNCIA simulada no servidor REAL (subprocessos, PV_TEST=1, COLYSEUS_LATENCY 30/80/150 +
 * PV_JITTER): o acerto continua decidido no servidor (golpe pedido → janela ativa no relógio do servidor → cbt_hit);
 * o cliente não tem mensagem de acerto. Mede pedido → resultado. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const BASE_PORT = 29102 + (process.pid % 200) * 8;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'correct', 'chat_hello', 'chat', 'chat_mutes', 'mode_ok', 'mode_denied', 'knock', 'action', 'push_denied', 'act_denied', 'prop_denied'];
const DATA = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: { id: number; key: string }[]; dummies: { x: number; z: number; areaR: number }[] };
const ID = (k: string) => DATA.actions.find((a) => a.key === k)!.id;
const D = DATA.dummies[0];
/** dentro da área de treino (COMBAT) */
const IN = (dx: number, dz = 0) => ({ x: D.x + dx, z: D.z + dz });

interface Peer { room: Room; sid: string; msgs: { type: string; m: any }[]; nid: number }
const servers: ChildProcess[] = [];
const rooms: Room[] = [];

/** sobe o servidor; sob carga (suíte inteira + outros processos) a subida passa de 20 s, e a porta derivada do pid
 * pode estar ocupada por outra suíte em paralelo → até 45 s por tentativa e, se o processo morrer, outra porta */
async function startServer(port: number, env: Record<string, string> = {}, tries = 3): Promise<string> {
  const srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(port), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', PV_PROTECT_MS: '300', DATABASE_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  servers.push(srv);
  let ready = false, dead = false;
  srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
  srv.stderr!.on('data', () => {});
  srv.on('exit', () => { dead = true; });
  for (let i = 0; i < 450 && !ready && !dead; i++) await w(100);
  if (ready) return `ws://127.0.0.1:${port}`;
  if (!dead && srv.pid) { try { process.kill(-srv.pid, 'SIGTERM'); } catch { /* */ } }
  if (tries > 1) return startServer(port + 401, env, tries - 1);
  throw new Error('servidor de teste não subiu');
}

async function join(ep: string, name: string, at: { x: number; z: number }, o: Record<string, unknown> = {}): Promise<Peer> {
  const room = await new Client(ep).joinOrCreate('presidente_vargas', { ...APP, name, testSpawn: at, ...o });
  rooms.push(room);
  const p: Peer = { room, sid: room.sessionId, msgs: [], nid: 0 };
  for (const t of QUIET) room.onMessage(t, () => {});
  for (const t of ['cbt_act', 'cbt_hit', 'cbt_self', 'cbt_denied', 'cbt_dummy', 'jump_denied', 'denied', 'spawn']) room.onMessage(t, (m) => p.msgs.push({ type: t, m }));
  room.onMessage('*', () => {});
  for (let i = 0; i < 50 && !p.msgs.some((x) => x.type === 'spawn'); i++) await w(40);
  return p;
}
/** modo interação (consentimento) e o nid do jogador pelo estado sincronizado */
async function ready(...ps: Peer[]) {
  for (const p of ps) p.room.send('mode', 'interacao');
  await w(700);
  for (const p of ps) {
    for (const q of ps) {
      const st = (q.room.state as { players: Map<string, { nid: number }> }).players.get(p.sid);
      if (st?.nid) p.nid = st.nid;
    }
  }
}
const of = (p: Peer, type: string) => p.msgs.filter((x) => x.type === type).map((x) => x.m);
const until = async (fn: () => unknown, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await w(30); } return false; };
const lastSelf = (p: Peer) => of(p, 'cbt_self').at(-1) as { st: number; cd: number; fx: number } | undefined;
const cbt = (p: Peer, a: number, h: number, extra: Record<string, unknown> = {}) => p.room.send('cbt', { a, h, seq: 1, ...extra });
/** manda um movimento (move compacto) — mantém o rumo e a posição no servidor */
let seqN = 100;
const move = (p: Peer, at: { x: number; z: number }, h: number, y = 0, loco = 0) => p.room.send('move', [at.x, y, at.z, h, 0, loco, ++seqN]);

describe.skipIf(skip)('confronto com latência simulada — acerto decidido no servidor', () => {
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    for (const s of servers) if (s.pid) { try { process.kill(-s.pid, 'SIGTERM'); } catch { /* */ } }
  });
  it.each([30, 80, 150])('RTT %i ms (+ jitter): soco acerta pelo servidor; tempo pedido→resultado ≈ RTT + preparação', async (lat) => {
    const ep = await startServer(BASE_PORT + [30, 80, 150].indexOf(lat) * 2, { COLYSEUS_LATENCY: String(lat), PV_JITTER: String(Math.round(lat / 5)) });
    const A = await join(ep, `A${lat}`, IN(3)), B = await join(ep, `B${lat}`, IN(3, 1.1));
    await ready(A, B); await w(500 + lat);
    move(A, IN(3), 0);
    await w(lat);
    const t0 = Date.now();
    cbt(A, ID('soco'), 0);
    expect(await until(() => of(A, 'cbt_hit').some((h) => h.tgt === B.nid && h.r === 'hit'), 3000)).toBe(true);
    const ms = Date.now() - t0;
    expect(await until(() => lastSelf(B)?.cd === 88, 2000)).toBe(true);
    // windup 120 ms + ida e volta: o resultado nunca chega antes do servidor decidir
    expect(ms).toBeGreaterThanOrEqual(lat * 0.9 + 100);
    expect(ms).toBeLessThan(lat * 2 + 900);
    console.log(`[latência] RTT ${lat} ms → pedido→cbt_hit ${ms} ms`);
  }, 150_000);
});
