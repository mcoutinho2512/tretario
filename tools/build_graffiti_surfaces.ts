/**
 * Superfícies autorizadas de pichação/grafite (public/world/graffiti_surfaces.json), a partir do mundo já gerado
 * (manifest + chunks). Cliente e servidor leem o MESMO arquivo — ver src/graffiti/surfaces.ts e docs/GRAFFITI.md.
 *
 *  wall    fachadas no nível da rua voltadas para a Pres. Vargas (sem galeria/arcada, sem modelo dedicado, com calçada
 *          livre na frente), espaçadas — temporárias (manifestação, expiram)
 *  mural   algumas fachadas perto do spawn viram painéis AUTORIZADOS (permanentes, só a moderação remove)
 *  tapume  painéis de obra colocados à mão (cliente renderiza; colisão nos dois lados) junto a fachadas largas
 *  ground  algumas áreas de chão em praças perto do eixo
 *
 * Uso: npm run map:graffiti (também roda no fim de `npm run map`)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { distPointPolyline, pointInPolygon } from './lib/geom';
import { arcadeSpans } from '../src/world/arcades';
import type { BuildingRec, ChunkData, Poly, WorldManifest, XZ } from '../src/world/types';
import type { GraffitiSolid, GraffitiSurface, GraffitiSurfaceFile } from '../src/graffiti/surfaces';

const OUT = 'public/world/graffiti_surfaces.json';
const manifest = JSON.parse(readFileSync('public/world/manifest.json', 'utf8')) as WorldManifest;
const buildings: BuildingRec[] = [];
const roads: Poly[] = [], plazas: Poly[] = [], greens: Poly[] = [];
const seen = new Set<number>();
for (const c of manifest.chunks) {
  const ch = JSON.parse(readFileSync(`public/world/${c.file}`, 'utf8')) as ChunkData;
  for (const b of ch.buildings) if (!seen.has(b.id)) { seen.add(b.id); buildings.push(b); }
  roads.push(...ch.surfaces.road); plazas.push(...ch.surfaces.plaza); greens.push(...ch.surfaces.green, ...ch.surfaces.water);
}
const axis = manifest.pvAxis;
const landmarkIds = new Set(manifest.landmarks.map((l) => l.osmId));
const inPolys = (p: XZ, polys: Poly[]) => polys.some((q) => pointInPolygon(p, q.outer) && !(q.holes ?? []).some((h) => pointInPolygon(p, h)));
const inBuilding = (p: XZ) => buildings.some((b) => !b.canopy && b.minHeight < 2 && pointInPolygon(p, b.poly.outer));
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface Cand { b: BuildingRec; a: XZ; c: XZ; len: number; mid: XZ; n: XZ; sidewalk: number }
const cands: Cand[] = [];
for (const b of buildings) {
  if (b.canopy || b.model || b.minHeight > 0.5 || b.height < 5 || landmarkIds.has(b.id)) continue;
  const spans = arcadeSpans(b);
  const ring = b.poly.outer;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    if (spans.some((s) => (s.a === a && s.c === c) || (s.a === c && s.c === a))) continue; // galeria: a parede é recuada
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 5) continue;
    const mid: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const dAxis = distPointPolyline(mid, axis);
    if (dAxis > 80 || dAxis < 15) continue;
    let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    if (pointInPolygon([mid[0] + nx * 0.4, mid[1] + nz * 0.4], ring)) { nx = -nx; nz = -nz; }
    // voltada para a avenida
    if (distPointPolyline([mid[0] + nx * 5, mid[1] + nz * 5], axis) > dAxis - 3.5) continue;
    // calçada livre na frente (sem outro prédio, pista, gramado ou água encostados na parede)
    let sidewalk = 0;
    for (let k = 0.6; k < 12; k += 0.4) {
      const q: XZ = [mid[0] + nx * k, mid[1] + nz * k];
      if (inPolys(q, roads) || inPolys(q, greens) || inBuilding(q)) break;
      sidewalk = k;
    }
    if (sidewalk < 2.4) continue;
    // as pontas da superfície também precisam de calçada (não pinta atrás de quina)
    const ok = [0.15, 0.85].every((f) => {
      const p: XZ = [a[0] + (c[0] - a[0]) * f + nx * 1.2, a[1] + (c[1] - a[1]) * f + nz * 1.2];
      return !inBuilding(p) && !inPolys(p, roads);
    });
    if (!ok) continue;
    cands.push({ b, a, c, len, mid, n: [nx, nz], sidewalk });
  }
}

const sp = manifest.spawn.p;
const dSpawn = (p: XZ) => Math.hypot(p[0] - sp[0], p[1] - sp[1]);
// perto do spawn primeiro (o jogador encontra logo onde pintar), depois o corredor inteiro, espaçado
cands.sort((x, y) => dSpawn(x.mid) - dSpawn(y.mid));
const kept: Cand[] = [];
const MAX_WALLS = 180, SPACING = 14;
for (const c of cands) {
  if (kept.length >= MAX_WALLS) break;
  if (kept.some((k) => Math.hypot(k.mid[0] - c.mid[0], k.mid[1] - c.mid[1]) < SPACING)) continue;
  kept.push(c);
}

const surfaces: GraffitiSurface[] = [];
const solids: GraffitiSolid[] = [];
const BASE_Y = 0.3, WALL_H = 2.5;
/** superfície vertical sobre o segmento a→c (normal n para fora), centrada, largura ≤ maxW */
function wallSurface(id: string, kind: GraffitiSurface['kind'], a: XZ, c: XZ, len: number, n: XZ, maxW: number, h: number, lift = 0.0): GraffitiSurface {
  const w = Math.min(maxW, len - 1);
  // u tal que u × v (v = cima) = n  →  u = (n.z, 0, −n.x)
  const ux = n[1], uz = -n[0];
  const mx = (a[0] + c[0]) / 2 + n[0] * lift, mz = (a[1] + c[1]) / 2 + n[1] * lift;
  return {
    id, kind, persistence: kind === 'mural' ? 'permanent' : 'temporary',
    o: [r3(mx - ux * (w / 2)), BASE_Y, r3(mz - uz * (w / 2))], u: [r3(ux), 0, r3(uz)], v: [0, 1, 0],
    w: r2(w), h, max: kind === 'mural' ? 4 : w > 7 ? 6 : 4, ...(kind === 'mural' ? { ttlMs: 0 } : {}),
  };
}

// tapumes: 6 painéis de obra diante das fachadas mais largas perto do spawn e ao longo do eixo (calçada ≥ 5 m)
const tapumeAt = new Set<Cand>();
for (const c of kept) {
  if (tapumeAt.size >= 6) break;
  if (c.len < 9 || c.sidewalk < 5.2) continue;
  if ([...tapumeAt].some((t) => Math.hypot(t.mid[0] - c.mid[0], t.mid[1] - c.mid[1]) < 60)) continue;
  tapumeAt.add(c);
}
let ti = 0, mi = 0, wi = 0;
for (const c of kept) {
  if (tapumeAt.has(c)) {
    // painel a 1,6 m da fachada (vão de obra), 6 m × 2,2 m; só o lado da rua é pintável
    const len = Math.min(6.4, c.len - 1.5), off = 1.6, thick = 0.12;
    const heading = Math.atan2(c.n[1], -c.n[0]); // eixo longo = paralelo à fachada (u = (n.z, −n.x))
    const cx = c.mid[0] + c.n[0] * off, cz = c.mid[1] + c.n[1] * off;
    const id = `tap${ti++}`;
    solids.push({ id, kind: 'tapume', x: r3(cx), z: r3(cz), heading: r3(heading), len: r2(len), thick, height: 2.3 });
    const half: XZ = [-c.n[1] * (len / 2), c.n[0] * (len / 2)];
    const a: XZ = [cx - half[0], cz - half[1]], b: XZ = [cx + half[0], cz + half[1]];
    const sf = wallSurface(id, 'tapume', a, b, len + 0.6, c.n, len - 0.2, 2.0, thick / 2);
    sf.o[1] = 0.25; sf.max = 6;
    surfaces.push(sf);
    continue;
  }
  // 3 murais autorizados (permanentes) entre as fachadas mais próximas do spawn
  const mural = mi < 3 && c.len >= 7;
  surfaces.push(wallSurface(mural ? `mural${mi++}` : `w${wi++}`, mural ? 'mural' : 'wall', c.a, c.c, c.len, c.n, mural ? 8 : 9, WALL_H));
}

// chão: 3 áreas de 4 × 4 m inteiras dentro de praças perto do eixo (mais perto do spawn primeiro)
const groundCands: XZ[] = [];
for (const p of plazas) {
  const ring = p.outer;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
  for (let x = minX + 3; x < maxX - 3; x += 4) for (let z = minZ + 3; z < maxZ - 3; z += 4) {
    const ok = [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5], [0, 0]].every(([dx, dz]) => inPolys([x + dx, z + dz], [p]) && !inBuilding([x + dx, z + dz]));
    if (ok && distPointPolyline([x, z], axis) < 90) groundCands.push([x, z]);
  }
}
groundCands.sort((a, b) => dSpawn(a) - dSpawn(b));
const grounds: XZ[] = [];
for (const g of groundCands) {
  if (grounds.length >= 3) break;
  if (dSpawn(g) < 12 || grounds.some((k) => Math.hypot(k[0] - g[0], k[1] - g[1]) < 40)) continue;
  if (surfaces.some((s) => Math.hypot(s.o[0] - g[0], s.o[2] - g[1]) < 6)) continue;
  grounds.push(g);
}
grounds.forEach((g, i) => surfaces.push({
  // u = leste, v = norte (−z): normal para cima. y = altura da calçada/praça (o cliente ajusta ao chão real)
  id: `g${i}`, kind: 'ground', persistence: 'temporary', o: [r3(g[0] - 2), 0.15, r3(g[1] + 2)], u: [1, 0, 0], v: [0, 0, -1], w: 4, h: 4, max: 6,
}));

const out: GraffitiSurfaceFile = { version: 1, surfaces, solids };
writeFileSync(OUT, JSON.stringify(out));
const by = (k: string) => surfaces.filter((s) => s.kind === k).length;
console.log(`[graffiti] ${surfaces.length} superfícies (fachadas ${by('wall')}, murais ${by('mural')}, tapumes ${by('tapume')}, chão ${by('ground')}) de ${cands.length} candidatas · ${(JSON.stringify(out).length / 1024).toFixed(1)} KB → ${OUT}`);
