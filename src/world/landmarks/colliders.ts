/**
 * Parâmetros e colisores dos landmarks — módulo PURO (sem three.js), compartilhado entre
 * cliente (modelos + colisão) e pipeline/servidor (colisão autoritativa).
 */
import type { LandmarkRec, XZ } from '../types';

export interface LandmarkCollider { poly: XZ[]; height: number; minHeight?: number }

// parâmetros (metros) — ESTIMATIVAS a validar
export const CENTRAL_PARAMS = {
  mainBlockHeight: 29, // 7 andares + térreo alto
  mainBlockDepth: 34, // profundidade do bloco principal a partir da fachada leste
  concourseHeight: 16, // gare/hall atrás do bloco principal
  towerU: 27, // posição da torre ao longo da fachada (a partir do canto sul)
  towerV: 15, // recuo da torre em relação à fachada
  towerSize: 21,
  shaftTop: 80,
  clockStageTop: 97,
  clockCenter: 88.5,
  clockRadius: 4.7,
  crown: [[97, 103, 17], [103, 108, 12.5], [108, 111.5, 8.5]] as [number, number, number][],
  mastTop: 125,
};

function pointInRing(p: XZ, ring: XZ[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function frameFromFootprint(fp: XZ[]) {
  // fachada leste = maior aresta cuja normal EXTERNA aponta para leste (testada por ponto-no-polígono)
  let best = { len: 0, a: fp[0], b: fp[1], nx: 1, nz: 0 };
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    let nx = dz / len, nz = -dx / len;
    const mid: XZ = [(a[0] + b[0]) / 2 + nx * 0.5, (a[1] + b[1]) / 2 + nz * 0.5];
    if (pointInRing(mid, fp)) { nx = -nx; nz = -nz; }
    if (nx > 0.7 && len > best.len) best = { len, a, b, nx, nz };
  }
  // origem: extremidade SUL da aresta (maior z)
  const south = best.a[1] > best.b[1] ? best.a : best.b;
  const north = south === best.a ? best.b : best.a;
  const ux = (north[0] - south[0]) / best.len, uz = (north[1] - south[1]) / best.len;
  return { origin: south, u: [ux, uz] as XZ, v: [-best.nx, -best.nz] as XZ, facadeLen: best.len };
}


export const CANDELARIA_PARAMS = {
  plinth: 0.9,
  facadeDepth: 12,
  facadeHalfW: 18,
  facadeCornice: 22,
  frontispieceTop: 27,
  pedimentH: 5,
  tower: { half: 4.4, body: 31, belfry: 38, bulbTop: 44, lantern: 47, cross: 50 },
  nave: { halfW: 15, centralHalfW: 7.5, centralH: 24, aisleH: 17 },
  transept: { halfW: 19.5, h: 24, s0: -15, s1: 2 },
  apse: { halfW: 13, h: 21 },
  dome: { s: -6.5, drumR: 8.4, drumBase: 24, drumTop: 35.5, domeTop: 51.5, lanternTop: 57.5, crossTop: 62.3 },
};


export function centralColliders(lm: LandmarkRec): LandmarkCollider[] {
  const P = CENTRAL_PARAMS;
  const F = frameFromFootprint(lm.footprint);
  const toWorld = (u: number, v: number): XZ => [F.origin[0] + F.u[0] * u + F.v[0] * v, F.origin[1] + F.u[1] * u + F.v[1] * v];
  const T = P.towerSize;
  const rect = (cu: number, cv: number, su: number, sv: number): XZ[] => [
    toWorld(cu - su / 2, cv - sv / 2), toWorld(cu + su / 2, cv - sv / 2), toWorld(cu + su / 2, cv + sv / 2), toWorld(cu - su / 2, cv + sv / 2),
  ];
  return [
    { poly: lm.footprint, height: P.mainBlockHeight },
    { poly: rect(P.towerU, P.towerV, T, T), height: P.crown[2][1] },
  ];
}

/** frame local da Candelária: x = eixo (+ = fachada leste), z = lateral */
export function candelariaFrame(lm: LandmarkRec) {
  let ax = Math.cos(lm.axis), az = Math.sin(lm.axis);
  if (ax < 0) { ax = -ax; az = -az; }
  const ang = Math.atan2(az, ax);
  const toW = (s: number, z: number): XZ => [lm.center[0] + s * Math.cos(ang) - z * Math.sin(ang), lm.center[1] + s * Math.sin(ang) + z * Math.cos(ang)];
  return { ang, toW };
}

export function candelariaColliders(lm: LandmarkRec): LandmarkCollider[] {
  const P = CANDELARIA_PARAMS;
  const { toW } = candelariaFrame(lm);
  const half = lm.length / 2;
  const y0 = P.plinth, sF0 = half - P.facadeDepth, sF1 = half, sA0 = -half;
  const T = P.transept, N = P.nave, D = P.dome, TW = P.tower;
  const rect = (s0: number, s1: number, hw: number): XZ[] => [toW(s0, -hw), toW(s1, -hw), toW(s1, hw), toW(s0, hw)];
  return [
    { poly: rect(sA0, T.s0, P.apse.halfW), height: P.apse.h + y0 },
    { poly: rect(T.s0, T.s1, T.halfW), height: D.domeTop },
    { poly: rect(T.s1, sF0, N.halfW), height: N.centralH + y0 },
    { poly: rect(sF0, sF1, P.facadeHalfW), height: TW.cross },
  ];
}

export function landmarkColliders(lm: LandmarkRec): LandmarkCollider[] {
  return lm.key === 'LANDMARK_CENTRAL' ? centralColliders(lm) : candelariaColliders(lm);
}
