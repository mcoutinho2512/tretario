/**
 * Rodada 12 — custo PURO da colisão entre corpos (sem rede), com N corpos CONCENTRADOS (disco de √N × 0,42 m,
 * ~1,8 pessoa/m²), no mesmo código da sala (server/src/collision/RoomBodies.ts + src/physics/bodyResolve.ts):
 *   servidor  por tick (10 Hz): reconstrução da grade + 1,5 validação por humano (movimentos a 15 Hz) — e, para os
 *             AUTÔNOMOS (agente C), resolveBodies de todos eles contra a grade (humanos fixos)
 *   cliente   LocalBodies.step do jogador local no meio da multidão (vizinhos remotos duros + NPCs macios), por quadro
 * uso: npx tsx tools/collisionbench.ts [ticks=200] [N=50,250,500]   saída: ../docs/screenshots/round12/collision_bench.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { BODY, type BodyRef } from '../../src/physics/bodies.ts';
import { RoomBodies } from '../src/collision/RoomBodies.ts';
import { LocalBodies, type NpcBodySource } from '../../src/physics/LocalBodies.ts';

const TICKS = Number(process.argv[2] ?? 200);
const NS = (process.argv[3] ?? '50,250,500').split(',').map(Number);
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

type P = { x: number; z: number; status: number; vehicle: string; platform: string; kind: number; h: number };
const rows: Record<string, unknown>[] = [];
for (const n of NS) {
  for (const mode of ['humanos', 'autonomos'] as const) {
    const R = Math.sqrt(n) * 0.42;
    const ps = new Map<string, P>();
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, k = Math.sqrt(rnd()) * R; ps.set(`p${i}`, { x: Math.cos(a) * k, z: Math.sin(a) * k, status: 0, vehicle: '', platform: '', kind: mode === 'humanos' ? 0 : (i % 10 === 0 ? 0 : 1), h: rnd() * 6.28 }); }
    const rb = new RoomBodies();
    const each = (fn: (id: string, p: P) => void) => ps.forEach((p, id) => fn(id, p));
    const tickMs: number[] = [];
    let nq = 0, corr = 0, pairs = 0;
    for (let t = 0; t < TICKS; t++) {
      const t0 = performance.now();
      rb.rebuild(each);
      if (mode === 'humanos') {
        // cada humano manda ~1,5 movimento por tick, andando para o centro a 1,2 m/s (aperta a multidão)
        for (const [id, p] of ps) for (let k = 0; k < (t % 2 ? 1 : 2); k++) {
          const dc = Math.hypot(p.x, p.z) || 1, st = 1.2 / 15;
          const nx = p.x - (p.x / dc) * st + Math.cos(p.h) * 0.02, nz = p.z - (p.z / dc) * st + Math.sin(p.h) * 0.02;
          const c = rb.validate(id, p.x, p.z, nx, nz, 1 / 15);
          p.x = c ? c.x : nx; p.z = c ? c.z : nz;
          rb.sync(id, p);
        }
      } else {
        // autônomos: andam para o centro e a resolução progressiva os separa (humanos fixos)
        const list: BodyRef[] = [];
        for (const [id, p] of ps) { const b = rb.grid.get(id); if (!b || p.kind !== 1) continue; const dc = Math.hypot(b.x, b.z) || 1; b.x -= (b.x / dc) * 0.1; b.z -= (b.z / dc) * 0.1; list.push(b); }
        for (const b of list) rb.grid.move(b.id, b.x, b.z);
        const s = rb.resolveAutonomous(list);
        pairs += s.pairs;
        for (const b of list) { const p = ps.get(b.id)!; p.x = b.x; p.z = b.z; }
      }
      rb.endTick();
      const s = rb.take();
      nq += s.neighborQueries; corr += s.corrections;
      tickMs.push(performance.now() - t0);
    }
    // distância mínima (estatística): mediana e 5º percentil do vizinho mais próximo
    const arr = [...ps.values()];
    const mins = arr.map((a) => { let m = Infinity; for (const b of arr) if (b !== a) m = Math.min(m, Math.hypot(a.x - b.x, a.z - b.z)); return m; }).sort((a, b) => a - b);
    const w = tickMs.slice(20).sort((a, b) => a - b);
    const avg = w.reduce((a, b) => a + b, 0) / w.length;
    const row = { corpos: n, modo: mode, tick_ms_medio: +avg.toFixed(4), tick_ms_p95: +w[Math.floor(w.length * 0.95)].toFixed(4), tick_ms_max: +w[w.length - 1].toFixed(4), consultas_por_tick: Math.round(nq / TICKS), correcoes_por_tick: +(corr / TICKS).toFixed(1), pares_por_tick: Math.round(pairs / TICKS), dist_min_mediana_m: +mins[Math.floor(mins.length / 2)].toFixed(3), dist_min_p05_m: +mins[Math.floor(mins.length * 0.05)].toFixed(3), contato_m: 2 * BODY.radius };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
// cliente: jogador local no centro de N remotos concentrados + 40 NPCs macios, 600 quadros
for (const n of NS) {
  const R = Math.sqrt(n) * 0.42;
  const remotes: BodyRef[] = [];
  for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, k = 0.8 + Math.sqrt(rnd()) * R; remotes.push({ id: `r${i}`, x: Math.cos(a) * k, z: Math.sin(a) * k, r: BODY.radius }); }
  const npc: NpcBodySource = { yieldBodies: (x, z, sr, r, st, soft, out) => { let c = 0; for (let i = 0; i < 40; i++) { const a = i * 2.4, k = 1 + (i % 7) * 0.5; const bx = Math.cos(a) * k, bz = Math.sin(a) * k; if (Math.abs(bx - x) <= r && Math.abs(bz - z) <= r) { out.push({ id: `n${i}`, x: bx, z: bz, r: BODY.radius, soft }); c++; } } void sr; void st; return c; } };
  const lb = new LocalBodies({ remotes: (x, z, r, out) => { out.length = 0; for (const b of remotes) if ((b.x - x) ** 2 + (b.z - z) ** 2 <= r * r) out.push(b); return out; }, npcs: () => [npc], walls: () => false });
  const p = { x: 0, z: 0 };
  for (let f = 0; f < 600; f++) { const px = p.x, pz = p.z; p.x += 0.03; lb.step(p, px, pz, 1 / 60, 0.03); }
  const i = lb.info();
  const row = { corpos: n, modo: 'cliente (quadro)', ms_por_quadro_medio: i.avgMs, ms_por_quadro_max: i.maxMs, vizinhos_medio: i.avgNeighbors, contatos_medio: i.avgContacts };
  rows.push(row);
  console.log(JSON.stringify(row));
}
mkdirSync('../docs/screenshots/round12', { recursive: true });
writeFileSync('../docs/screenshots/round12/collision_bench.json', JSON.stringify(rows, null, 2));
