/**
 * Rodada 12 — bots densos do QA de colisão (tools/qa/collision_mp.mjs). Clientes reais do SDK (bot: true), sem
 * navegador, num servidor de TESTE (PV_TEST=1, testSpawn):
 *   wall  N corpos em 3 fileiras atravessando o caminho (z = cz), parados — "30 pessoas fechando a passagem"
 *   flow  N corpos atravessando de z = cz − 9 para cz + 9 por cima do ponto (cx, cz), com o DESVIO LOCAL suavizado
 *         (steerAround, src/physics/bodyResolve.ts — o mesmo que os autônomos usam) + constrainMove contra todos os
 *         corpos do estado
 * Imprime READY quando todos entraram; ao final (segundos) imprime um JSON de medidas e sai.
 * uso: npx tsx tools/qa/collision_bots.ts <ws://…> <wall|flow> <cx> <cz> <N> <segundos>
 */
import { Client, type Room } from '@colyseus/sdk';
import { packMove } from '../../src/net/rules';
import { BODY, type BodyRef } from '../../src/physics/bodies';
import { constrainMove, steerAround } from '../../src/physics/bodyResolve';
import { DEFAULT_PLAYER_APPEARANCE } from '../../src/characters/bodyTypes';

const [ep, mode, cxs, czs, ns, ss] = process.argv.slice(2);
const cx = Number(cxs), cz = Number(czs), N = Number(ns), SECS = Number(ss);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface B { room: Room; x: number; z: number; h: number; seq: number; tx: number; tz: number; done: boolean; minD: number; corr: number }
const bots: B[] = [];

for (let i = 0; i < N; i++) {
  let x: number, z: number, tx: number, tz: number;
  if (mode === 'wall') {
    const row = i % 3, col = Math.floor(i / 3), cols = Math.ceil(N / 3);
    x = cx + (col - (cols - 1) / 2) * 0.72 + (row % 2) * 0.36; z = cz + row * 0.66; tx = x; tz = z;
  } else {
    const col = i % 4, row = Math.floor(i / 4);
    x = cx + (col - 1.5) * 0.9; z = cz - 9 - row * 1.6; tx = cx + (col - 1.5) * 0.9; tz = cz + 9 + row * 1.6;
  }
  const TOPS = [0x2f6f8f, 0xd23c3c, 0xe8c547, 0x3c9a5a, 0xe8e6e0, 0x8c4a9e, 0xf08a3c, 0x222222];
  // fluxo: só corpos 'homem'/'mulher' (LOD de perto já carregado no cliente do QA — os outros corpos aparecem só depois
  // que o LOD alto baixa, e o fluxo chega perto antes disso)
  const bodies = mode === 'flow' ? (['homem', 'mulher'] as const) : (['homem', 'mulher', 'idoso', 'idosa'] as const);
  const app = { ...DEFAULT_PLAYER_APPEARANCE[bodies[i % bodies.length]], top: TOPS[i % TOPS.length] };
  const room = await new Client(ep).joinOrCreate('presidente_vargas', { ...app, accessory: 'nenhum', name: `${mode}${i}`, testSpawn: { x, z }, bot: true });
  for (const t of ['crowd', 'gf', 'gf_del', 'gf_res', 'pong', 'chat_hello', 'chat', 'chat_mutes', 'items', 'prog', 'ads', 'evt', 'spawn', 'cbt_self', 'cbt_act', 'cbt_dummy', 'knock', 'action']) room.onMessage(t, () => {});
  room.onMessage('*', () => {});
  const b: B = { room, x, z, h: Math.atan2(tx - x, tz - z), seq: 0, tx, tz, done: false, minD: Infinity, corr: 0 };
  room.onMessage('correct', (c: number[]) => { b.x = c[0]; b.z = c[2]; b.corr++; });
  bots.push(b);
}
await w(800);
console.log('READY');

const near: BodyRef[] = [];
const t0 = Date.now();
let last = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  const now = Date.now(), dt = Math.min(0.2, (now - last) / 1000); last = now;
  for (const b of bots) {
    if (mode === 'flow') {
      // corpos conhecidos pelo estado sincronizado deste bot (humanos e os outros bots)
      near.length = 0;
      (b.room.state as { players: Map<string, { x: number; z: number }> }).players.forEach((p, id) => { if (id !== b.room.sessionId && Math.hypot(p.x - b.x, p.z - b.z) < 3) near.push({ id, x: p.x, z: p.z, r: BODY.radius }); });
      for (const n of near) b.minD = Math.min(b.minD, Math.hypot(n.x - b.x, n.z - b.z));
      const dx = b.tx - b.x, dz = b.tz - b.z, l = Math.hypot(dx, dz);
      if (b.z >= cz + 6) b.done = true; // atravessou (passou 6 m além do ponto central)
      if (l < 0.5) continue;
      const st = steerAround(b.room.sessionId, b.x, b.z, dx / l, dz / l, near, 1.1);
      const v = 1.25 * st.speed;
      // desvio (steerAround) + a mesma restrição de corpo do jogador local (constrainMove): ninguém entra em ninguém
      const c = constrainMove(b.room.sessionId, BODY.radius, b.x, b.z, b.x + st.dx * v * dt, b.z + st.dz * v * dt, near, dt);
      b.x = c.x; b.z = c.z; b.h = Math.atan2(st.dx, st.dz);
      b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: v, loco: 1, seq: ++b.seq }));
    } else if ((now / 100 | 0) % 3 === 0) b.room.send('move', packMove({ x: b.x, y: 0, z: b.z, heading: b.h, speed: 0, loco: 0, seq: ++b.seq }));
  }
  await w(66);
}
console.log(JSON.stringify({ mode, n: N, done: bots.filter((b) => b.done).length, corrections: bots.reduce((a, b) => a + b.corr, 0), minD: Math.min(...bots.map((b) => b.minD)), stuck: bots.filter((b) => !b.done).map((b) => [+(b.x - cx).toFixed(2), +(b.z - cz).toFixed(2)]) }));
await Promise.race([Promise.allSettled(bots.map((b) => b.room.leave())), w(2000)]);
process.exit(0);
