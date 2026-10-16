/**
 * Palácio Duque de Caxias (antigo Ministério da Guerra, 1937–1941, art déco — Christiano Stockler das Neves).
 *
 * Referências (medidas e confiança em docs/LANDMARKS.md):
 *  - footprint OSM (relação 410476: anel externo + pátio interno) — implantação real;
 *  - SKYDB/Emporis: torre ~82 m, 21 pavimentos (não oficial);
 *  - fotos Wikimedia Commons (Estela Neto 2022, rodrigodemarque/panoramio, CC BY-SA/CC BY):
 *    bloco perimetral de ~11 pavimentos revestido em pastilha creme sobre embasamento de 2 pavimentos
 *    em granito rosado/castanho polido; janelas recuadas agrupadas em pares entre faixas verticais;
 *    último pavimento com loggias escuras; torre central com corpo principal e "ombros" laterais mais
 *    baixos, ambos com coroamento escalonado; pórtico de granito com dois pilones, relevo em bronze e
 *    letreiro "PALÁCIO DUQUE DE CAXIAS" na base da torre.
 *  - posição da torre: centro da fachada voltada para a Praça Duque de Caxias — o eixo perpendicular
 *    pelo meio da fachada passa pelo Panteão de Caxias (OSM), como nas fotos frontais.
 * Colisão: o contorno OSM continua sendo a colisão (mesma do servidor).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { ArchBuilder, updateDetailLod, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';

export const PALACIO_PARAMS = {
  blockHeight: 44, // ~11 pavimentos + platibanda (proporção nas fotos frontais vs. torre de 82 m)
  baseHeight: 8.6, // embasamento de granito (2 pavimentos)
  floorH: 3.2,
  towerWidth: 34, // largura total da torre (corpo + ombros), ao longo da fachada
  towerBody: 21, // corpo central mais alto
  towerDepth: 24,
  bodyTop: 74, // topo do corpo antes do escalonamento
  shoulderTop: 66,
  crown: [[74, 77, 17], [77, 79.6, 13], [79.6, 82, 9]] as [number, number, number][], // até ~82 m (SKYDB)
};

const CREAM = 0xe4d8bf; // pastilha creme
const CREAM_SHADE = 0xd9cdb3;
const GRANITE = 0x9a7468; // granito rosado/castanho (fotos 2022) — mais claro que o anterior
const GRANITE_DARK = 0x7d5a50;
const GLASS = 0x2b3238;

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** letreiro dourado em textura de canvas */
function letteringTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#c9a85a';
  g.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.split('').join(String.fromCharCode(8202)), 512, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** fachada principal: maior sequência de arestas colineares cuja normal externa aponta para `toward` */
export function palacioFacade(ring: XZ[], toward: XZ) {
  // funde arestas colineares consecutivas
  const runs: { a: XZ; b: XZ }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const last = runs[runs.length - 1];
    if (last) {
      const d1 = [last.b[0] - last.a[0], last.b[1] - last.a[1]], d2 = [b[0] - a[0], b[1] - a[1]];
      const cr = (d1[0] * d2[1] - d1[1] * d2[0]) / (Math.hypot(d1[0], d1[1]) * Math.hypot(d2[0], d2[1]) || 1);
      if (Math.abs(cr) < 0.02 && d1[0] * d2[0] + d1[1] * d2[1] > 0) { last.b = b; continue; }
    }
    runs.push({ a, b });
  }
  let best = { score: -Infinity, a: ring[0], c: ring[1], nx: 0, nz: 1, len: 1 };
  for (const { a, b: c } of runs) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 20) continue;
    let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    const mid: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (pointInRing([mid[0] + nx * 0.5, mid[1] + nz * 0.5], ring)) { nx = -nx; nz = -nz; }
    const tx = toward[0] - mid[0], tz = toward[1] - mid[1], tl = Math.hypot(tx, tz) || 1;
    const score = (nx * tx + nz * tz) / tl + len / 500;
    if (score > best.score) best = { score, a, c, nx, nz, len };
  }
  // orienta: x ao longo, z = normal externa, base destra (x × y = z)
  let ux = (best.c[0] - best.a[0]) / best.len, uz = (best.c[1] - best.a[1]) / best.len;
  let start = best.a;
  if (-uz * best.nx + ux * best.nz < 0) { ux = -ux; uz = -uz; start = best.c; }
  const frame = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(best.nx, 0, best.nz)).setPosition(start[0], 0, start[1]);
  return { frame, start, u: [ux, uz] as XZ, n: [best.nx, best.nz] as XZ, len: best.len };
}

/** constrói o palácio a partir do registro de edifício (footprint real) e do eixo da avenida */
export function buildPalacioDuqueCaxias(b: BuildingRec, archMats: Record<ArchMat, THREE.Material>, toward: XZ): LandmarkInstance {
  const P = PALACIO_PARAMS;
  const ring = b.poly.outer;
  const group = new THREE.Group();
  group.name = 'LANDMARK_PALACIO_DUQUE_DE_CAXIAS';
  const Fc = palacioFacade(ring, toward);
  const half = Fc.len / 2; // torre centrada na fachada
  const ab = new ArchBuilder();
  const H = P.blockHeight;
  const nFloors = Math.floor((H - P.baseHeight - 1.6) / P.floorH);

  // ---------- massa perimetral (com pátio interno do OSM) ----------
  ab.prism(ring, 0, H, CREAM, 'concrete', b.poly.holes ?? []);
  ab.prism(ring, H, H + 0.3, CREAM_SHADE, 'concrete', b.poly.holes ?? []);

  // ---------- fachadas externas ----------
  const uOf = (p: XZ) => (p[0] - Fc.start[0]) * Fc.u[0] + (p[1] - Fc.start[1]) * Fc.u[1];
  const vOf = (p: XZ) => (p[0] - Fc.start[0]) * Fc.n[0] + (p[1] - Fc.start[1]) * Fc.n[1];
  const tu0 = half - P.towerWidth / 2 - 0.5, tu1 = half + P.towerWidth / 2 + 0.5;
  const blockFacade = (x0: number, x1: number) => {
    if (x1 - x0 < 2) return;
    // embasamento: granito polido, janelas altas entre pilastras
    ab.box(x1 - x0, 0.6, 0.5, (x0 + x1) / 2, 0, 0.25, GRANITE_DARK, 'granite'); // soco
    ab.facadeGrid({ x0, x1, y0: 0.6, floors: 2, floorH: (P.baseHeight - 0.6) / 2, bay: 2.3, winW: 1.25, winH: 2.6, sill: 0.8, frameD: 0.4, pierW: 0.6, pierD: 0.1, wall: GRANITE, wallMat: 'granite', glass: 0x23292e, mullions: true });
    ab.box(x1 - x0, 0.45, 0.75, (x0 + x1) / 2, P.baseHeight - 0.45, 0.37, GRANITE_DARK, 'granite');
    // corpo: janelas em pares, faixas verticais salientes a cada par (art déco)
    ab.facadeGrid({
      x0, x1, y0: P.baseHeight, floors: nFloors - 1, floorH: P.floorH, bay: 2.1, winW: 1.3, winH: 1.85, sill: 0.85, frameD: 0.3, pairShift: 0.28,
      pierW: 0.2, pierD: 0.03, majorEvery: 2, majorW: 1.2, majorD: 0.3, wall: CREAM, wallMat: 'concrete', glass: GLASS, mullions: true,
    });
    // último pavimento: loggias escuras recuadas
    const ly = P.baseHeight + (nFloors - 1) * P.floorH;
    ab.facadeGrid({ x0, x1, y0: ly, floors: 1, floorH: H - ly, bay: 4.3, winW: 3.0, winH: 2.3, sill: 0.6, frameD: 0.9, pierW: 1.0, pierD: 0.1, wall: CREAM, wallMat: 'concrete', glass: 0x1d2124 });
    ab.box(x1 - x0, 0.4, 0.6, (x0 + x1) / 2, H - 0.1, 0.3, CREAM_SHADE, 'concrete');
  };
  ArchBuilder.edgeFrames(ring, 4, (m, len, _i, a, c) => {
    const onFacade = Math.abs(vOf(a)) < 1.2 && Math.abs(vOf(c)) < 1.2;
    ab.withFrame(m, () => {
      if (!onFacade) { blockFacade(0, len); return; }
      // recorta o trecho da torre (coordenadas ao longo da aresta)
      const ua = uOf(a), uc = uOf(c);
      const toX = (u: number) => (u - ua) / (uc - ua) * len;
      const xa = Math.max(0, Math.min(len, toX(uc > ua ? tu0 : tu1)));
      const xb = Math.max(0, Math.min(len, toX(uc > ua ? tu1 : tu0)));
      blockFacade(0, Math.min(xa, xb));
      blockFacade(Math.max(xa, xb), len);
    });
  });

  // ---------- torre (frame da fachada: x ao longo, z para fora; centro em x = half) ----------
  const D = P.towerDepth;
  const body = P.towerBody, sh = (P.towerWidth - body) / 2;
  ab.withFrame(Fc.frame.clone().multiply(new THREE.Matrix4().makeTranslation(half, 0, 0)), () => {
    // corpo central (ligeiramente saliente) e ombros
    ab.box(body, P.bodyTop, D, 0, 0, -D / 2 + 0.6, CREAM, 'concrete');
    const Ds = D - 2, zs = 0.2, zsc = zs - Ds / 2; // ombros: 0,4 m atrás do corpo
    for (const s of [-1, 1]) ab.box(sh, P.shoulderTop, Ds, s * (body / 2 + sh / 2), 0, zsc, CREAM, 'concrete');
    ab.box(P.towerWidth + 0.6, P.baseHeight, 0.4, 0, 0, 0.8, GRANITE, 'granite');
    // escalonamento do corpo (zigurate) e dos ombros
    for (const [y0, y1, w] of P.crown) {
      ab.box(w, y1 - y0, D - (body - w) * 0.9, 0, y0, -D / 2 + 0.6, CREAM, 'concrete');
      ab.box(w + 0.5, 0.35, D - (body - w) * 0.9 + 0.5, 0, y1 - 0.2, -D / 2 + 0.6, CREAM_SHADE, 'concrete');
    }
    for (const s of [-1, 1]) {
      ab.box(sh - 1.6, 2.6, Ds - 2, s * (body / 2 + sh / 2 - 0.8), P.shoulderTop, zsc, CREAM, 'concrete');
      ab.box(sh - 3.2, 2.2, Ds - 4, s * (body / 2 + sh / 2 - 1.6), P.shoulderTop + 2.6, zsc, CREAM, 'concrete');
    }
    // faces da torre: frente (z+), fundos (z−), laterais
    const tFace = (w: number, top: number, frontZ: number, rotY: number, offX: number, y0 = H) => {
      const m = new THREE.Matrix4().makeRotationY(rotY).multiply(new THREE.Matrix4().makeTranslation(offX, 0, frontZ));
      ab.withFrame(m, () => {
        const nf = Math.floor((top - 1.2 - y0) / P.floorH);
        ab.facadeGrid({
          x0: -w / 2, x1: w / 2, y0, floors: nf, floorH: P.floorH, bay: 2.1, winW: 1.25, winH: 1.85, sill: 0.85, frameD: 0.3,
          pierW: 0.4, pierD: 0.05, majorEvery: 2, majorW: 0.95, majorD: 0.3, wall: CREAM, wallMat: 'concrete', glass: GLASS, mullions: true,
        });
      });
    };
    // frente do corpo desce até o embasamento (a torre "nasce" da fachada); ombros acima do bloco
    tFace(body, P.bodyTop, 0.6, 0, 0, P.baseHeight);
    for (const s of [-1, 1]) tFace(sh, P.shoulderTop, zs, 0, s * (body / 2 + sh / 2), P.baseHeight);
    tFace(body, P.bodyTop, D - 0.6, Math.PI, 0); // fundos (acima do bloco)
    for (const s of [-1, 1]) {
      // laterais: corpo acima dos ombros, ombros acima do bloco
      tFace(D, P.bodyTop, body / 2, s * Math.PI / 2, s * (D / 2 - 0.6), P.shoulderTop + 1);
      tFace(Ds, P.shoulderTop, body / 2 + sh, s * Math.PI / 2, -s * zsc, H);
    }

    // ---------- pórtico de granito na base da torre ----------
    const pw = 26, pd = 3.4, ph = 15.5;
    const z0 = 0.6;
    ab.box(pw + 6, 0.5, 6, 0, 0, z0 + 3, 0x8d8a84, 'granite'); // patamar
    for (let i = 0; i < 3; i++) ab.box(pw + 6 - i * 0.01, 0.17, 0.35, 0, 0.5 - (i + 1) * 0.17, z0 + 6 + 0.17 + i * 0.35, 0x8d8a84, 'granite');
    for (const s of [-1, 1]) {
      // pilones maciços
      ab.box(6.2, ph, pd, s * (pw / 2 - 3.1), 0.5, z0 + pd / 2, GRANITE, 'granite');
      ab.box(6.6, 0.6, pd + 0.4, s * (pw / 2 - 3.1), 0.5 + ph, z0 + pd / 2, GRANITE_DARK, 'granite');
      for (const k of [-2.2, 0, 2.2]) ab.box(0.35, ph - 1.5, 0.25, s * (pw / 2 - 3.1) + k, 1.0, z0 + pd + 0.1, GRANITE_DARK, 'granite');
    }
    // painel de relevo em bronze no pilone esquerdo (como nas fotos)
    ab.box(4.6, 6.2, 0.25, -(pw / 2 - 3.1), 6.8, z0 + pd + 0.2, 0x5b4632, 'metal');
    // trecho central: entrada recuada, 3 portas altas + janelas
    const cw = pw - 12.4;
    ab.box(cw, ph - 2.5, 1.4, 0, 0.5, z0 + 0.7, GRANITE, 'granite');
    for (const k of [-cw / 3, 0, cw / 3]) {
      ab.box(2.8, 6.4, 0.2, k, 0.5, z0 + 1.45, 0x262019, 'dark');
      ab.box(3.4, 0.5, 0.4, k, 6.9, z0 + 1.5, GRANITE_DARK, 'granite');
      ab.quad(2.2, 3.6, k, 8.2, z0 + 1.42, GLASS, 'glass');
    }
    ab.box(cw + 0.4, 0.8, 1.9, 0, 0.5 + ph - 2.5, z0 + 0.95, GRANITE_DARK, 'granite');
  });
  // mastro com bandeira no topo
  const topC = new THREE.Vector3(half, 0, -P.towerDepth / 2 + 0.6).applyMatrix4(Fc.frame);
  ab.cyl(0.12, 0.16, 10, topC.x, P.crown[P.crown.length - 1][1], topC.z, 0x8c8c8c, 8, 'metal');
  group.add(ab.build(archMats, 'palacio_arch'));

  // letreiro sobre a entrada
  {
    const tex = letteringTexture('PALÁCIO DUQUE DE CAXIAS');
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.35, metalness: 0.7, alphaTest: 0.2 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(13, 0.8), mat);
    plane.position.set(0, 13.9, 0.6 + 1.42 + 0.03);
    const holder = new THREE.Group();
    holder.applyMatrix4(Fc.frame.clone().multiply(new THREE.Matrix4().makeTranslation(half, 0, 0)));
    holder.add(plane);
    group.add(holder);
  }

  const c = new THREE.Vector3(half, 30, -20).applyMatrix4(Fc.frame);
  const arch = group.getObjectByName('palacio_arch')!;
  return { group, colliders: [], update(_t: Date, cam: THREE.Vector3) { if (cam) updateDetailLod(arch, c, cam, 520); } };
}
