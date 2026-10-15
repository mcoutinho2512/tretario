/**
 * Superfícies do chão (por chunk): asfalto, calçadas, praças, gramados, plataformas, brita, água,
 * meio-fios (face vertical + capa de granito), sinalização horizontal e linhas (trilhos, VLT, gradis).
 * UV em metros (coordenadas do mundo) → texturas tileadas sem costuras entre chunks.
 */
import * as THREE from 'three';
import type { ChunkData, Poly, XZ, CrossingRec } from '../types';
import { CURB_HEIGHT, PLATFORM_HEIGHT } from '../types';
import type { MaterialLibrary } from '../../renderer/materials';

class GeoAcc {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  get count() { return this.pos.length / 3; }
  toGeometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Polígono horizontal triangulado com normal para cima. */
function addFlatPoly(acc: GeoAcc, poly: Poly, y: number) {
  const outer = poly.outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = (poly.holes ?? []).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  if (outer.length < 3) return;
  let tris: number[][];
  try {
    tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  } catch {
    return;
  }
  const all = outer.concat(...holes);
  const base = acc.count;
  for (const p of all) {
    acc.pos.push(p.x, y, p.y);
    acc.nor.push(0, 1, 0);
    acc.uv.push(p.x, -p.y);
  }
  for (const t of tris) {
    const p0 = all[t[0]], p1 = all[t[1]], p2 = all[t[2]];
    const cy = (p1.y - p0.y) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.y - p0.y);
    if (cy > 0) acc.idx.push(base + t[0], base + t[1], base + t[2]);
    else acc.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/** Faixa vertical ao longo de uma polilinha (meio-fio, borda de plataforma, muro). */
function addVerticalStrip(acc: GeoAcc, pts: XZ[], y0: number, y1: number, flip = false) {
  let along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    let nx = dz / len, nz = -dx / len;
    if (flip) { nx = -nx; nz = -nz; }
    const base = acc.count;
    acc.pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) acc.nor.push(nx, 0, nz);
    acc.uv.push(along, y0, along + len, y0, along + len, y1, along, y1);
    // winding coerente com a normal
    const cx = (b[1] - a[1]) * 0 ; void cx;
    if (!flip) acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    along += len;
  }
}

/** Faixa horizontal ao longo de uma polilinha (capa do meio-fio, marcações, leito de trilhos). */
function addRibbon(acc: GeoAcc, pts: XZ[], width: number, y: number, offset = 0, uAlong = true, vScale = 1) {
  if (pts.length < 2) return;
  const hw = width / 2;
  let along = 0;
  const left: XZ[] = [], right: XZ[] = [], dist: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const nx = -dz, nz = dx;
    if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    left.push([pts[i][0] + nx * (offset - hw), pts[i][1] + nz * (offset - hw)]);
    right.push([pts[i][0] + nx * (offset + hw), pts[i][1] + nz * (offset + hw)]);
    dist.push(along);
  }
  const base = acc.count;
  for (let i = 0; i < pts.length; i++) {
    acc.pos.push(left[i][0], y, left[i][1], right[i][0], y, right[i][1]);
    acc.nor.push(0, 1, 0, 0, 1, 0);
    if (uAlong) acc.uv.push(dist[i], 0, dist[i], vScale);
    else acc.uv.push(left[i][0], -left[i][1], right[i][0], -right[i][1]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    // orientar para cima
    const p0 = left[i], p1 = right[i], p2 = left[i + 1];
    const cy = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);
    if (cy > 0) acc.idx.push(a, b, c, b, d, c);
    else acc.idx.push(a, c, b, b, c, d);
  }
}

/** Quad horizontal orientado (zebras). */
function addQuad(acc: GeoAcc, c: XZ, ux: number, uz: number, halfU: number, halfV: number, y: number) {
  const vx = -uz, vz = ux;
  const p = [
    [c[0] - ux * halfU - vx * halfV, c[1] - uz * halfU - vz * halfV],
    [c[0] + ux * halfU - vx * halfV, c[1] + uz * halfU - vz * halfV],
    [c[0] + ux * halfU + vx * halfV, c[1] + uz * halfU + vz * halfV],
    [c[0] - ux * halfU + vx * halfV, c[1] - uz * halfU + vz * halfV],
  ];
  const base = acc.count;
  for (const q of p) {
    acc.pos.push(q[0], y, q[1]);
    acc.nor.push(0, 1, 0);
    acc.uv.push(q[0], -q[1]);
  }
  const cy = (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]);
  if (cy > 0) acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else acc.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/** Linhas tracejadas → quads curtos. */
function addDashes(acc: GeoAcc, pts: XZ[], width: number, dash: number, gap: number, y: number) {
  let phase = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.01) continue;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    let t = phase > 0 ? phase : 0;
    while (t < len) {
      const e = Math.min(len, t + dash);
      if (e - t > 0.3) addQuad(acc, [a[0] + ux * (t + e) / 2, a[1] + uz * (t + e) / 2], ux, uz, (e - t) / 2, width / 2, y);
      t += dash + gap;
    }
    phase = t - len;
  }
}

function addCrossing(acc: GeoAcc, c: CrossingRec, y: number) {
  const dx = c.b[0] - c.a[0], dz = c.b[1] - c.a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1) return;
  const ux = dx / len, uz = dz / len;
  // barras paralelas ao fluxo de veículos (perpendiculares ao trajeto do pedestre)
  const bar = 0.45, gap = 0.5;
  for (let t = 0.3; t + bar < len - 0.2; t += bar + gap) {
    const cc: XZ = [c.a[0] + ux * (t + bar / 2), c.a[1] + uz * (t + bar / 2)];
    addQuad(acc, cc, ux, uz, bar / 2, c.w / 2, y);
  }
}

export interface GroundMeshes {
  group: THREE.Group;
  markings: THREE.Group;
}

export function buildGroundMeshes(chunk: ChunkData, lib: MaterialLibrary, detailed: boolean): GroundMeshes {
  const group = new THREE.Group();
  group.name = `ground_${chunk.key}`;
  const S = chunk.surfaces;
  const mk = (acc: GeoAcc, mat: THREE.Material, name: string, receive = true, cast = false) => {
    const g = acc.toGeometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = receive;
    m.castShadow = cast;
    m.matrixAutoUpdate = false;
    group.add(m);
    return m;
  };

  const road = new GeoAcc();
  for (const p of S.road) addFlatPoly(road, p, 0);
  mk(road, lib.asphalt, 'road');

  const ground = new GeoAcc();
  for (const p of S.ground) addFlatPoly(ground, p, CURB_HEIGHT);
  mk(ground, lib.sidewalk, 'sidewalk');

  const plaza = new GeoAcc();
  for (const p of S.plaza) addFlatPoly(plaza, p, CURB_HEIGHT);
  mk(plaza, lib.plaza, 'plaza');

  const green = new GeoAcc();
  for (const p of S.green) addFlatPoly(green, p, CURB_HEIGHT + 0.02);
  mk(green, lib.grass, 'green');

  const ballast = new GeoAcc();
  for (const p of S.ballast) addFlatPoly(ballast, p, 0.05);
  mk(ballast, lib.ballast, 'ballast');

  const water = new GeoAcc();
  for (const p of S.water) addFlatPoly(water, p, 0.02);
  mk(water, lib.water, 'water');

  // plataformas: topo + bordas verticais
  const plat = new GeoAcc();
  for (const p of S.platform) {
    addFlatPoly(plat, p, PLATFORM_HEIGHT);
    for (const ring of [p.outer, ...(p.holes ?? [])]) {
      const closed = ring.concat([ring[0]]);
      // borda: normal deve apontar para fora; testamos com a orientação do anel
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
      addVerticalStrip(plat, closed, 0, PLATFORM_HEIGHT, a < 0);
    }
  }
  mk(plat, lib.concrete, 'platform', true, detailed);

  // meio-fio: face vertical voltada para a pista + capa de granito de 18 cm
  const curbFace = new GeoAcc();
  const curbTop = new GeoAcc();
  for (const line of S.curbs) {
    // anéis do asfalto vêm do Clipper; o lado da pista é determinado pela orientação
    addVerticalStrip(curbFace, line, -0.02, CURB_HEIGHT, false);
    addVerticalStrip(curbFace, line, -0.02, CURB_HEIGHT, true);
    addRibbon(curbTop, line, 0.36, CURB_HEIGHT + 0.004, 0, false);
  }
  mk(curbFace, lib.curb, 'curb_face');
  mk(curbTop, lib.curb, 'curb_top');

  // ---- sinalização horizontal (somente detalhe próximo) ----
  const markings = new THREE.Group();
  markings.name = `markings_${chunk.key}`;
  if (detailed) {
    const white = new GeoAcc(), yellow = new GeoAcc();
    for (const l of chunk.markings.dashed) addDashes(white, l, 0.13, 3, 5, 0.012);
    for (const l of chunk.markings.solid) addRibbon(yellow, l, 0.11, 0.012, 0, false);
    for (const c of chunk.markings.crossings) addCrossing(white, c, 0.014);
    for (const [acc, mat] of [[white, lib.paintWhite], [yellow, lib.paintYellow]] as const) {
      const g = acc.toGeometry();
      if (g) {
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.renderOrder = 1;
        markings.add(m);
      }
    }
  }

  // ---- linhas: trilhos (SuperVia), VLT, gradis e muros ----
  const trackbed = new GeoAcc(), rails = new GeoAcc(), fences = new GeoAcc(), walls = new GeoAcc();
  for (const l of chunk.lines) {
    if (l.kind === 'rail') {
      addRibbon(trackbed, l.pts, 2.9, 0.09, 0, true);
      if (detailed) for (const off of [-0.8, 0.8]) addRail(rails, l.pts, off, 0.09, 0.17);
    } else if (l.kind === 'tram') {
      if (detailed) for (const off of [-0.72, 0.72]) addRibbon(rails, l.pts, 0.07, surfaceY(l.pts[0], chunk) + 0.006, off, false);
    } else if (l.kind === 'fence' && detailed) {
      addVerticalStrip(fences, l.pts, CURB_HEIGHT, 2.2, false);
      addVerticalStrip(fences, l.pts, CURB_HEIGHT, 2.2, true);
    } else if (l.kind === 'wall') {
      addVerticalStrip(walls, l.pts, 0, 2.4, false);
      addVerticalStrip(walls, l.pts, 0, 2.4, true);
    }
  }
  mk(trackbed, lib.trackbed, 'trackbed');
  mk(rails, lib.steel, 'rails', true, false);
  if (fences.idx.length) {
    const fm = mk(fences, fenceMaterial(), 'fences', false, true);
    if (fm) fm.renderOrder = 2;
  }
  mk(walls, lib.concrete, 'walls', true, true);

  return { group, markings };
}

function addRail(acc: GeoAcc, pts: XZ[], offset: number, y0: number, y1: number) {
  addRibbon(acc, pts, 0.08, y1, offset, false);
  // laterais do boleto
  const side: XZ[] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * offset, p[1] + (dx / l) * offset];
  });
  addVerticalStrip(acc, side, y0, y1, false);
  addVerticalStrip(acc, side, y0, y1, true);
}

/** altura da superfície sob o ponto: VLT corre no asfalto ou em pedra portuguesa */
function surfaceY(_p: XZ, _chunk: ChunkData): number {
  return 0.002;
}

let _fence: THREE.MeshStandardMaterial | null = null;
/** Gradil de ferro (barras verticais via alphaTest), como o do Campo de Santana. */
function fenceMaterial(): THREE.MeshStandardMaterial {
  if (_fence) return _fence;
  const size = 128;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const bar = x % 16 < 2;
    const rail = (y > 6 && y < 10) || (y > 112 && y < 117);
    const tip = y < 6 && x % 16 < 2;
    data[i] = 40; data[i + 1] = 44; data[i + 2] = 40;
    data[i + 3] = bar || rail || tip ? 255 : 0;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(1 / 1.6, 1 / 2.05);
  tex.offset.set(0, -0.07);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  _fence = new THREE.MeshStandardMaterial({
    color: 0x1f2a22, map: tex, alphaTest: 0.4, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide,
  });
  return _fence;
}
