/**
 * Edifícios procedurais a partir dos footprints reais do OSM (alturas reais preservadas).
 *
 * Geometria: paredes extrudadas (base → topo) + cobertura triangulada; no LOD próximo
 * (`roofDetails`) também platibanda (face interna + rufo), marquises sobre o térreo comercial,
 * casas de máquinas/reservatórios nos prédios altos e caixas d'água de fibra nos telhados baixos.
 * Aparência: UM material compartilhado (facadeShader.ts); toda a variedade vem de atributos por
 * vértice (estilo, altura do pavimento, cor, semente, flags) interpretados no shader de fachada.
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { FacadeStyle } from '../types';
import { timeUniforms } from '../../renderer/timeOfDay';
import { renderQuality } from '../../renderer/quality';
import {
  FACADE_FLAGS, FACADE_VERTEX_COMMON, FACADE_VERTEX_MAIN, FACADE_FRAGMENT_COMMON, FACADE_FRAGMENT_MAIN, FACADE_NORMAL,
} from './facadeShader';

// atributos: aFacade = (style, floorHeight, tint, seed) ; aFacade2 = (height, minHeight, flags, groundFloorH)
const FLAG_ARCADE = FACADE_FLAGS.ARCADE, FLAG_ROOF = FACADE_FLAGS.ROOF, FLAG_SHOPS = FACADE_FLAGS.SHOPS, FLAG_CANOPY = FACADE_FLAGS.CANOPY;
const FLAG_PARAPET = FACADE_FLAGS.PARAPET, FLAG_MARQUISE = FACADE_FLAGS.MARQUISE, FLAG_TECH = FACADE_FLAGS.TECH, FLAG_TANK = FACADE_FLAGS.TANK;
/** altura da platibanda (a laje de cobertura fica abaixo do topo real; o topo OSM não muda) */
const PARAPET_H = 1.0;

interface Acc {
  pos: number[]; nor: number[]; uv: number[]; f1: number[]; f2: number[]; idx: number[];
}
const newAcc = (): Acc => ({ pos: [], nor: [], uv: [], f1: [], f2: [], idx: [] });

function signedArea(pts: XZ[]) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  return a / 2;
}

function floorHeightFor(b: BuildingRec): number {
  if (b.plain) return 99; // shader: parede lisa
  if (b.style === FacadeStyle.Sobrado) return Math.max(3.4, Math.min(4.6, b.height / Math.max(1, b.levels)));
  if (b.heightSource === 'osm:height' || b.heightSource === 'osm:levels') {
    const lv = Math.max(1, Math.round(b.height / 3.15));
    return b.height / lv;
  }
  return 3.2;
}

import { arcadeSpans, type ArcadeSpan } from '../arcades';
import { assetManager } from '../../core/AssetManager';
export { arcadeSpans, ARCADE_HEIGHT, type ArcadeSpan } from '../arcades';

/** quad com winding coerente com a normal dada */
function quad(acc: Acc, v: number[][], n: number[], uvs: number[][], f1: number[], f2: number[]) {
  const base = acc.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    acc.pos.push(v[k][0], v[k][1], v[k][2]);
    acc.nor.push(n[0], n[1], n[2]);
    acc.uv.push(uvs[k][0], uvs[k][1]);
    acc.f1.push(...f1);
    acc.f2.push(...f2);
  }
  const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function addArcades(acc: Acc, b: BuildingRec, spans: ArcadeSpan[], f1: number[], f2: number[]) {
  const y0 = b.minHeight;
  const shopF2 = [f2[0], f2[1], FLAG_SHOPS, 0];
  const plainF1 = [f1[0], 99, f1[2], f1[3]];
  for (const s of spans) {
    const H = s.height;
    const len = Math.hypot(s.c[0] - s.a[0], s.c[1] - s.a[1]);
    const ux = (s.c[0] - s.a[0]) / len, uz = (s.c[1] - s.a[1]) / len;
    const shopF = [...shopF2];
    shopF[3] = H; // térreo de lojas ocupa a altura da galeria
    // parede interna (vitrines/lojas), voltada para a rua
    quad(acc, [[s.ai[0], y0, s.ai[1]], [s.ci[0], y0, s.ci[1]], [s.ci[0], H, s.ci[1]], [s.ai[0], H, s.ai[1]]], [s.n[0], 0, s.n[1]],
      [[0, y0], [len, y0], [len, H], [0, H]], f1, shopF);
    // teto da galeria
    quad(acc, [[s.a[0], H, s.a[1]], [s.c[0], H, s.c[1]], [s.ci[0], H, s.ci[1]], [s.ai[0], H, s.ai[1]]], [0, -1, 0],
      [[s.a[0], s.a[1]], [s.c[0], s.c[1]], [s.ci[0], s.ci[1]], [s.ai[0], s.ai[1]]], plainF1, [f2[0], f2[1], 0, 0]);
    // fechamentos laterais do recuo
    quad(acc, [[s.a[0], y0, s.a[1]], [s.ai[0], y0, s.ai[1]], [s.ai[0], H, s.ai[1]], [s.a[0], H, s.a[1]]], [ux, 0, uz],
      [[0, y0], [s.depth, y0], [s.depth, H], [0, H]], plainF1, [f2[0], f2[1], 0, 0]);
    quad(acc, [[s.c[0], y0, s.c[1]], [s.ci[0], y0, s.ci[1]], [s.ci[0], H, s.ci[1]], [s.c[0], H, s.c[1]]], [-ux, 0, -uz],
      [[0, y0], [s.depth, y0], [s.depth, H], [0, H]], plainF1, [f2[0], f2[1], 0, 0]);
    // colunas
    for (const col of s.columns) {
      const w = 0.3;
      const corners: XZ[] = [
        [col[0] - ux * w - s.n[0] * w, col[1] - uz * w - s.n[1] * w], [col[0] + ux * w - s.n[0] * w, col[1] + uz * w - s.n[1] * w],
        [col[0] + ux * w + s.n[0] * w, col[1] + uz * w + s.n[1] * w], [col[0] - ux * w + s.n[0] * w, col[1] - uz * w + s.n[1] * w],
      ];
      for (let k = 0; k < 4; k++) {
        const p0 = corners[k], p1 = corners[(k + 1) % 4];
        const mx = (p0[0] + p1[0]) / 2 - col[0], mz = (p0[1] + p1[1]) / 2 - col[1];
        const l = Math.hypot(mx, mz) || 1;
        quad(acc, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], H, p1[1]], [p0[0], H, p0[1]]], [mx / l, 0, mz / l],
          [[0, y0], [0.6, y0], [0.6, H], [0, H]], plainF1, [f2[0], f2[1], 0, 0]);
      }
    }
  }
}

const edgeKey = (a: XZ, c: XZ) => {
  const k1 = `${a[0]},${a[1]}`, k2 = `${c[0]},${c[1]}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
};

/** Paredes de um anel (externo ou buraco). `outward` garante normais para fora do volume. */
function addWalls(acc: Acc, ring: XZ[], isHole: boolean, b: BuildingRec, f1: number[], f2: number[], arcadeKeys?: Map<string, number>) {
  const n = ring.length;
  // garantir orientação: externos CCW no plano (x,z) visto de cima → normais para fora
  let pts = ring;
  const area = signedArea(ring);
  // com esta fórmula (= −shoelace), área NEGATIVA é a orientação em que (dz, −dx) aponta para fora
  if ((area > 0) !== isHole) pts = [...ring].reverse();
  let perim = b.seed * 37; // deslocamento para que prédios vizinhos não alinhem janelas
  const y1 = b.height;
  for (let i = 0; i < n; i++) {
    const a = pts[i], c = pts[(i + 1) % n];
    // fachada sobre galeria: começa no teto da galeria
    const y0 = arcadeKeys?.get(edgeKey(a, c)) ?? b.minHeight;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len, nz = -dx / len;
    const base = acc.pos.length / 3;
    acc.pos.push(a[0], y0, a[1], c[0], y0, c[1], c[0], y1, c[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) acc.nor.push(nx, 0, nz);
    acc.uv.push(perim, y0, perim + len, y0, perim + len, y1, perim, y1);
    for (let k = 0; k < 4; k++) { acc.f1.push(...f1); acc.f2.push(...f2); }
    acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    perim += len;
  }
}

function addRoof(acc: Acc, b: BuildingRec, y: number, f1: number[], f2: number[], down = false) {
  const outer = b.poly.outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = (b.poly.holes ?? []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return;
  }
  const all = outer.concat(...holes);
  const base = acc.pos.length / 3;
  const rf2 = [f2[0], f2[1], f2[2] | FLAG_ROOF, f2[3]];
  for (const p of all) {
    acc.pos.push(p.x, y, p.y);
    acc.nor.push(0, down ? -1 : 1, 0);
    acc.uv.push(p.x, p.y);
    acc.f1.push(...f1);
    acc.f2.push(...rf2);
  }
  for (const t of tris) {
    const p0 = all[t[0]], p1 = all[t[1]], p2 = all[t[2]];
    const cy = (p1.y - p0.y) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.y - p0.y);
    if ((cy > 0) !== down) acc.idx.push(base + t[0], base + t[1], base + t[2]);
    else acc.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/** Caixa (volumes técnicos de cobertura). */
function addBox(acc: Acc, cx: number, cz: number, w: number, d: number, y0: number, h: number, rot: number, f1: number[], _f2: number[]) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const corner = (u: number, v: number): XZ => [cx + u * c - v * s, cz + u * s + v * c];
  const ring: XZ[] = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
  const fake: BuildingRec = {
    id: 0, poly: { outer: ring }, height: y0 + h, minHeight: y0, levels: 1, heightSource: 'estimate', cls: 'D',
    style: FacadeStyle.Institutional, tint: f1[2], seed: f1[3],
  };
  const bf2 = [y0 + h, y0, FLAG_TECH, 0];
  addWalls(acc, ring, false, fake, [FacadeStyle.Institutional, 99, f1[2], f1[3]], bf2);
  addRoof(acc, fake, y0 + h, [FacadeStyle.Institutional, 99, f1[2], f1[3]], bf2);
}

/** Anel orientado de modo que (dz, −dx)/len seja a normal para FORA do volume (mesma regra de addWalls). */
function orientRing(ring: XZ[], isHole: boolean): XZ[] {
  const area = signedArea(ring);
  return (area > 0) !== isHole ? [...ring].reverse() : ring;
}

/** Platibanda: face interna (voltada para a laje) + rufo (topo) ao longo de cada aresta. */
function addParapet(acc: Acc, ring: XZ[], isHole: boolean, yRoof: number, yTop: number, f1: number[], f2: number[]) {
  const pts = orientRing(ring, isHole);
  const t = 0.2;
  const pf2 = [f2[0], f2[1], FLAG_PARAPET, f2[3]];
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const nx = dz / len, nz = -dx / len;
    const ai: XZ = [a[0] - nx * t, a[1] - nz * t], ci: XZ = [c[0] - nx * t, c[1] - nz * t];
    quad(acc, [[ai[0], yRoof, ai[1]], [ci[0], yRoof, ci[1]], [ci[0], yTop, ci[1]], [ai[0], yTop, ai[1]]], [-nx, 0, -nz],
      [[perim + len, yRoof], [perim, yRoof], [perim, yTop], [perim + len, yTop]], f1, pf2);
    quad(acc, [[a[0], yTop, a[1]], [c[0], yTop, c[1]], [ci[0], yTop, ci[1]], [ai[0], yTop, ai[1]]], [0, 1, 0],
      [[a[0], a[1]], [c[0], c[1]], [ci[0], ci[1]], [ai[0], ai[1]]], f1, pf2);
    perim += len;
  }
}

/** Marquise de concreto sobre o térreo comercial (arestas externas sem galeria). */
function addMarquises(acc: Acc, b: BuildingRec, y: number, depth: number, f1: number[], f2: number[], skip?: Map<string, number>) {
  const pts = orientRing(b.poly.outer, false);
  const th = 0.16;
  const mf2 = [f2[0], f2[1], FLAG_MARQUISE, f2[3]];
  let count = 0;
  for (let i = 0; i < pts.length && count < 6; i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length];
    if (skip?.has(edgeKey(a, c))) continue;
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 5) continue;
    const ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
    const inset = 0.3;
    const p0: XZ = [a[0] + ux * inset, a[1] + uz * inset], p1: XZ = [c[0] - ux * inset, c[1] - uz * inset];
    const q0: XZ = [p0[0] + nx * depth, p0[1] + nz * depth], q1: XZ = [p1[0] + nx * depth, p1[1] + nz * depth];
    const y0 = y - th, y1 = y;
    const L = len - 2 * inset;
    // fundo (spots), topo, testeira e laterais
    quad(acc, [[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [q1[0], y0, q1[1]], [q0[0], y0, q0[1]]], [0, -1, 0],
      [[p0[0], p0[1]], [p1[0], p1[1]], [q1[0], q1[1]], [q0[0], q0[1]]], f1, mf2);
    quad(acc, [[p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [q1[0], y1, q1[1]], [q0[0], y1, q0[1]]], [0, 1, 0],
      [[p0[0], p0[1]], [p1[0], p1[1]], [q1[0], q1[1]], [q0[0], q0[1]]], f1, mf2);
    quad(acc, [[q0[0], y0, q0[1]], [q1[0], y0, q1[1]], [q1[0], y1 + 0.06, q1[1]], [q0[0], y1 + 0.06, q0[1]]], [nx, 0, nz],
      [[0, y0], [L, y0], [L, y1 + 0.06], [0, y1 + 0.06]], f1, mf2);
    quad(acc, [[p0[0], y0, p0[1]], [q0[0], y0, q0[1]], [q0[0], y1, q0[1]], [p0[0], y1, p0[1]]], [-ux, 0, -uz],
      [[0, y0], [depth, y0], [depth, y1], [0, y1]], f1, mf2);
    quad(acc, [[p1[0], y0, p1[1]], [q1[0], y0, q1[1]], [q1[0], y1, q1[1]], [p1[0], y1, p1[1]]], [ux, 0, uz],
      [[0, y0], [depth, y0], [depth, y1], [0, y1]], f1, mf2);
    count++;
  }
}

/** Caixa d'água cilíndrica (fibra), 8 lados. */
function addTank(acc: Acc, cx: number, cz: number, r: number, y0: number, h: number, f1: number[]) {
  const tf2 = [y0 + h, y0, FLAG_TANK, 0];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
    quad(acc, [[x0, y0, z0], [x1, y0, z1], [x1, y0 + h, z1], [x0, y0 + h, z0]], [Math.cos(am), 0, Math.sin(am)],
      [[0, y0], [1, y0], [1, y0 + h], [0, y0 + h]], f1, tf2);
    // tampa (leque a partir do centro, em quads degenerados)
    quad(acc, [[cx, y0 + h + 0.12, cz], [x0, y0 + h, z0], [x1, y0 + h, z1], [cx, y0 + h + 0.12, cz]], [0, 1, 0],
      [[cx, cz], [x0, z0], [x1, z1], [cx, cz]], f1, tf2);
  }
}

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface BuildingBuildOptions {
  /** ignora edifícios mais baixos que isso (LOD distante) */
  minHeight?: number;
  /** adiciona volumes de cobertura */
  roofDetails?: boolean;
}

export function buildBuildingsGeometry(buildings: BuildingRec[], opts: BuildingBuildOptions = {}): THREE.BufferGeometry | null {
  const acc = newAcc();
  for (const b of buildings) {
    if (opts.minHeight && b.height < opts.minHeight) continue;
    const fh = floorHeightFor(b);
    let flags = 0;
    if (b.arcade) flags |= FLAG_ARCADE;
    if (b.canopy) flags |= FLAG_CANOPY;
    if (!b.canopy && b.minHeight < 0.5 && b.style !== FacadeStyle.Institutional && b.style !== FacadeStyle.Eclectic && b.height < 120) flags |= FLAG_SHOPS;
    const groundH = b.arcade ? 6.5 : b.style === FacadeStyle.Sobrado ? Math.min(4.2, fh) : Math.min(4.5, Math.max(3.6, fh * 1.2));
    const f1 = [b.style, fh, b.tint, b.seed];
    const f2 = [b.height, b.minHeight, flags, groundH];
    const spans = arcadeSpans(b);
    const keys = spans.length ? new Map(spans.map((sp) => [edgeKey(sp.a, sp.c), sp.height] as [string, number])) : undefined;
    // com galeria geométrica, o shader não pinta mais a galeria falsa
    if (spans.length) f2[2] &= ~FLAG_ARCADE;
    addWalls(acc, b.poly.outer, false, b, f1, f2, keys);
    for (const h of b.poly.holes ?? []) addWalls(acc, h, true, b, f1, f2);
    if (spans.length) addArcades(acc, b, spans, f1, f2);
    const details = opts.roofDetails !== false;
    const parapet = details && !b.canopy && !b.plain && b.height - b.minHeight > 5 && b.cls !== 'D';
    if (parapet) {
      const yRoof = b.height - PARAPET_H;
      addRoof(acc, b, yRoof, f1, f2);
      addParapet(acc, b.poly.outer, false, yRoof, b.height, f1, f2);
      for (const h of b.poly.holes ?? []) addParapet(acc, h, true, yRoof, b.height, f1, f2);
    } else {
      addRoof(acc, b, b.height, f1, f2);
    }
    if (b.canopy) addRoof(acc, b, b.minHeight, f1, f2, true);
    // marquises sobre lojas (parte dos prédios; determinístico pela semente)
    if (details && (flags & FLAG_SHOPS) && !b.arcade && b.minHeight < 0.5 && b.height > 7) {
      const chance = b.style === FacadeStyle.Sobrado ? 0.35 : 0.7;
      if (((b.seed * 7.31) % 1) < chance) addMarquises(acc, b, groundH - 0.05, 1.4 + ((b.seed * 3.7) % 1) * 0.9, f1, f2, keys);
    }
    // caixas d'água de fibra nos telhados baixos (sobrados/prédios pequenos)
    if (details && parapet && b.height < 22 && b.cls !== 'D') {
      const ring = b.poly.outer;
      let cx = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cz += p[1]; }
      cx /= ring.length; cz /= ring.length;
      const area = Math.abs(signedArea(ring));
      const r = 0.55 + ((b.seed * 5.3) % 1) * 0.35;
      if (area > 40 && ((b.seed * 11.7) % 1) < 0.7) {
        const ox = (((b.seed * 2.9) % 1) - 0.5) * Math.sqrt(area) * 0.4, oz = (((b.seed * 4.1) % 1) - 0.5) * Math.sqrt(area) * 0.4;
        const pts: XZ[] = [[cx + ox, cz + oz], [cx + ox, cz + oz + r], [cx + ox + r, cz + oz], [cx + ox - r, cz + oz], [cx + ox, cz + oz - r]];
        if (pts.every((q) => pointInRing(q, ring))) addTank(acc, cx + ox, cz + oz, r, b.height - PARAPET_H, 1.0 + r * 0.4, f1);
      }
    }

    // volumes técnicos na cobertura (prédios ≥ 6 pavimentos, determinístico pela semente)
    if (parapet && b.height > 20) {
      const ring = b.poly.outer;
      let cx = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cz += p[1]; }
      cx /= ring.length; cz /= ring.length;
      if (pointInRing([cx, cz], ring)) {
        // orientação pela aresta mais longa
        let best = 0, rot = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], c = ring[(i + 1) % ring.length];
          const l = Math.hypot(c[0] - a[0], c[1] - a[1]);
          if (l > best) { best = l; rot = Math.atan2(c[1] - a[1], c[0] - a[0]); }
        }
        const area = Math.abs(signedArea(ring));
        const s = Math.min(9, Math.sqrt(area) * 0.32);
        if (s > 2.5) {
          const boxH = 2.6 + b.seed * 2.2;
          addBox(acc, cx, cz, s, s * (0.6 + b.tint * 0.5), b.height - PARAPET_H, boxH + PARAPET_H, rot, f1, f2);
          if (b.seed > 0.45 && s > 4) {
            const ox = Math.cos(rot) * s * 0.75, oz = Math.sin(rot) * s * 0.75;
            if (pointInRing([cx + ox, cz + oz], ring)) addBox(acc, cx + ox, cz + oz, s * 0.45, s * 0.45, b.height - PARAPET_H, 1.8 + PARAPET_H, rot, f1, f2);
          }
        }
      }
    }
  }
  if (!acc.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute(acc.f1, 4));
  g.setAttribute('aFacade2', new THREE.Float32BufferAttribute(acc.f2, 4));
  g.setIndex(acc.idx.length > 65535 ? new THREE.Uint32BufferAttribute(acc.idx, 1) : new THREE.Uint16BufferAttribute(acc.idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// -------------------------------------------------------------------------------------------
// Material com shader de fachada procedural (ver facadeShader.ts)
// -------------------------------------------------------------------------------------------
/** Palavras GENÉRICAS de comércio do Centro (sem marcas reais) para os letreiros das lojas. */
const SIGN_WORDS = [
  'MODAS', 'CALÇADOS', 'BAZAR', 'PAPELARIA', 'DROGARIA', 'ÓTICA', 'LANCHONETE', 'TECIDOS',
  'ARMARINHO', 'RELOJOARIA', 'CELULARES', 'PADARIA', 'CAFÉ & BAR', 'PRESENTES', 'BIJUTERIAS', 'ELETRÔNICOS',
];

/** Atlas 512×1024 (16 linhas de 8:1) desenhado em canvas no carregamento — custo de download zero. */
function signAtlas(): THREE.Texture {
  const W = 512, H = 1024, row = H / SIGN_WORDS.length;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  SIGN_WORDS.forEach((w, i) => {
    let size = row * 0.78;
    g.font = `bold ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`;
    const mw = g.measureText(w).width;
    if (mw > W * 0.94) { size *= (W * 0.94) / mw; g.font = `bold ${size}px "Arial Narrow", Arial, Helvetica, sans-serif`; }
    g.fillText(w, W / 2, i * row + row * 0.54);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  assetManager.releaseCpuAfterUpload(t); // canvas estático: solto após o upload
  return t;
}

export function createBuildingMaterial(noise: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
  // BAIXO: sem parallax/relevo (mesma paleta e composição; custo de fragmento menor)
  const detail = renderQuality.level === 'low' ? 0 : 1;
  const signs = signAtlas();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoise = { value: noise };
    shader.uniforms.uNight = timeUniforms.night;
    shader.uniforms.uSunDir = timeUniforms.sunDir;
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uSigns = { value: signs };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FACADE_VERTEX_COMMON}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${FACADE_VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAGMENT_COMMON}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FACADE_FRAGMENT_MAIN}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FACADE_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += fEmissive;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = fRough;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = fMetal;`);
  };
  mat.customProgramCacheKey = () => `pv-building-facade-v5-${detail}`;
  return mat;
}
