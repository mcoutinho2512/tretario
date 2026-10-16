/**
 * Etapa final do pipeline: transforma data/processed/features.json em dados de mundo por CHUNK
 * (public/world/*.json), prontos para o cliente:
 *   - superfícies (asfalto, calçadas, praças, gramados, plataformas, brita, água) via operações booleanas
 *   - meio-fios, sinalização horizontal (faixas, eixos, travessias)
 *   - edifícios, mobiliário, semáforos e linhas (trilhos/VLT/cercas) distribuídos por chunk
 *   - manifest.json com landmarks, pontos de validação, spawn e dados do minimapa
 *
 * Uso: npm run map:build
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  bufferLine, union, difference, intersection, pathsToPolys, polysToPaths, clipLines, rectPath, offsetPaths,
  pointInPaths, cleanPaths, type Paths,
} from './lib/clip';
import { centroid, samplePolyline, simplify, polylineLength, distPointPolyline } from './lib/geom';
import { CHUNK_SIZE, REGION_BBOX } from '../src/geo/region';
import { buildingWalls, barrierWalls, areaEdgeWalls, encodeSegments, type Seg } from '../src/physics/walls';
import { landmarkColliders } from '../src/world/landmarks/colliders';
import { GeoProjection, WORLD_ORIGIN } from '../src/geo/projection';
import type {
  XZ, Poly, BuildingRec, RoadRec, AreaRec, LineRec, PropRec, SignalRec, ChunkData, WorldManifest, LandmarkRec,
  ValidationPoint, CrossingRec, SurfaceSet, MarkingSet, MonumentRec, StreetSignRec, BillboardSlot,
} from '../src/world/types';

const F = JSON.parse(readFileSync('data/processed/features.json', 'utf8')) as {
  origin: { lat: number; lon: number };
  source: { osmBaseTimestamp: string | null };
  landmarks: LandmarkRec[];
  roads: RoadRec[];
  pvAxis: XZ[];
  crossings: { p: XZ; dir: number; width: number; signals: boolean }[];
  crossingWays: { pts: XZ[]; signals: boolean }[];
  signals: SignalRec[];
  buildings: BuildingRec[];
  areas: AreaRec[];
  lines: LineRec[];
  props: PropRec[];
  validation: ValidationPoint[];
  spawn: { p: XZ; yaw: number };
  monuments: MonumentRec[];
  bikeStations: { p: XZ; name?: string; capacity?: number }[];
};

const OUT_DIR = 'public/world';
const t0 = Date.now();
const log = (m: string) => console.log(`[build ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// ---------------------------------------------------------------------------------------------
// Limites do mundo: envelope dos edifícios/ruas (recortado ao bbox útil)
// ---------------------------------------------------------------------------------------------
const proj = new GeoProjection(WORLD_ORIGIN);
const sw = proj.toWorld(REGION_BBOX.south, REGION_BBOX.west), ne = proj.toWorld(REGION_BBOX.north, REGION_BBOX.east);
const minX = sw.x, maxX = ne.x, minZ = ne.z, maxZ = sw.z;
// alinhar à grade de chunks (para fora)
const cx0 = Math.floor(minX / CHUNK_SIZE), cx1 = Math.ceil(maxX / CHUNK_SIZE) - 1;
const cz0 = Math.floor(minZ / CHUNK_SIZE), cz1 = Math.ceil(maxZ / CHUNK_SIZE) - 1;
const WB: [number, number, number, number] = [cx0 * CHUNK_SIZE, cz0 * CHUNK_SIZE, (cx1 + 1) * CHUNK_SIZE, (cz1 + 1) * CHUNK_SIZE];
log(`mundo ${WB.join(',')} — chunks ${cx1 - cx0 + 1}×${cz1 - cz0 + 1}`);

// ---------------------------------------------------------------------------------------------
// Superfícies globais
// ---------------------------------------------------------------------------------------------
let roadPaths: Paths = [];
{
  const parts: Paths = [];
  for (const r of F.roads) parts.push(...bufferLine(r.pts, r.width / 2));
  roadPaths = union(parts);
  // fechamento morfológico leve: arredonda cantos de esquina (raio de meio-fio)
  roadPaths = cleanPaths(offsetPaths(offsetPaths(roadPaths, 1.2), -1.2));
}
log(`asfalto: ${roadPaths.length} contornos`);

const byKind = (k: AreaRec['kind']) => F.areas.filter((a) => a.kind === k).map((a) => a.poly);
const grassPolys = byKind('grass').concat(byKind('pitch'));
const grassPaths = union(polysToPaths(grassPolys));
// parques sem gramados mapeados internamente viram gramado inteiro; os demais viram "praça"
const parkGreen: Poly[] = [], parkPlaza: Poly[] = [];
for (const p of byKind('park')) {
  const inner = intersection(polysToPaths([p]), grassPaths);
  const innerArea = pathsToPolys(inner).reduce((s, q) => s + Math.abs(areaOf(q.outer)), 0);
  if (innerArea < Math.abs(areaOf(p.outer)) * 0.1) parkGreen.push(p);
  else parkPlaza.push(p);
}
function areaOf(pts: XZ[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}
const waterPaths = difference(union(polysToPaths(byKind('water'))), roadPaths);
const greenPaths = difference(union(grassPaths, polysToPaths(parkGreen)), union(roadPaths, waterPaths));
const platformPaths = difference(union(polysToPaths(byKind('platform'))), roadPaths);
const ballastPaths = difference(union(polysToPaths(byKind('rail_yard'))), union(roadPaths, platformPaths));
const plazaPaths = difference(union(polysToPaths(byKind('plaza').concat(parkPlaza))), union(union(roadPaths, greenPaths), union(platformPaths, waterPaths)));
const nonGround = union(roadPaths, union(greenPaths, union(platformPaths, union(ballastPaths, union(plazaPaths, waterPaths)))));
log('superfícies globais prontas');

// ---------------------------------------------------------------------------------------------
// Sinalização horizontal
// ---------------------------------------------------------------------------------------------
// zonas de cruzamento: nós compartilhados por vias distintas (pela coincidência de pontos)
const nodeUse = new Map<string, { n: number; w: number }>();
for (const r of F.roads) {
  const seen = new Set<string>();
  r.pts.forEach((p, i) => {
    const k = `${p[0]},${p[1]}`;
    if (seen.has(k)) return;
    seen.add(k);
    const e = nodeUse.get(k) ?? { n: 0, w: 0 };
    // extremidades contam como meio uso (continuação de via) — interior conta 2
    e.n += i === 0 || i === r.pts.length - 1 ? 1 : 2;
    e.w = Math.max(e.w, r.width);
    nodeUse.set(k, e);
  });
}
const junctionCircles: Paths = [];
for (const [k, e] of nodeUse) {
  if (e.n >= 3) {
    const [x, z] = k.split(',').map(Number);
    junctionCircles.push(...bufferLine([[x, z], [x + 0.01, z]], e.w / 2 + 3.5, true));
  }
}
const junctionPaths = union(junctionCircles);
const roadInner = offsetPaths(roadPaths, -0.35);

const dashed: XZ[][] = [], solid: XZ[][] = [];
function offsetLine(pts: XZ[], off: number): XZ[] {
  // deslocamento lateral simples (normal média por vértice)
  const out: XZ[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    out.push([pts[i][0] - (dz / l) * off, pts[i][1] + (dx / l) * off]);
  }
  return out;
}
for (const r of F.roads) {
  if (r.kind === 'service' || r.width < 5.5) continue;
  const lanes = Math.max(1, r.lanes);
  const lw = r.width / lanes;
  if (r.oneway) {
    for (let i = 1; i < lanes; i++) dashed.push(offsetLine(r.pts, -r.width / 2 + i * lw));
  } else {
    if (lanes >= 2) {
      // eixo central amarelo (duplo contínuo em vias principais)
      solid.push(offsetLine(r.pts, -0.12), offsetLine(r.pts, 0.12));
      const half = Math.floor(lanes / 2);
      for (let i = 1; i < half; i++) {
        dashed.push(offsetLine(r.pts, i * lw), offsetLine(r.pts, -i * lw));
      }
    }
  }
}
const clipMarks = (lines: XZ[][]) => clipLines(clipLines(lines, roadInner, 'inside'), junctionPaths, 'outside');
const dashedClipped = clipMarks(dashed);
const solidClipped = clipMarks(solid);

// faixas de pedestres: ways footway=crossing recortadas pelo asfalto
const crossings: CrossingRec[] = [];
for (const cw of F.crossingWays) {
  for (const seg of clipLines([cw.pts], roadPaths, 'inside')) {
    const a = seg[0], b = seg[seg.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) continue;
    crossings.push({ a, b, w: 4, signals: cw.signals });
  }
}
for (const c of F.crossings) {
  if (crossings.some((x) => distPointPolyline(c.p, [x.a, x.b]) < 6)) continue;
  const nx = -Math.sin(c.dir), nz = Math.cos(c.dir);
  const h = c.width / 2;
  crossings.push({ a: [c.p[0] - nx * h, c.p[1] - nz * h], b: [c.p[0] + nx * h, c.p[1] + nz * h], w: 4, signals: c.signals });
}
log(`sinalização: ${dashedClipped.length} tracejadas, ${solidClipped.length} contínuas, ${crossings.length} travessias`);

// ---------------------------------------------------------------------------------------------
// Semáforos → props posicionados no meio-fio
// ---------------------------------------------------------------------------------------------
// cruzamentos semaforizados: agrupa nós de semáforo a ≤ 35 m
interface JunctionB { id: number; c: XZ; axis: number; members: SignalRec[] }
const junctions: JunctionB[] = [];
{
  const sorted = [...F.signals].sort((a, b) => b.width - a.width);
  for (const s of sorted) {
    let j = junctions.find((x) => Math.hypot(x.c[0] - s.p[0], x.c[1] - s.p[1]) < 35);
    if (!j) { j = { id: junctions.length, c: [s.p[0], s.p[1]], axis: s.dir, members: [] }; junctions.push(j); }
    j.members.push(s);
    const n = j.members.length;
    j.c = [r2(j.members.reduce((t, m) => t + m.p[0], 0) / n), r2(j.members.reduce((t, m) => t + m.p[1], 0) / n)];
  }
}
/** fase 0 = fluxo paralelo ao eixo principal do cruzamento (via mais larga); fase 1 = transversal */
const phaseOf = (j: JunctionB, dir: number) => (Math.abs(Math.cos(dir - j.axis)) > 0.6 ? 0 : 1);
const junctionAt = (p: XZ, maxD = 40) => {
  let best: JunctionB | null = null, bd = maxD;
  for (const j of junctions) { const d = Math.hypot(j.c[0] - p[0], j.c[1] - p[1]); if (d < bd) { bd = d; best = j; } }
  return best;
};
log(`cruzamentos semaforizados: ${junctions.length}`);

const signalProps: PropRec[] = [];
{
  const placed: XZ[] = [];
  for (const s of F.signals) {
    const jn = junctionAt(s.p);
    const nx = -Math.sin(s.dir), nz = Math.cos(s.dir);
    for (const side of [1, -1]) {
      const off = s.width / 2 + 0.7;
      const p: XZ = [s.p[0] + nx * off * side, s.p[1] + nz * off * side];
      if (pointInPaths(p, roadPaths)) continue;
      if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 7)) continue;
      placed.push(p);
      // cabeça do semáforo voltada para o tráfego que chega
      // lado +1 = direita do sentido `dir` (mão direita no Brasil): encara o tráfego que chega
      signalProps.push({ k: 'signal', p: [r2(p[0]), r2(p[1])], r: r2(s.dir + (side > 0 ? Math.PI : 0)), ...(jn ? { j: jn.id, ph: phaseOf(jn, s.dir) } : {}) });
    }
  }
}
log(`semáforos posicionados: ${signalProps.length}`);

// mobiliário: descarta itens sobre o asfalto (desalinhamento de mapeamento)
const props: PropRec[] = [];
for (const p of F.props) {
  if ((p.k === 'tree' || p.k === 'lamp' || p.k === 'bench' || p.k === 'bus_stop' || p.k === 'kiosk' || p.k === 'palm') && pointInPaths(p.p, roadPaths)) continue;
  props.push(p);
}
props.push(...signalProps);
log(`props: ${props.length}`);

// curbs: contornos do asfalto
const curbRings: XZ[][] = roadPaths.map((p) => p.map((q) => [q.X / 100, q.Y / 100] as XZ));

// ---------------------------------------------------------------------------------------------
// Chunks
// ---------------------------------------------------------------------------------------------
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const manifestChunks: WorldManifest['chunks'] = [];
const inRect = (p: XZ, b: number[]) => p[0] >= b[0] && p[0] < b[2] && p[1] >= b[1] && p[1] < b[3];

for (let cx = cx0; cx <= cx1; cx++) {
  for (let cz = cz0; cz <= cz1; cz++) {
    const b: [number, number, number, number] = [cx * CHUNK_SIZE, cz * CHUNK_SIZE, (cx + 1) * CHUNK_SIZE, (cz + 1) * CHUNK_SIZE];
    const rect = [rectPath(b[0], b[1], b[2], b[3])];
    const clipP = (paths: Paths) => pathsToPolys(intersection(paths, rect), 0.2);

    const surfaces: SurfaceSet = {
      road: clipP(roadPaths),
      ground: pathsToPolys(difference(rect, nonGround), 0.2),
      plaza: clipP(plazaPaths),
      green: clipP(greenPaths),
      platform: clipP(platformPaths),
      ballast: clipP(ballastPaths),
      water: clipP(waterPaths),
      curbs: clipLines(curbRings.map((r) => r.concat([r[0]])), rect, 'inside'),
    };
    const markings: MarkingSet = {
      dashed: clipLines(dashedClipped, rect, 'inside'),
      solid: clipLines(solidClipped, rect, 'inside'),
      crossings: crossings.filter((c) => inRect([(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2], b)),
    };
    const buildings = F.buildings.filter((bd) => inRect(centroid(bd.poly.outer), b));
    const chunkProps = props.filter((p) => inRect(p.p, b));
    const lines: LineRec[] = [];
    for (const l of F.lines) for (const seg of clipLines([l.pts], rect, 'inside')) lines.push({ kind: l.kind, pts: seg });

    const empty = !buildings.length && !surfaces.road.length && !chunkProps.length;
    if (empty) continue;

    const key = `${cx}_${cz}`;
    const data: ChunkData = {
      key, cx, cz, bounds: b, buildings, surfaces, markings, props: chunkProps, signals: [], lines, areas: [],
    };
    const json = JSON.stringify(data);
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 10);
    const file = `chunk_${key}.${hash}.json`;
    writeFileSync(`${OUT_DIR}/${file}`, json);
    manifestChunks.push({
      key, cx, cz, file, buildings: buildings.length, bytes: json.length,
      maxHeight: buildings.reduce((m, x) => Math.max(m, x.height), 0),
    });
  }
}
log(`chunks gravados: ${manifestChunks.length}, total ${(manifestChunks.reduce((s, c) => s + c.bytes, 0) / 1e6).toFixed(2)} MB`);

// ---------------------------------------------------------------------------------------------
// Faixas de tráfego (para veículos NPC): deslocadas da linha central OSM, no sentido real
// ---------------------------------------------------------------------------------------------
interface LaneOut { id: number; pts: XZ[]; pv?: 1; next: number[]; speed: number }
const lanesOut: LaneOut[] = [];
{
  const TRAFFIC_KINDS = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'link']);
  const speedOf = (k: string) => (k === 'trunk' || k === 'primary' ? 14 : k === 'secondary' ? 12 : 10);
  for (const r of F.roads) {
    if (!TRAFFIC_KINDS.has(r.kind)) continue;
    const n = Math.max(1, r.lanes);
    const lw = r.width / n;
    const addLane = (pts: XZ[], off: number) => {
      const lp = simplify(offsetLine(pts, off), 0.3).map((p) => [r2(p[0]), r2(p[1])] as XZ);
      if (polylineLength(lp) < 4) return;
      lanesOut.push({ id: lanesOut.length, pts: lp, next: [], speed: speedOf(r.kind), ...(r.presidenteVargas ? { pv: 1 as const } : {}) });
    };
    if (r.oneway) {
      // mão direita: faixa 0 = mais à esquerda
      for (let i = 0; i < n; i++) addLane(r.pts, -r.width / 2 + (i + 0.5) * lw);
    } else {
      const half = Math.max(1, Math.floor(n / 2));
      const rev = [...r.pts].reverse();
      for (let i = 0; i < half; i++) {
        addLane(r.pts, (i + 0.5) * lw); // sentido dos nós: lado direito
        addLane(rev, (i + 0.5) * lw); // sentido oposto
      }
    }
  }
  // conexões: fim de uma faixa → início de outra (≤ 4 m, ângulo < 65°)
  const startHash = new Map<string, number[]>();
  const key = (p: XZ) => `${Math.floor(p[0] / 8)},${Math.floor(p[1] / 8)}`;
  for (const l of lanesOut) {
    const k = key(l.pts[0]);
    (startHash.get(k) ?? startHash.set(k, []).get(k)!).push(l.id);
  }
  const dirAt = (pts: XZ[], end: boolean) => {
    const a = end ? pts[pts.length - 2] : pts[0], b = end ? pts[pts.length - 1] : pts[1];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };
  for (const l of lanesOut) {
    const e = l.pts[l.pts.length - 1];
    const de = dirAt(l.pts, true);
    const cands: { id: number; score: number }[] = [];
    const [kx, kz] = [Math.floor(e[0] / 8), Math.floor(e[1] / 8)];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const id of startHash.get(`${kx + dx},${kz + dz}`) ?? []) {
        if (id === l.id) continue;
        const o = lanesOut[id];
        const d = Math.hypot(o.pts[0][0] - e[0], o.pts[0][1] - e[1]);
        if (d > 4) continue;
        let da = Math.abs(dirAt(o.pts, false) - de);
        if (da > Math.PI) da = Math.PI * 2 - da;
        if (da > 1.13) continue;
        cands.push({ id, score: d + da * 6 });
      }
    }
    l.next = cands.sort((a, b) => a.score - b.score).slice(0, 3).map((c) => c.id);
  }
}
// ---------------------------------------------------------------------------------------------
// Placas de logradouro nos cruzamentos da Pres. Vargas: posicionadas na calçada mais próxima
// (fora do asfalto), dos dois lados da avenida
// ---------------------------------------------------------------------------------------------
const streetSigns: StreetSignRec[] = [];
{
  const ax = F.pvAxis;
  for (const v of F.validation) {
    if (!v.key.startsWith('INTERSECTION_')) continue;
    const cross = v.label.replace(/^Cruzamento: /, '').replace(/ × Pres\. Vargas$/, '');
    // direção local do eixo
    let bi = 0, bd = Infinity;
    for (let i = 0; i < ax.length - 1; i++) {
      const d = distPointPolyline(v.p, [ax[i], ax[i + 1]]);
      if (d < bd) { bd = d; bi = i; }
    }
    const a = ax[bi], b = ax[bi + 1];
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const nx = -Math.sin(dir), nz = Math.cos(dir);
    for (const side of [1, -1]) {
      for (const along of [12, -12]) {
        // varre a partir do cruzamento até depois da ÚLTIMA pista (pula canteiros) e para na calçada externa
        let found: XZ | null = null;
        let lastRoad = -1, free = 0;
        for (let t = 0; t < 90; t += 1) {
          const q: XZ = [v.p[0] + nx * t * side + Math.cos(dir) * along, v.p[1] + nz * t * side + Math.sin(dir) * along];
          if (pointInPaths(q, roadPaths) || pointInPaths(q, platformPaths)) { lastRoad = t; free = 0; } else if (lastRoad >= 0 && ++free >= 16) break;
        }
        if (lastRoad >= 0) {
          const t = lastRoad + 1.6;
          found = [v.p[0] + nx * t * side + Math.cos(dir) * along, v.p[1] + nz * t * side + Math.sin(dir) * along];
        }
        if (found && !pointInPaths(found, roadPaths)) {
          streetSigns.push({ p: [r2(found[0]), r2(found[1])], r: r2(dir), names: ['Avenida Presidente Vargas', cross] });
          break;
        }
      }
    }
  }
  log(`placas de logradouro: ${streetSigns.length}`);
}

// linhas de retenção: projeta cada semáforo nas faixas alinhadas que passam por ele
{
  const proj = (pts: XZ[], p: XZ) => {
    let best = { d: Infinity, s: 0, dir: 0 }, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (l * l)));
      const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
      if (d < best.d) best = { d, s: acc + t * l, dir: Math.atan2(dz, dx) };
      acc += l;
    }
    return best;
  };
  let nStops = 0;
  const preds = new Map<number, number[]>();
  for (const l of lanesOut) for (const n of l.next) (preds.get(n) ?? preds.set(n, []).get(n)!).push(l.id);
  const lenOf = (l: LaneOut) => polylineLength(l.pts);
  for (const sig of F.signals) {
    const jn = junctionAt(sig.p);
    if (!jn) continue;
    for (const l of lanesOut) {
      const b0 = l.pts[0];
      if (Math.abs(b0[0] - sig.p[0]) > 400 || Math.abs(b0[1] - sig.p[1]) > 400) continue;
      const pr = proj(l.pts, sig.p);
      if (pr.d > sig.width / 2 + 1.5) continue;
      if (Math.abs(Math.cos(pr.dir - sig.dir)) < 0.8) continue;
      const ph = phaseOf(jn, pr.dir);
      const sStop = pr.s - 4; // retenção ~4 m antes do nó (faixa de pedestres)
      const push = (lane: LaneOut, s: number) => {
        const st = ((lane as any).stops ??= []) as { s: number; j: number; ph: number }[];
        if (!st.some((x) => Math.abs(x.s - s) < 6)) { st.push({ s: r2(s), j: jn.id, ph }); nStops++; }
      };
      if (sStop > 1) push(l, sStop);
      else for (const pid of preds.get(l.id) ?? []) { const pl = lanesOut[pid]; push(pl, lenOf(pl) + sStop); }
    }
  }
  log(`linhas de retenção: ${nStops}`);
}
// defasagem: onda verde ao longo do eixo da Pres. Vargas (~11 m/s)
const junctionsOut = junctions.map((j) => {
  const ax = F.pvAxis;
  let acc = 0, best = Infinity, sAlong = 0;
  for (let i = 0; i < ax.length - 1; i++) {
    const a = ax[i], b = ax[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((j.c[0] - a[0]) * dx + (j.c[1] - a[1]) * dz) / (l * l)));
    const d = Math.hypot(a[0] + dx * t - j.c[0], a[1] + dz * t - j.c[1]);
    if (d < best) { best = d; sAlong = acc + t * l; }
    acc += l;
  }
  return { id: j.id, c: j.c, offset: r2(sAlong / 11) };
});
// faixas de pedestres para NPCs: semaforizadas quando perto de um cruzamento
const pedCrossings = crossings.map((c) => {
  const mid: XZ = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
  const jn = junctionAt(mid, 30);
  // a faixa atravessa a via perpendicular a ela
  const roadDir = Math.atan2(c.b[1] - c.a[1], c.b[0] - c.a[0]) + Math.PI / 2;
  return { a: c.a, b: c.b, j: jn ? jn.id : -1, ph: jn ? phaseOf(jn, roadDir) : 0 };
});
// ---------------------------------------------------------------------------------------------
// Locais para painéis de LED: fachadas altas voltadas para a avenida, concentradas perto dos
// grandes cruzamentos (efeito "mídia urbana" sem cobrir a arquitetura inteira)
// ---------------------------------------------------------------------------------------------
const billboards: BillboardSlot[] = [];
{
  const ax = F.pvAxis;
  const hubs = F.validation.filter((v) => /INTERSECTION_(RIO_BRANCO|URUGUAIANA|PASSOS|PROCOPIO|DA_REPUBLICA|PRIMEIRO_DE_MARCO|TOME_DE_SOUSA)/.test(v.key) || v.key === 'LANDMARK_CENTRAL');
  const cands: (BillboardSlot & { score: number })[] = [];
  for (const b of F.buildings) {
    if (b.height < 28 || b.canopy) continue;
    const ring = b.poly.outer;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 14) continue;
      const mid: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const dMid = distPointPolyline(mid, ax);
      if (dMid > 95) continue;
      let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
      // normal externa (teste de ponto-no-polígono)
      const inside = (() => { const q: XZ = [mid[0] + nx * 0.5, mid[1] + nz * 0.5]; let ins = false; for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) { const xi = ring[k][0], zi = ring[k][1], xj = ring[j][0], zj = ring[j][1]; if (zi > q[1] !== zj > q[1] && q[0] < ((xj - xi) * (q[1] - zi)) / (zj - zi) + xi) ins = !ins; } return ins; })();
      if (inside) { nx = -nx; nz = -nz; }
      const toAxis = distPointPolyline([mid[0] + nx * 4, mid[1] + nz * 4], ax) < dMid - 2;
      if (!toAxis) continue;
      let hub = hubs[0], hd = Infinity;
      for (const h of hubs) { const d = Math.hypot(h.p[0] - mid[0], h.p[1] - mid[1]); if (d < hd) { hd = d; hub = h; } }
      if (hd > 220) continue;
      const w = Math.min(len * 0.62, 18);
      const h = w * (w > 10 ? 0.5625 : 1.3); // 16:9 ou vertical
      const y = Math.min(b.height - h / 2 - 3, 12 + h / 2 + (b.id % 3) * 3);
      if (y - h / 2 < 8) continue;
      cands.push({
        id: `bb_${b.id}_${i}`, p: [r2(mid[0] + nx * 0.25), r2(mid[1] + nz * 0.25)], y: r2(y), w: r2(w), h: r2(h),
        r: r2(Math.atan2(nx, nz)), zone: hub.key, buildingId: b.id, score: hd + dMid * 0.5 - len * 0.2,
      });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands) {
    if (billboards.length >= 28) break;
    if (billboards.some((o) => Math.hypot(o.p[0] - c.p[0], o.p[1] - c.p[1]) < 45 || o.buildingId === c.buildingId)) continue;
    const { score: _s, ...slot } = c;
    void _s;
    billboards.push(slot);
  }
  log(`painéis de LED: ${billboards.length} locais (${[...new Set(billboards.map((b) => b.zone))].join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// Colisão autoritativa do servidor: só segmentos 2D com faixa de altura (nenhuma malha 3D).
// Mesmas funções usadas pelo cliente (src/physics/walls.ts) → mesma geometria nos dois lados.
// ---------------------------------------------------------------------------------------------
let collisionFile = '';
{
  const segs: Seg[] = [];
  for (const b of F.buildings) buildingWalls(b, segs);
  barrierWalls(F.lines, segs);
  areaEdgeWalls(pathsToPolys(waterPaths), 5, segs);
  areaEdgeWalls(pathsToPolys(platformPaths), 0.9, segs);
  for (const lm of F.landmarks) for (const c of landmarkColliders(lm)) {
    const r = c.poly;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b2 = r[(i + 1) % r.length];
      segs.push({ ax: a[0], az: a[1], bx: b2[0], bz: b2[1], bottom: c.minHeight ?? 0, top: c.height });
    }
  }
  const buf = Buffer.from(encodeSegments(segs).buffer);
  collisionFile = `collision.${createHash('sha1').update(buf).digest('hex').slice(0, 10)}.bin`;
  writeFileSync(`${OUT_DIR}/${collisionFile}`, buf);
  log(`colisão do servidor: ${segs.length} segmentos, ${(buf.length / 1e6).toFixed(2)} MB (${collisionFile})`);
}

const trafficJson = JSON.stringify({ lanes: lanesOut, junctions: junctionsOut, crossings: pedCrossings });
const trafficFile = `traffic.${createHash('sha1').update(trafficJson).digest('hex').slice(0, 10)}.json`;
writeFileSync(`${OUT_DIR}/${trafficFile}`, trafficJson);
log(`faixas de tráfego: ${lanesOut.length} (${lanesOut.filter((l) => l.pv).length} na Pres. Vargas), conectadas: ${lanesOut.filter((l) => l.next.length).length}`);

// ---------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------
const minimapRoads = F.roads
  .filter((r) => r.kind !== 'service')
  .map((r) => ({ pts: simplify(r.pts, 1.5).map((p) => [r1(p[0]), r1(p[1])] as XZ), w: r.width, ...(r.presidenteVargas ? { pv: true } : {}), ...(r.name ? { name: r.name } : {}) }))
  .filter((r) => polylineLength(r.pts) > 5);

const manifest: WorldManifest = {
  version: createHash('sha1').update(manifestChunks.map((c) => c.file).join()).digest('hex').slice(0, 10),
  generatedAt: new Date().toISOString(),
  origin: F.origin,
  chunkSize: CHUNK_SIZE,
  bounds: WB,
  chunks: manifestChunks,
  landmarks: F.landmarks,
  validation: F.validation,
  spawn: F.spawn,
  pvAxis: F.pvAxis,
  minimapRoads,
  traffic: trafficFile,
  collision: collisionFile,
  monuments: F.monuments,
  billboards,
  bikeStations: F.bikeStations,
  streetSigns,
  attribution: '© OpenStreetMap contributors (ODbL)',
  osmTimestamp: F.source.osmBaseTimestamp,
};
writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest));
log(`manifest: ${(JSON.stringify(manifest).length / 1e3).toFixed(0)} KB`);

function r1(v: number) { return Math.round(v * 10) / 10; }
function r2(v: number) { return Math.round(v * 100) / 100; }
void samplePolyline;
