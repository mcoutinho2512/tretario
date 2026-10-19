/**
 * Rodada 12 — CUSTO dos personagens autônomos: `npx tsx server/tools/autonomous_bench.ts [segundos]`.
 *  1) sala REAL no mesmo processo (Colyseus, PV_TEST=1) com 50/100/250 autônomos + 1 pessoa e 8 bots de carga
 *     espalhados pela avenida (todos com AOI/patches de verdade): /metrics aiMs (decisão/movimento/social), tick, patch,
 *     decisões/s e ativos por LOD;
 *  2) só o sistema (SimHost, sem rede) com as mesmas populações — o custo puro da IA.
 * Grava docs/bench/round12_autonomous.json (PV_OUT muda o arquivo).
 */
import '../src/polyfills.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, type Room } from '@colyseus/sdk';
import { MemoryDataStore } from '../src/data/memory.ts';
import { TicketService } from '../src/identity/tickets.ts';
import { setServices } from '../src/services.ts';
import { runHumanization } from '../src/autonomous/report.ts';

const SECS = Number(process.argv[2] ?? 20);
const w = (ms: number) => new Promise((r) => setTimeout(r, ms));
process.env.PV_TEST = '1'; process.env.PV_STORE = 'memory'; process.env.PV_GRAFFITI_STORE = 'memory';
process.env.PV_LOG_LEVEL = process.env.PV_LOG_LEVEL ?? 'warn';
setServices({ store: new MemoryDataStore(), tickets: new TicketService() });
const { listenGameServer } = await import('../src/testServer.ts');
const { metrics } = await import('../src/metrics.ts');
const { liveRooms } = await import('../src/PresidenteVargasRoom.ts');
const APP = { body: 'homem', skin: 1, hair: 1, top: 1, bottom: 1, shoes: 1 };

async function realRoom(n: number, port: number) {
  process.env.PV_AUTONOMOUS = String(n);
  const srv = await listenGameServer(port);
  const rooms: Room[] = [];
  const join = async (opts: Record<string, unknown>) => { const r = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('presidente_vargas', { ...APP, ...opts }); r.onMessage('*', () => {}); rooms.push(r); return r; };
  const human = await join({ name: 'Pessoa', testSpawn: { x: -560, z: 300 } });
  const room = [...liveRooms].find((r) => (r as unknown as { roomId: string }).roomId === human.roomId) as unknown as { auto: { axis: { len: number; at(s: number, l: number): { x: number; z: number } } } };
  const A = room.auto.axis;
  for (let i = 0; i < 8; i++) { const p = A.at(A.len * (i + 0.5) / 8, 6); await join({ name: `Carga${i}`, bot: true, testSpawn: { x: p.x, z: p.z } }); }
  await w(4000); // aquecimento: aparecem, primeiras decisões
  metrics.sample('bench-auto');
  await w(SECS * 1000);
  const m = metrics.sample('bench-auto');
  await Promise.race([Promise.allSettled(rooms.map((r) => r.leave())), w(3000)]);
  await Promise.race([srv.close(), w(3000)]);
  const pick = ['players', 'tickAvgMs', 'tickMaxMs', 'patchAvgMs', 'aoiAvgMs', 'aiMs', 'aiMaxMs', 'aiDecideMs', 'aiMoveMs', 'aiSocialMs', 'aiDecisionsPerSec', 'autonomousPopulation', 'autonomousActive', 'autonomousNear', 'autonomousMid', 'autonomousFar', 'autonomousDormant', 'bytesOutPerSec', 'cpuPct', 'heapMB'];
  return Object.fromEntries(pick.map((k) => [k, m[k]]));
}

const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), tool: 'server/tools/autonomous_bench.ts', seconds: SECS, machine: process.platform + ' ' + process.arch + ' node ' + process.version, real: {}, simOnly: {} };
let port = 4340;
for (const n of [50, 100, 250]) {
  (out.real as Record<string, unknown>)[n] = await realRoom(n, port);
  port += 2;
  console.log(`sala real ${n}:`, JSON.stringify((out.real as Record<string, unknown>)[n]));
}
for (const n of [50, 100, 250]) {
  const r = runHumanization({ agents: n, minutes: 2, humans: 8, director: true });
  (out.simOnly as Record<string, unknown>)[n] = { aiMsPerTick: r.aiMsPerTick, decisionsPerSec: r.decisions.perSec, lod: r.lod };
  console.log(`só sistema ${n}:`, JSON.stringify((out.simOnly as Record<string, unknown>)[n]));
}
const file = process.env.PV_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/bench/round12_autonomous.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`→ ${file}`);
process.exit(0);
