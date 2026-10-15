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
import { GeoProjection, WORLD_ORIGIN } from '../src/geo/projection';
import type {
  XZ, Poly, BuildingRec, RoadRec, AreaRec, LineRec, PropRec, SignalRec, ChunkData, WorldManifest, LandmarkRec,
  ValidationPoint, CrossingRec, SurfaceSet, MarkingSet,
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
const signalProps: PropRec[] = [];
{
  const placed: XZ[] = [];
  for (const s of F.signals) {
    const nx = -Math.sin(s.dir), nz = Math.cos(s.dir);
    for (const side of [1, -1]) {
      const off = s.width / 2 + 0.7;
      const p: XZ = [s.p[0] + nx * off * side, s.p[1] + nz * off * side];
      if (pointInPaths(p, roadPaths)) continue;
      if (placed.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 7)) continue;
      placed.push(p);
      // cabeça do semáforo voltada para o tráfego que chega
      // lado +1 = direita do sentido `dir` (mão direita no Brasil): encara o tráfego que chega
      signalProps.push({ k: 'signal', p: [r2(p[0]), r2(p[1])], r: r2(s.dir + (side > 0 ? Math.PI : 0)) });
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
  attribution: '© OpenStreetMap contributors (ODbL)',
  osmTimestamp: F.source.osmBaseTimestamp,
};
writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest));
log(`manifest: ${(JSON.stringify(manifest).length / 1e3).toFixed(0)} KB`);

function r1(v: number) { return Math.round(v * 10) / 10; }
function r2(v: number) { return Math.round(v * 100) / 100; }
void samplePolyline;
