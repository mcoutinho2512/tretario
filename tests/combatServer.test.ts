/**
 * Rodada 9 — CONFRONTO no servidor REAL (subprocesso, PV_TEST=1, banco em memória, evento 'cotidiano' = interação
 * opcional) com clientes do SDK mandando mensagens CRUAS (cliente forjado). Tudo abaixo tem de ser NEGADO/ignorado:
 *   golpe a 100 m · golpe atravessando zona de paz · 30 pedidos/s · item que não está na mão · campos alvo/dano
 *   forjados · ignorar stamina e cooldown · teleporte e golpe · espectador golpeando · pulo no ar / cooldown / y forjado
 * Latência simulada: tests/combatLatency.test.ts. PV_SKIP_NET_TESTS=1 pula.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, type Room } from '@colyseus/sdk';
import { pointOnAxis } from '../src/world/zones';
import { decodeItemList, type ItemView } from '../src/items/protocol';

const skip = process.env.PV_SKIP_NET_TESTS === '1';
const BASE_PORT = 29100 + (process.pid % 200) * 8;
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };
const QUIET = ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'correct', 'chat_hello', 'chat', 'chat_mutes', 'mode_ok', 'mode_denied', 'knock', 'action', 'push_denied', 'act_denied', 'prop_denied'];
const RACKS = (JSON.parse(readFileSync('public/gameplay/combat_props.json', 'utf8')) as { supply: { racks: { at: { t: number; side?: number } }[] } }).supply.racks;
const AXIS = (JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { pvAxis: [number, number][] }).pvAxis;
const SPAWN = (JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as { spawn: { p: [number, number] } }).spawn;
const DATA = JSON.parse(readFileSync('public/gameplay/combat.json', 'utf8')) as { actions: { id: number; key: string }[]; dummies: { x: number; z: number; areaR: number }[] };
const ID = (k: string) => DATA.actions.find((a) => a.key === k)!.id;
const D = DATA.dummies[0];
/** dentro da área de treino (COMBAT) e fora dela (PAZ: zonas sem política) */
const IN = (dx: number, dz = 0) => ({ x: D.x + dx, z: D.z + dz });

interface Peer { room: Room; sid: string; msgs: { type: string; m: any }[]; nid: number }
const servers: ChildProcess[] = [];
const rooms: Room[] = [];

async function startServer(port: number, env: Record<string, string> = {}) {
  const srv = spawn('npx', ['tsx', 'src/index.ts'], { cwd: 'server', env: { ...process.env, PORT: String(port), PV_TEST: '1', PV_STORE: 'memory', PV_GRAFFITI_STORE: 'memory', PV_EVENT: 'cotidiano', PV_PROTECT_MS: '300', DATABASE_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  servers.push(srv);
  let ready = false;
  srv.stdout!.on('data', (d) => { if (String(d).includes('[pv3d-server]')) ready = true; });
  srv.stderr!.on('data', () => {});
  for (let i = 0; i < 200 && !ready; i++) await w(100);
  if (!ready) throw new Error('servidor de teste não subiu');
  return `ws://127.0.0.1:${port}`;
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
/** rumo de a para b (0 = +z) */
const heading = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);
/** manda um movimento (move compacto) — mantém o rumo e a posição no servidor */
let seqN = 100;
const move = (p: Peer, at: { x: number; z: number }, h: number, y = 0, loco = 0) => p.room.send('move', [at.x, y, at.z, h, 0, loco, ++seqN]);

describe.skipIf(skip)('confronto — servidor real, cliente forjado', () => {
  let ep = '';
  beforeAll(async () => { ep = await startServer(BASE_PORT); }, 40_000);
  afterAll(async () => {
    await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(1500)]);
    for (const s of servers) if (s.pid) { try { process.kill(-s.pid, 'SIGTERM'); } catch { /* */ } }
  });

  it('golpe a 100 m, com alvo/dano forjados: ninguém sofre impacto além do alcance', async () => {
    const A = await join(ep, 'A1', IN(2)), B = await join(ep, 'B1', IN(2, 1.1)), C = await join(ep, 'C1', IN(-100 + 2 - D.areaR, 0));
    await ready(A, B, C);
    await w(400); // proteção (PV_PROTECT_MS = 300)
    move(A, IN(2), heading(IN(2), IN(2, 1.1)));
    cbt(A, ID('soco'), heading(IN(2), IN(2, 1.1)), { target: C.sid, tgt: C.nid, damage: 999, condition: 0, x: IN(-100).x, z: IN(-100).z });
    expect(await until(() => of(B, 'cbt_hit').some((h) => h.tgt === B.nid && h.r === 'hit'))).toBe(true);
    await w(300);
    // o alvo real (perto, na frente) perde só a condição da definição; C (100 m) nada
    expect(lastSelf(B)?.cd).toBe(100 - 12);
    expect(of(C, 'cbt_hit').filter((h) => h.tgt === C.nid)).toEqual([]);
    expect(lastSelf(C)?.cd ?? 100).toBe(100);
    // só C na mira (B fora do arco): virado para C a 100 m → nada
    await w(600);
    cbt(A, ID('soco'), heading(IN(2), C.msgs.length ? IN(-100) : IN(-100)));
    await w(600);
    expect(of(C, 'cbt_hit').filter((h) => h.tgt === C.nid)).toEqual([]);
  });

  it('golpe atravessando zona de paz: atacante em paz → zona_paz; alvo fora da área de treino → sem impacto', async () => {
    // atacante numa zona de PAZ de verdade (spawn: zona CENTRAL PEACE + área de paz do spawn — dados do agente B)
    const SPN = { x: SPAWN.p[0] + 6, z: SPAWN.p[1] };
    const A = await join(ep, 'A2', SPN), B = await join(ep, 'B2', { x: SPN.x, z: SPN.z + 1.1 });
    await ready(A, B); await w(400);
    cbt(A, ID('soco'), 0);
    expect(await until(() => of(A, 'cbt_denied').some((d) => d.reason === 'zona_paz'))).toBe(true);
    expect(of(A, 'cbt_act')).toEqual([]);
    // borda: A dentro da área de treino, B 1,2 m para fora dela (zona de paz)
    const edge = { x: D.x + D.areaR - 0.4, z: D.z }, out = { x: D.x + D.areaR + 0.8, z: D.z };
    const E = await join(ep, 'E2', edge), F = await join(ep, 'F2', out);
    await ready(E, F); await w(400);
    move(E, edge, heading(edge, out));
    cbt(E, ID('soco'), heading(edge, out));
    expect(await until(() => of(E, 'cbt_hit').some((h) => h.r === 'blocked'))).toBe(true);
    // fora da área de treino vale a política da zona (aqui CONTESTED sem evento): golpe `blocked`, nenhum impacto
    expect(lastSelf(F)?.cd ?? 100).toBe(100);
  }, 15_000);

  it('30 pedidos/s: só maxRequestsPerS processados, o resto "spam" (aviso ≤ 1/s)', async () => {
    const A = await join(ep, 'A3', IN(-4, 6));
    await ready(A); await w(400);
    for (let i = 0; i < 30; i++) { cbt(A, ID('esquiva'), 0); await w(33); }
    await w(400);
    const acts = of(A, 'cbt_act').length, denied = of(A, 'cbt_denied').map((d) => d.reason);
    expect(acts).toBeLessThanOrEqual(2);
    expect(denied.filter((r) => r === 'spam').length).toBeGreaterThanOrEqual(1);
    expect(denied.filter((r) => r === 'spam').length).toBeLessThanOrEqual(2);
    expect(denied.filter((r) => r === 'cooldown').length).toBeGreaterThan(0);
  });

  it('item que não está na mão: golpe de taco/barra/spray negado (sem_item); com o taco, aceito', async () => {
    const A = await join(ep, 'A4', IN(-4, -6));
    await ready(A); await w(400);
    for (const k of ['golpe_taco', 'golpe_barra', 'spray']) { cbt(A, ID(k), 0); await w(250); }
    expect(of(A, 'cbt_denied').map((d) => d.reason)).toEqual(['sem_item', 'sem_item', 'sem_item']);
    // declarar o taco na mão sem tê-lo pego não adianta (itens de confronto: posse no servidor — server/src/items)
    A.room.send('prop', { p: 11, d: 0 });
    await w(300);
    cbt(A, ID('golpe_taco'), 0);
    await w(300);
    expect(of(A, 'cbt_act').some((a) => a.a === ID('golpe_taco'))).toBe(false);
    // pegando o taco de verdade num ponto de apoio (Cidade Nova, zona COMBAT), o golpe é aceito
    const rack = RACKS[0], pt = pointOnAxis(AXIS, rack.at.t, rack.at.side ?? 0);
    const P = await join(ep, 'P4', { x: pt.x + 1, z: pt.z });
    const lists: ItemView[][] = [];
    P.room.onMessage('item_list', (m) => { const l = decodeItemList(m); if (l) lists.push(l); });
    for (const t of ['item_self', 'item_denied']) P.room.onMessage(t, (m) => P.msgs.push({ type: t, m }));
    await ready(P);
    expect(await until(() => lists.some((l) => l.some((it) => it.prop === 11)))).toBe(true);
    const bat = lists.flat().find((it) => it.prop === 11)!;
    P.room.send('item_pick', { i: bat.id });
    expect(await until(() => of(P, 'item_self').some((m) => m.c === 11))).toBe(true);
    P.room.send('prop', { p: 11, d: 0 });
    await w(300);
    cbt(P, ID('golpe_taco'), 0);
    expect(await until(() => of(P, 'cbt_act').some((a) => a.a === ID('golpe_taco')))).toBe(true);
  }, 15_000);

  it('ignorar stamina e cooldown: o servidor nega (cooldown, depois stamina)', async () => {
    const A = await join(ep, 'A5', IN(4, -6));
    await ready(A); await w(400);
    cbt(A, ID('chute'), 0); await w(150); cbt(A, ID('chute'), 0);
    expect(await until(() => of(A, 'cbt_denied').some((d) => d.reason === 'cooldown'))).toBe(true);
    for (let i = 0; i < 8; i++) { await w(950); cbt(A, ID('esquiva'), (i % 4) * 1.5); }
    expect(await until(() => of(A, 'cbt_denied').some((d) => d.reason === 'stamina'))).toBe(true);
  }, 20_000);

  it('teleporte e golpe: o movimento é preso pela velocidade e o golpe sai da posição do servidor', async () => {
    const A = await join(ep, 'A6', IN(10, 2)), T = await join(ep, 'T6', IN(-10, 2));
    await ready(A, T); await w(400);
    const near = { x: IN(-10, 2).x, z: IN(-10, 2).z - 1.0 };
    move(A, near, 0); // 19 m num movimento: servidor corrige (too_fast)
    cbt(A, ID('soco'), 0);
    await w(700);
    expect(of(T, 'cbt_hit').filter((h) => h.tgt === T.nid)).toEqual([]);
    expect(lastSelf(T)?.cd ?? 100).toBe(100);
  });

  it('espectador não golpeia nem pula (denied); cliente não tem mensagem de acerto', async () => {
    const S = await new Client(ep).joinOrCreate('presidente_vargas', { ...APP, role: 'spectator', specCam: IN(0) });
    rooms.push(S);
    const denied: string[] = [];
    for (const t of QUIET) S.onMessage(t, () => {});
    S.onMessage('*', () => {});
    S.onMessage('denied', (d: { cap: string }) => denied.push(d.cap));
    S.send('cbt', { a: ID('soco'), h: 0 });
    S.send('jump', { seq: 1 });
    await w(500);
    expect(denied.sort()).toEqual(['combat.act', 'world.play']);
    // "cbt_hit" vindo do cliente não existe no servidor (nenhum efeito)
    const A = await join(ep, 'A7', IN(-6, -2)), B = await join(ep, 'B7', IN(-6, -0.9));
    await ready(A, B); await w(400);
    A.room.send('cbt_hit', { by: A.nid, tgt: B.nid, a: ID('chute_final'), r: 'hit', dx: 0, dz: 1, st: 1 });
    await w(400);
    expect(of(B, 'cbt_hit')).toEqual([]);
    expect(lastSelf(B)?.cd ?? 100).toBe(100);
  });

  it('pulo: no ar e cooldown negados; y forjado sem pulo é preso ao chão', async () => {
    const A = await join(ep, 'A8', IN(6, 6)), B = await join(ep, 'B8', IN(6, 7.5));
    await ready(A, B);
    const at = IN(6, 6);
    move(A, at, 0, 0, 0);
    await w(120);
    A.room.send('jump', { seq: 1 });
    await w(80);
    A.room.send('jump', { seq: 2 }); // no ar
    move(A, at, 0, 0.5, 3);
    await w(800);
    move(A, at, 0, 0, 0); // pousou
    await w(80);
    A.room.send('jump', { seq: 3 }); // cooldown
    await w(300);
    expect(of(A, 'jump_denied').map((d) => d.reason)).toEqual(['no_ar', 'cooldown']);
    // y forjado: 10 m sem pulo → o servidor guarda no máximo um degrau acima do chão
    await w(900);
    move(A, at, 0, 10, 1);
    await w(400);
    const y = (B.room.state as { players: Map<string, { y: number }> }).players.get(A.sid)!.y;
    expect(y).toBeLessThanOrEqual(0.25);
  });
});

