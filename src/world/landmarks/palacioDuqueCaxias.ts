/**
 * Palácio Duque de Caxias (antigo Ministério da Guerra, 1941, art déco — Christiano Stockler das Neves).
 * Referências: fotos Wikimedia Commons (2022, CC BY-SA, só consulta) + SKYDB (82 m, 21 andares; não oficial).
 *
 * Forma: bloco longo creme de ~10 pavimentos sobre embasamento de granito vermelho-escuro (2 pavimentos),
 * torre central escalonada (~82 m) na fachada voltada para a Praça Duque de Caxias / Pres. Vargas,
 * portal de entrada na base da torre. Footprint: OSM (relação 410476). Alturas: ESTIMATIVAS documentadas.
 * Colisão: o contorno OSM continua sendo a colisão (mesma do servidor).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { FacadeStyle } from '../types';
import { buildBuildingsGeometry } from '../builders/buildings';
import { ArchBuilder, type ArchMat } from './arch';

export const PALACIO_PARAMS = {
  blockHeight: 38, // ~10 pavimentos (estimativa por foto)
  baseHeight: 8.5, // embasamento de granito (2 pavimentos)
  towerWidth: 30, towerDepth: 22, towerHeight: 74, // torre principal
  crown: [[74, 78.5, 24], [78.5, 82, 17]] as [number, number, number][], // escalonamento até ~82 m
};

const GRANITE = 0x5a2a24;

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** constrói o palácio a partir do registro de edifício (footprint real) e do eixo da avenida */
export function buildPalacioDuqueCaxias(b: BuildingRec, buildingMat: THREE.Material, archMats: Record<ArchMat, THREE.Material>, toward: XZ): THREE.Group {
  const P = PALACIO_PARAMS;
  const ring = b.poly.outer;
  const group = new THREE.Group();
  group.name = 'LANDMARK_PALACIO_DUQUE_DE_CAXIAS';
  // fachada principal: aresta longa cuja normal externa aponta para a avenida/praça
  let best = { score: -Infinity, a: ring[0], c: ring[1], nx: 0, nz: 1, len: 1 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 20) continue;
    let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    const mid: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (pointInRing([mid[0] + nx * 0.5, mid[1] + nz * 0.5], ring)) { nx = -nx; nz = -nz; }
    const tx = toward[0] - mid[0], tz = toward[1] - mid[1], tl = Math.hypot(tx, tz) || 1;
    const score = (nx * tx + nz * tz) / tl + len / 500;
    if (score > best.score) best = { score, a, c, nx, nz, len };
  }
  const ux = (best.c[0] - best.a[0]) / best.len, uz = (best.c[1] - best.a[1]) / best.len;
  const mid: XZ = [(best.a[0] + best.c[0]) / 2, (best.a[1] + best.c[1]) / 2];
  // retângulo no referencial da fachada: u ao longo, v para DENTRO
  const rect = (cu: number, cv: number, su: number, sv: number): XZ[] => {
    const at = (u: number, v: number): XZ => [mid[0] + ux * u - best.nx * v, mid[1] + uz * u - best.nz * v];
    return [at(cu - su / 2, cv - sv / 2), at(cu + su / 2, cv - sv / 2), at(cu + su / 2, cv + sv / 2), at(cu - su / 2, cv + sv / 2)];
  };
  const vol = (poly: XZ[], top: number, bottom: number, style: FacadeStyle, fh: number): BuildingRec => ({
    id: -2, poly: { outer: poly }, height: top, minHeight: bottom, levels: Math.max(1, Math.round((top - bottom) / fh)),
    heightSource: 'estimate', cls: 'A', style, tint: 0.3, seed: 0.37,
  });
  const recs: BuildingRec[] = [
    vol(ring, P.blockHeight, 0, FacadeStyle.ClassicPunched, 3.6),
    vol(rect(0, P.towerDepth / 2 - 1, P.towerWidth, P.towerDepth), P.towerHeight, P.blockHeight - 0.5, FacadeStyle.ArtDecoPiers, 3.4),
  ];
  for (const [y0, y1, s] of P.crown) recs.push(vol(rect(0, P.towerDepth / 2 - 1, s, s * 0.75), y1, y0, FacadeStyle.ArtDecoPiers, 3.4));
  const geo = buildBuildingsGeometry(recs, { roofDetails: false });
  if (geo) {
    const m = new THREE.Mesh(geo, buildingMat);
    m.castShadow = m.receiveShadow = true;
    m.name = 'palacio_volumes';
    group.add(m);
  }
  // embasamento de granito em todo o contorno (faixa saliente) + portal na base da torre
  const ab = new ArchBuilder();
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < 0.5) continue;
    let nx = (c[1] - a[1]) / len, nz = -(c[0] - a[0]) / len;
    const m: XZ = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (pointInRing([m[0] + nx * 0.5, m[1] + nz * 0.5], ring)) { nx = -nx; nz = -nz; }
    ab.box(len + 0.6, P.baseHeight, 0.6, m[0] + nx * 0.28, 0, m[1] + nz * 0.28, GRANITE, 'stone', -Math.atan2(c[1] - a[1], c[0] - a[0]));
  }
  // portal: bloco de granito mais alto à frente da torre com 3 vãos escuros
  const portal = rect(0, -1.2, 26, 2.4);
  const pc: XZ = [(portal[0][0] + portal[2][0]) / 2, (portal[0][1] + portal[2][1]) / 2];
  const ang = Math.atan2(uz, ux);
  ab.box(26, 13, 2.4, pc[0], 0, pc[1], GRANITE, 'stone', -ang);
  for (const k of [-7, 0, 7]) {
    ab.box(4.2, 7.5, 0.3, pc[0] + ux * k + best.nx * 1.25, 0, pc[1] + uz * k + best.nz * 1.25, 0x1d1a18, 'dark', -ang);
  }
  // pilastras verticais do portal
  for (const k of [-11.5, -3.5, 3.5, 11.5]) ab.box(1.1, 13.5, 0.6, pc[0] + ux * k + best.nx * 1.3, 0, pc[1] + uz * k + best.nz * 1.3, 0x4a221d, 'stone', -ang);
  // mastro com bandeira no topo da torre (cor neutra)
  const top = rect(0, P.towerDepth / 2 - 1, 1, 1);
  const tc: XZ = [(top[0][0] + top[2][0]) / 2, (top[0][1] + top[2][1]) / 2];
  ab.cyl(0.12, 0.16, 9, tc[0], P.crown[P.crown.length - 1][1], tc[1], 0x8c8c8c, 8, 'metal');
  group.add(ab.build(archMats, 'palacio_details'));
  return group;
}
