/**
 * Etapa 4–10 do pipeline: processa os dados OSM brutos (data/raw) em feições no sistema local
 * do mundo (data/processed/features.json). Não gera geometria 3D — apenas dados limpos.
 *
 * Uso: npm run map:process
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { GeoProjection, WORLD_ORIGIN } from '../src/geo/projection';
import { OsmDataset, parseNum, round2, type OsmWay, type OsmRel } from './lib/osm';
import {
  polygonArea, centroid, pointInPolygon, distPointPolyline, samplePolyline, orientedBox, hash32, openRing, simplify,
} from './lib/geom';
import type {
  XZ, Poly, BuildingRec, RoadRec, RoadKind, SignalRec, PropRec, AreaRec, LineRec, LandmarkRec,
  ValidationPoint, BuildingClass,
} from '../src/world/types';
import { FacadeStyle } from '../src/world/types';

const RAW = 'data/raw/osm_corridor.json.gz';
const OUT = 'data/processed/features.json';

const proj = new GeoProjection(WORLD_ORIGIN);
const ds = new OsmDataset(RAW, proj);
console.log(`[process] nós=${ds.nodes.size} ways=${ds.ways.size} relações=${ds.rels.size}`);

// ---------------------------------------------------------------------------------------------
// Landmarks (identificados por id OSM + verificação de tags)
// ---------------------------------------------------------------------------------------------
const LANDMARK_IDS = {
  LANDMARK_CENTRAL: { id: 81100866, check: (t: Record<string, string>) => t.building === 'train_station' && /Cristiano Ottoni/.test(t['addr:street'] ?? '') },
  LANDMARK_CANDELARIA: { id: 30839484, check: (t: Record<string, string>) => /Candel/.test(t.name ?? '') },
} as const;

const landmarks: LandmarkRec[] = [];
for (const [key, def] of Object.entries(LANDMARK_IDS)) {
  let w = ds.ways.get(def.id);
  if (!w || !def.check(w.tags ?? {})) {
    w = [...ds.ways.values()].find((x) => x.tags && 'building' in x.tags && def.check(x.tags));
  }
  if (!w) throw new Error(`landmark ${key} não encontrado nos dados OSM`);
  const fp = openRing(ds.wayPts(w));
  const ob = orientedBox(fp);
  landmarks.push({
    key: key as LandmarkRec['key'],
    name: key === 'LANDMARK_CENTRAL' ? 'Central do Brasil — Edifício D. Pedro II' : 'Igreja de Nossa Senhora da Candelária',
    osmId: w.id,
    footprint: fp,
    center: [round2(ob.center[0]), round2(ob.center[1])],
    axis: ob.axis,
    length: round2(ob.length),
    width: round2(ob.width),
  });
}
const landmarkFps = landmarks.map((l) => l.footprint);

// ---------------------------------------------------------------------------------------------
// Ruas
// ---------------------------------------------------------------------------------------------
const MOTOR: Record<string, RoadKind> = {
  trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', residential: 'residential',
  unclassified: 'unclassified', service: 'service', living_street: 'living_street',
  trunk_link: 'link', primary_link: 'link', secondary_link: 'link', tertiary_link: 'link',
};
const DEFAULT_LANES_ONEWAY: Record<RoadKind, number> = {
  trunk: 3, primary: 3, secondary: 2, tertiary: 2, residential: 1.7, unclassified: 1.7, service: 1.3, living_street: 1.7, link: 1.5,
};
const DEFAULT_LANES_TWOWAY: Record<RoadKind, number> = {
  trunk: 4, primary: 4, secondary: 2, tertiary: 2, residential: 2, unclassified: 2, service: 1.7, living_street: 2, link: 2,
};
const LANE_W: Record<RoadKind, number> = {
  trunk: 3.4, primary: 3.3, secondary: 3.2, tertiary: 3.1, residential: 3.0, unclassified: 3.0, service: 3.0, living_street: 3.0, link: 3.3,
};

const roads: RoadRec[] = [];
for (const w of ds.ways.values()) {
  const t = w.tags;
  if (!t || !t.highway) continue;
  const kind = MOTOR[t.highway];
  if (!kind) continue;
  if (t.area === 'yes') continue;
  if (t.tunnel && t.tunnel !== 'no') continue; // túneis/passagens subterrâneas fora do MVP
  const layer = parseNum(t.layer) ?? 0;
  if (layer < 0 || layer > 0 || t.bridge) continue; // viadutos fora do MVP (documentado)
  if (t.service === 'parking_aisle' || t.service === 'drive-through') continue;
  if (t.access === 'private' && kind === 'service') continue;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
  const lanesTag = parseNum(t.lanes);
  const lanes = lanesTag ?? (oneway ? DEFAULT_LANES_ONEWAY[kind] : DEFAULT_LANES_TWOWAY[kind]);
  const width = parseNum(t.width) ?? lanes * LANE_W[kind] + (kind === 'service' ? 0 : 0.6);
  const pts = ds.wayPts(w);
  if (pts.length < 2) continue;
  const pv = t.name === 'Avenida Presidente Vargas';
  const desc = t.description ?? '';
  roads.push({
    id: w.id,
    name: t.name,
    kind,
    lanes: Math.max(1, Math.round(lanes)),
    width: round2(width),
    oneway,
    pts,
    ...(pv ? { presidenteVargas: true, pvRole: /lateral/.test(desc) ? 'lateral' : 'central' } : {}),
  });
}
const pvRoads = roads.filter((r) => r.presidenteVargas);
console.log(`[process] ruas=${roads.length} (Presidente Vargas: ${pvRoads.length} trechos)`);

// Eixo da Presidente Vargas: PCA dos pontos das pistas centrais + média por faixas ao longo do eixo
function computePvAxis(): XZ[] {
  const pts = pvRoads.filter((r) => r.pvRole === 'central').flatMap((r) => r.pts);
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const mz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dz = p[1] - mz;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const bins = new Map<number, { s: number; v: number; n: number }>();
  const BIN = 40;
  for (const p of pts) {
    const s = (p[0] - mx) * ux + (p[1] - mz) * uz;
    const v = -(p[0] - mx) * uz + (p[1] - mz) * ux;
    const k = Math.floor(s / BIN);
    const b = bins.get(k) ?? { s: 0, v: 0, n: 0 };
    b.s += s; b.v += v; b.n++;
    bins.set(k, b);
  }
  const keys = [...bins.keys()].sort((a, b) => a - b);
  let axis: XZ[] = keys.map((k) => {
    const b = bins.get(k)!;
    const s = b.s / b.n, v = b.v / b.n;
    return [round2(mx + s * ux - v * uz), round2(mz + s * uz + v * ux)] as XZ;
  });
  if (axis[0][0] > axis[axis.length - 1][0]) axis = axis.reverse(); // oeste (Central) → leste (Candelária)
  return simplify(axis, 2);
}
const pvAxis = computePvAxis();

// ---------------------------------------------------------------------------------------------
// Travessias e semáforos
// ---------------------------------------------------------------------------------------------
function roadAtNode(nodeId: number): { road: RoadRec; dir: number } | null {
  const wids = ds.nodeWays.get(nodeId) ?? [];
  let best: RoadRec | null = null;
  for (const wid of wids) {
    const r = roads.find((x) => x.id === wid);
    if (r && (!best || r.width > best.width)) best = r;
  }
  if (!best) return null;
  const w = ds.ways.get(best.id)!;
  const i = w.nodes.indexOf(nodeId);
  const a = ds.xz(w.nodes[Math.max(0, i - 1)])!;
  const b = ds.xz(w.nodes[Math.min(w.nodes.length - 1, i + 1)])!;
  return { road: best, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

const crossings: { p: XZ; dir: number; width: number; signals: boolean }[] = [];
const signals: SignalRec[] = [];
const roadIdSet = new Set(roads.map((r) => r.id));
// travessias desenhadas como ways footway=crossing são usadas no build (mais precisas)
const crossingWays: { pts: XZ[]; signals: boolean; zebra: boolean }[] = [];
for (const w of ds.ways.values()) {
  const t = w.tags;
  if (t?.highway === 'footway' && t.footway === 'crossing') {
    const unmarked = t.crossing === 'unmarked' || t['crossing:markings'] === 'no';
    if (unmarked) continue;
    crossingWays.push({ pts: ds.wayPts(w), signals: t.crossing === 'traffic_signals', zebra: true });
  }
}
for (const n of ds.nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  if (t.highway === 'crossing' && t.crossing !== 'unmarked' && t['crossing:markings'] !== 'no') {
    const r = roadAtNode(n.id);
    if (r && roadIdSet.has(r.road.id)) {
      crossings.push({ p: ds.xz(n.id)!, dir: r.dir, width: r.road.width, signals: t.crossing === 'traffic_signals' });
    }
  }
  if (t.highway === 'traffic_signals' || (t.highway === 'crossing' && t.crossing === 'traffic_signals')) {
    const r = roadAtNode(n.id);
    if (r) signals.push({ p: ds.xz(n.id)!, dir: r.dir, width: r.road.width });
  }
}

// ---------------------------------------------------------------------------------------------
// Edifícios
// ---------------------------------------------------------------------------------------------
const buildings: BuildingRec[] = [];
const partsByParent = new Set<number>();

function classify(poly: XZ[], h: number, tags: Record<string, string>, distPv: number): { cls: BuildingClass; style: FacadeStyle } {
  const area = Math.abs(polygonArea(poly));
  const seed = hash32(Math.round(poly[0][0] * 7 + poly[0][1] * 13));
  const named = !!(tags.name || tags.wikidata || tags.historic);
  const institutional = ['public', 'church', 'school', 'university', 'government', 'hospital', 'civic', 'cathedral', 'chapel'].includes(tags.building)
    || !!tags.amenity || !!tags.historic;
  let cls: BuildingClass = 'C';
  if ((named || h >= 40) && distPv < 160) cls = 'B';
  else if (area < 50 || h < 4 || distPv > 520) cls = 'D';

  let style: FacadeStyle;
  if (institutional && h < 45) style = FacadeStyle.Institutional;
  else if (h >= 90) style = seed < 0.75 ? FacadeStyle.ModernOffice : FacadeStyle.ClassicPunched;
  else if (h >= 35) style = distPv < 80 ? (seed < 0.7 ? FacadeStyle.ClassicPunched : seed < 0.85 ? FacadeStyle.ArtDecoPiers : FacadeStyle.ModernOffice)
    : (seed < 0.45 ? FacadeStyle.ClassicPunched : seed < 0.7 ? FacadeStyle.ModernOffice : FacadeStyle.ArtDecoPiers);
  else if (h >= 15) style = seed < 0.55 ? FacadeStyle.ClassicPunched : seed < 0.8 ? FacadeStyle.ArtDecoPiers : FacadeStyle.ModernOffice;
  else style = seed < 0.8 ? FacadeStyle.Sobrado : FacadeStyle.ClassicPunched;
  return { cls, style };
}

function heightOf(t: Record<string, string>): { h: number; levels: number; src: BuildingRec['heightSource'] } {
  const h = parseNum(t.height);
  const lv = parseNum(t['building:levels']);
  if (h != null && h > 0.5) return { h, levels: lv ?? Math.max(1, Math.round(h / 3.2)), src: 'osm:height' };
  if (lv != null && lv > 0) return { h: lv * 3.2 + 1, levels: lv, src: 'osm:levels' };
  const b = t.building;
  const est = b === 'church' ? 16 : b === 'roof' ? 4 : b === 'garage' ? 4 : b === 'construction' ? 6 : 9;
  return { h: est, levels: Math.max(1, Math.round(est / 3.2)), src: 'estimate' };
}

function inLandmark(c: XZ): boolean {
  return landmarkFps.some((fp) => pointInPolygon(c, fp));
}

function addBuilding(id: number, outer: XZ[], holes: XZ[][], t: Record<string, string>) {
  outer = openRing(outer);
  if (outer.length < 3) return;
  const area = Math.abs(polygonArea(outer));
  if (area < 4) return;
  const c = centroid(outer);
  if (inLandmark(c)) return;
  let { h, levels, src } = heightOf(t);
  let minH = parseNum(t.min_height) ?? 0;
  const canopy = t.building === 'roof';
  if (canopy) {
    // marquises/coberturas (ex.: Mercado Popular da Uruguaiana): laje fina elevada
    if (h < 3) h = 4.5;
    minH = Math.max(minH, h - 0.4);
  }
  const distPv = distPointPolyline(c, pvAxis);
  const { cls, style } = classify(outer, h, t, distPv);
  const seed = hash32(id);
  // galeria/arcada no térreo: prédios altos com fachada para a Presidente Vargas (padrão PA dos anos 40)
  const arcade = !canopy && h > 25 && distPv < 75 && outer.some((p) => distPointPolyline(p, pvAxis) < 52);
  // arestas voltadas para a avenida: ponto médio perto do eixo e normal externa apontando para ele
  let arcadeEdges: number[] | undefined;
  if (arcade) {
    const ring = openRing(outer);
    arcadeEdges = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c2 = ring[(i + 1) % ring.length];
      const len = Math.hypot(c2[0] - a[0], c2[1] - a[1]);
      if (len < 6) continue;
      const mid: XZ = [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2];
      let nx = (c2[1] - a[1]) / len, nz = -(c2[0] - a[0]) / len;
      if (pointInPolygon([mid[0] + nx * 0.5, mid[1] + nz * 0.5], ring)) { nx = -nx; nz = -nz; }
      const dMid = distPointPolyline(mid, pvAxis);
      const dOut = distPointPolyline([mid[0] + nx * 3, mid[1] + nz * 3], pvAxis);
      if (dMid < 55 && dOut < dMid - 1.5) arcadeEdges.push(i);
    }
    if (!arcadeEdges.length) arcadeEdges = undefined;
  }
  buildings.push({
    id,
    poly: { outer: outer.map((p) => [round2(p[0]), round2(p[1])] as XZ), holes: holes.length ? holes.map((r) => openRing(r)) : undefined },
    height: round2(h),
    minHeight: round2(minH),
    levels,
    heightSource: src,
    cls,
    style,
    tint: round2(hash32(id * 7 + 3)),
    seed: round2(seed),
    ...(arcade ? { arcade: true } : {}),
    ...(arcadeEdges ? { arcadeEdges } : {}),
    ...(canopy ? { canopy: true } : {}),
    ...(t.name ? { name: t.name } : {}),
  });
}

// building:part → se existir, substitui o contorno do edifício-pai (convenção Simple 3D Buildings)
const partWays = [...ds.ways.values()].filter((w) => w.tags?.['building:part'] && w.tags['building:part'] !== 'no');
const partCentroids = partWays.map((w) => centroid(openRing(ds.wayPts(w))));
for (const w of ds.ways.values()) {
  const t = w.tags;
  if (!t?.building || t.building === 'no') continue;
  if (landmarks.some((l) => l.osmId === w.id)) continue;
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  const outer = ds.wayPts(w);
  const hasParts = partCentroids.some((c) => pointInPolygon(c, outer));
  if (hasParts) { partsByParent.add(w.id); continue; }
  addBuilding(w.id, outer, [], t);
}
for (const w of partWays) {
  if (w.nodes[0] !== w.nodes[w.nodes.length - 1]) continue;
  addBuilding(w.id, ds.wayPts(w), [], w.tags!);
}
for (const r of ds.rels.values()) {
  const t = r.tags;
  if (!t || (!t.building && !t['building:part'])) continue;
  if (t.type !== 'multipolygon') continue;
  const { outers, inners } = ds.multipolygonRings(r);
  for (const o of outers) {
    const holes = inners.filter((i) => pointInPolygon(i[0], o));
    addBuilding(r.id, o, holes, t);
  }
}
// ---------------------------------------------------------------------------------------------
// Deduplicação: o OSM do Centro mistura contornos de edifício/lote com os volumes 3D da Prefeitura
// mapeados por dentro. Regras (documentadas em docs/AUDIT.md):
//  (a) duplicatas quase idênticas (centróides mútuos, áreas ±15%) → fica a de melhor fonte de altura
//  (b) contorno com altura ESTIMADA que contém volumes com altura real cobrindo ≥ 40% da área → removido
//      (o nome passa para o maior volume interno)
// ---------------------------------------------------------------------------------------------
{
  const n = buildings.length;
  const info = buildings.map((b) => {
    const c = centroid(b.poly.outer);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of b.poly.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    return { c, area: Math.abs(polygonArea(b.poly.outer)), box: [x0, z0, x1, z1] };
  });
  const grid = new Map<string, number[]>();
  info.forEach((it, i) => {
    for (let gx = Math.floor(it.box[0] / 50); gx <= Math.floor(it.box[2] / 50); gx++)
      for (let gz = Math.floor(it.box[1] / 50); gz <= Math.floor(it.box[3] / 50); gz++) {
        const k = `${gx},${gz}`;
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
      }
  });
  const rank = (b: BuildingRec) => (b.heightSource === 'osm:height' ? 3 : b.heightSource === 'osm:levels' ? 2 : 1);
  const removed = new Set<number>();
  const covered = new Float64Array(n);
  const biggestInner = new Int32Array(n).fill(-1);
  let dup = 0;
  for (let i = 0; i < n; i++) {
    if (buildings[i].canopy) continue;
    const ci = info[i].c;
    for (const j of grid.get(`${Math.floor(ci[0] / 50)},${Math.floor(ci[1] / 50)}`) ?? []) {
      if (j === i || buildings[j].canopy || removed.has(j) || removed.has(i)) continue;
      if (!pointInPolygon(ci, buildings[j].poly.outer)) continue;
      const ratio = info[i].area / Math.max(1, info[j].area);
      if (ratio > 0.85 && ratio < 1.18 && pointInPolygon(info[j].c, buildings[i].poly.outer)) {
        // (a) duplicata
        const keep = rank(buildings[i]) > rank(buildings[j]) || (rank(buildings[i]) === rank(buildings[j]) && buildings[i].height >= buildings[j].height) ? i : j;
        const drop = keep === i ? j : i;
        if (!buildings[keep].name && buildings[drop].name) buildings[keep].name = buildings[drop].name;
        removed.add(drop);
        dup++;
      } else if (buildings[j].heightSource === 'estimate' && buildings[i].heightSource !== 'estimate') {
        covered[j] += info[i].area;
        if (biggestInner[j] < 0 || info[i].area > info[biggestInner[j]].area) biggestInner[j] = i;
      }
    }
  }
  let outl = 0;
  for (let j = 0; j < n; j++) {
    if (removed.has(j) || buildings[j].heightSource !== 'estimate') continue;
    if (covered[j] >= info[j].area * 0.4) {
      const bi = biggestInner[j];
      if (bi >= 0 && buildings[j].name && !buildings[bi].name) buildings[bi].name = buildings[j].name;
      removed.add(j);
      outl++;
    }
  }
  const kept = buildings.filter((_, i) => !removed.has(i));
  buildings.length = 0;
  buildings.push(...kept);
  console.log(`[process] dedup: ${dup} duplicatas, ${outl} contornos estimados sobre volumes reais removidos`);
}
// correções documentadas (data/overrides/buildings.json)
{
  const ov = JSON.parse(readFileSync('data/overrides/buildings.json', 'utf8')) as { byName: Record<string, { height?: number; style?: string; tint?: number; plain?: boolean }> };
  const styleMap: Record<string, FacadeStyle> = { eclectic: FacadeStyle.Eclectic, institutional: FacadeStyle.Institutional, artdeco: FacadeStyle.ArtDecoPiers, office: FacadeStyle.ModernOffice, classic: FacadeStyle.ClassicPunched };
  let applied = 0;
  for (const b of buildings) {
    const o = b.name ? ov.byName[b.name] : undefined;
    if (!o) continue;
    if (o.height) { b.height = o.height; b.heightSource = 'estimate'; b.levels = Math.round(o.height / 3.8); (b as any).override = true; }
    if (o.style) b.style = styleMap[o.style] ?? b.style;
    if (o.tint !== undefined) b.tint = o.tint;
    if (o.plain) b.plain = true;
    if (b.cls === 'C' || b.cls === 'D') b.cls = 'B';
    b.arcade = undefined;
    applied++;
  }
  console.log(`[process] overrides aplicados: ${applied}`);
}
console.log(`[process] edifícios=${buildings.length} (substituídos por partes: ${partsByParent.size})`);

// ---------------------------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------------------------
const areas: AreaRec[] = [];
function areaKind(t: Record<string, string>): AreaRec['kind'] | null {
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.landuse === 'village_green' || t.natural === 'grassland' || t.landuse === 'flowerbed') return 'grass';
  if (t.leisure === 'pitch' || t.leisure === 'playground') return 'pitch';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || t['area:highway'] === 'pedestrian') return 'plaza';
  if (t.amenity === 'parking' && (t.parking ?? 'surface') === 'surface') return 'parking';
  if ((t.railway === 'platform' || t.public_transport === 'platform') && (parseNum(t.layer) ?? 0) >= 0 && !t.tunnel) return 'platform';
  if (t.natural === 'water' && t.water !== 'river') return 'water';
  if (t.landuse === 'railway') return 'rail_yard';
  return null;
}
for (const w of ds.ways.values()) {
  const t = w.tags;
  if (!t || w.nodes[0] !== w.nodes[w.nodes.length - 1] || w.nodes.length < 4) continue;
  const k = areaKind(t);
  if (!k) continue;
  // plataformas de ônibus mapeadas como áreas não são elevadas
  if (k === 'platform' && (t.bus === 'yes' || t.highway === 'platform')) continue;
  areas.push({ kind: k, poly: { outer: openRing(ds.wayPts(w)) }, ...(t.name ? { name: t.name } : {}) });
}
for (const r of ds.rels.values()) {
  const t = r.tags;
  if (!t || t.type !== 'multipolygon') continue;
  const k = areaKind(t);
  if (!k) continue;
  const { outers, inners } = ds.multipolygonRings(r);
  for (const o of outers) {
    areas.push({ kind: k, poly: { outer: openRing(o), holes: inners.filter((i) => pointInPolygon(i[0], o)).map(openRing) }, ...(t.name ? { name: t.name } : {}) });
  }
}

// ---------------------------------------------------------------------------------------------
// Linhas (trilhos, VLT, cercas, muros)
// ---------------------------------------------------------------------------------------------
const lines: LineRec[] = [];
for (const w of ds.ways.values()) {
  const t = w.tags;
  if (!t) continue;
  const layer = parseNum(t.layer) ?? 0;
  if (t.tunnel && t.tunnel !== 'no') continue;
  if (layer < 0) continue;
  if (t.railway === 'rail' || t.railway === 'light_rail') lines.push({ kind: 'rail', pts: ds.wayPts(w) });
  else if (t.railway === 'tram') lines.push({ kind: 'tram', pts: ds.wayPts(w) });
  else if (t.barrier === 'fence') lines.push({ kind: 'fence', pts: ds.wayPts(w) });
  else if (t.barrier === 'wall') lines.push({ kind: 'wall', pts: ds.wayPts(w) });
}

// ---------------------------------------------------------------------------------------------
// Mobiliário e vegetação
// ---------------------------------------------------------------------------------------------
const props: PropRec[] = [];
for (const n of ds.nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  const p = ds.xz(n.id)!;
  const r = round2(hash32(n.id) * Math.PI * 2);
  if (t.natural === 'tree') {
    const palm = /palm|Roystonea|Arecaceae|Syagrus|Cocos/i.test(`${t.genus ?? ''} ${t.species ?? ''} ${t.taxon ?? ''} ${t.leaf_type ?? ''}`);
    props.push({ k: palm ? 'palm' : 'tree', p, r, s: round2(0.8 + hash32(n.id + 11) * 0.5) });
  } else if (t.highway === 'street_lamp') props.push({ k: 'lamp', p, r });
  else if (t.amenity === 'bench') props.push({ k: 'bench', p, r });
  else if (t.highway === 'bus_stop' && t.shelter === 'yes') props.push({ k: 'bus_stop', p, r });
  else if (t.highway === 'bus_stop') props.push({ k: 'bus_pole', p, r });
  else if (t.barrier === 'bollard') props.push({ k: 'bollard', p });
  else if (t.amenity === 'waste_basket') props.push({ k: 'waste', p });
  else if (t.shop === 'kiosk' || t.amenity === 'kiosk') props.push({ k: 'kiosk', p, r });
}
for (const w of ds.ways.values()) {
  if (w.tags?.natural === 'tree_row') {
    for (const s of samplePolyline(ds.wayPts(w), 8, 2)) props.push({ k: 'tree', p: [round2(s.p[0]), round2(s.p[1])], r: round2(s.dir), s: 1 });
  }
}

// Postes procedurais ao longo da Presidente Vargas onde o OSM não tem postes mapeados
// (documentado em docs/DATA_SOURCES.md e MAP_VALIDATION.md como "procedural")
{
  const lamps = props.filter((p) => p.k === 'lamp');
  let added = 0;
  for (const r of pvRoads) {
    // canteiro: lado esquerdo das pistas centrais; calçada: lado direito das pistas laterais
    const side = r.pvRole === 'central' ? -1 : 1;
    const off = r.width / 2 + 1.2;
    for (const s of samplePolyline(r.pts, 34, 10)) {
      const nx = -Math.sin(s.dir), nz = Math.cos(s.dir); // normal à direita do sentido
      const p: XZ = [round2(s.p[0] + nx * off * side), round2(s.p[1] + nz * off * side)];
      if (lamps.some((l) => Math.hypot(l.p[0] - p[0], l.p[1] - p[1]) < 18)) continue;
      const lamp: PropRec = { k: 'lamp', p, r: round2(s.dir + (side > 0 ? Math.PI : 0)), proc: 1 };
      props.push(lamp);
      lamps.push(lamp);
      added++;
    }
  }
  console.log(`[process] postes procedurais na Presidente Vargas: ${added}`);
}

// ---------------------------------------------------------------------------------------------
// Monumentos (posições reais OSM)
// ---------------------------------------------------------------------------------------------
const monuments: { kind: string; p: XZ; name?: string; r?: number; base?: number }[] = [];
for (const n of ds.nodes.values()) {
  const t = n.tags;
  if (!t) continue;
  const p = ds.xz(n.id)!;
  const name = t.name;
  let kind: string | null = null;
  if (/Kintetic|Kinetic|Pira/i.test(name ?? '')) kind = 'kinetic';
  else if (t.memorial === 'statue' && /Caxias/.test(name ?? '')) kind = 'equestrian'; // estátua equestre de Caxias (Praça Duque de Caxias)
  else if (t.memorial === 'bust' || t.artwork_type === 'bust') kind = 'bust';
  else if (t.memorial === 'statue' || t.artwork_type === 'statue') kind = 'statue';
  else if (t.amenity === 'clock') kind = 'clock';
  if (!kind) continue;
  if (distPointPolyline(p, pvAxis) > 170) continue;
  // base: altura do edifício/pedestal mapeado sob o monumento (ex.: Panteão de Caxias)
  const under = buildings.find((b) => !b.canopy && pointInPolygon(p, b.poly.outer));
  monuments.push({ kind, p, ...(name ? { name } : {}), ...(under ? { base: under.height } : {}) });
}
console.log(`[process] monumentos: ${monuments.map((m) => m.kind + (m.name ? ':' + m.name : '')).join(', ')}`);

// ---------------------------------------------------------------------------------------------
// Pontos de validação
// ---------------------------------------------------------------------------------------------
const validation: ValidationPoint[] = [];
function addVP(key: string, label: string, p: XZ, radius = 40) {
  const ll = proj.toLatLon(p[0], p[1]);
  validation.push({ key, label, p: [round2(p[0]), round2(p[1])], lat: +ll.lat.toFixed(7), lon: +ll.lon.toFixed(7), radius });
}
for (const l of landmarks) addVP(l.key, l.name, l.center, 90);
const NAMED_AREAS: [string, string, (t: Record<string, string>) => boolean][] = [
  ['CAMPO_DE_SANTANA', 'Campo de Santana (Praça da República)', (t) => t.name === 'Campo de Santana' && t.leisure === 'park'],
  ['PRACA_DUQUE_DE_CAXIAS', 'Praça Duque de Caxias', (t) => t.name === 'Praça Duque de Caxias'],
  ['PANTEAO_CAXIAS', 'Panteão de Caxias', (t) => /Pantheon de Caxias|Panteão/.test(t.name ?? '')],
  ['PALACIO_DUQUE_DE_CAXIAS', 'Palácio Duque de Caxias', (t) => t.name === 'Palácio Duque de Caxias'],
  ['PALACIO_ITAMARATY', 'Palácio do Itamaraty', (t) => t.name === 'Palácio do Itamaraty'],
  ['COLEGIO_PEDRO_II', 'Colégio Pedro II — Centro', (t) => /Colégio Pedro II/.test(t.name ?? '')],
  ['CAMELODROMO_URUGUAIANA', 'Mercado Popular da Uruguaiana', (t) => /Mercado Popular da Uruguaiana - Quadra A/.test(t.name ?? '')],
  ['CENTRO_CULTURAL_CORREIOS', 'Centro Cultural Correios', (t) => t.name === 'Centro Cultural Correios'],
  ['PRACA_PIO_X', 'Praça Pio X', (t) => t.name === 'Praça Pio X' && t.leisure === 'park'],
];
for (const [key, label, match] of NAMED_AREAS) {
  const w = [...ds.ways.values()].find((x) => x.tags && match(x.tags) && x.nodes[0] === x.nodes[x.nodes.length - 1]);
  if (w) { addVP(key, label, centroid(openRing(ds.wayPts(w))), 60); continue; }
  const r = [...ds.rels.values()].find((x) => x.tags && match(x.tags));
  if (r) {
    const { outers } = ds.multipolygonRings(r);
    if (outers[0]) addVP(key, label, centroid(openRing(outers[0])), 60);
  }
}
// estações de metrô
for (const n of ds.nodes.values()) {
  const t = n.tags;
  if (t?.railway === 'station' && t.station === 'subway' && t.name) {
    addVP('METRO_' + slug(t.name), `Metrô — ${t.name}`, ds.xz(n.id)!, 35);
  }
}
// cruzamentos com a Presidente Vargas (nós compartilhados com vias nomeadas)
{
  const pvNodeSet = new Set<number>();
  for (const r of pvRoads) for (const n of ds.ways.get(r.id)!.nodes) pvNodeSet.add(n);
  const byName = new Map<string, XZ[]>();
  for (const r of roads) {
    if (r.presidenteVargas || !r.name) continue;
    for (const n of ds.ways.get(r.id)!.nodes) {
      if (pvNodeSet.has(n)) {
        const arr = byName.get(r.name) ?? [];
        arr.push(ds.xz(n)!);
        byName.set(r.name, arr);
      }
    }
  }
  for (const [name, pts] of byName) {
    const c: XZ = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    if (distPointPolyline(c, pvAxis) > 45) continue;
    addVP('INTERSECTION_' + slug(name.replace(/^(Avenida|Rua|Praça|Travessa|Largo)\s+/, '')), `Cruzamento: ${name} × Pres. Vargas`, c, 30);
  }
}
console.log(`[process] pontos de validação: ${validation.length}`);

function slug(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ---------------------------------------------------------------------------------------------
// Spawn: sobre a Praça Cristiano Ottoni / início da Pres. Vargas, de frente para a Candelária
// ---------------------------------------------------------------------------------------------
const central = landmarks.find((l) => l.key === 'LANDMARK_CENTRAL')!;
// ponto do eixo mais próximo da Central, avançado ~150 m em direção leste
function axisPointAtDistance(fromIdx: number, dist: number): { p: XZ; dir: number } {
  let rem = dist;
  for (let i = fromIdx; i < pvAxis.length - 1; i++) {
    const a = pvAxis[i], b = pvAxis[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (rem <= l) return { p: [a[0] + ((b[0] - a[0]) * rem) / l, a[1] + ((b[1] - a[1]) * rem) / l], dir };
    rem -= l;
  }
  const a = pvAxis[pvAxis.length - 2], b = pvAxis[pvAxis.length - 1];
  return { p: b, dir: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
let startIdx = 0;
{
  let bd = Infinity;
  pvAxis.forEach((p, i) => {
    const d = Math.hypot(p[0] - central.center[0], p[1] - central.center[1]);
    if (d < bd) { bd = d; startIdx = i; }
  });
}
const sp = axisPointAtDistance(startIdx, 45);
const spawn = { p: [round2(sp.p[0]), round2(sp.p[1])] as XZ, yaw: sp.dir };

// ---------------------------------------------------------------------------------------------
const meta = JSON.parse(readFileSync('data/raw/osm_corridor.meta.json', 'utf8'));
mkdirSync('data/processed', { recursive: true });
const out = {
  generatedAt: new Date().toISOString(),
  origin: WORLD_ORIGIN,
  source: meta,
  landmarks, roads, pvAxis, crossings, crossingWays, signals, buildings, areas, lines, props, validation, spawn, monuments,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`[process] → ${OUT}`);
console.log(`  landmarks: ${landmarks.map((l) => `${l.key} ${l.length.toFixed(0)}×${l.width.toFixed(0)}m eixo ${(l.axis * 180 / Math.PI).toFixed(1)}°`).join(' | ')}`);
console.log(`  eixo PV: ${pvAxis.length} pts, ${pvAxis[0]} → ${pvAxis[pvAxis.length - 1]}`);
console.log(`  props: ${props.length}, áreas: ${areas.length}, linhas: ${lines.length}, travessias: ${crossings.length}+${crossingWays.length} ways, semáforos: ${signals.length}`);

export type { OsmWay, OsmRel, Poly };
