/**
 * Parâmetros e colisores dos landmarks — módulo PURO (sem three.js), compartilhado entre
 * cliente (modelos + colisão) e pipeline/servidor (colisão autoritativa).
 */
import type { LandmarkRec, XZ } from '../types';

export interface LandmarkCollider { poly: XZ[]; height: number; minHeight?: number }

// parâmetros (metros) — fontes e confiança em docs/LANDMARKS.md
export const CENTRAL_PARAMS = {
  mainBlockHeight: 29, // 7 pavimentos + térreo alto (fotos: alas "streamline" de 7 andares junto à torre)
  mainBlockDepth: 34, // profundidade do bloco principal a partir da fachada leste
  concourseHeight: 16, // gare/hall atrás do bloco principal
  towerU: 30, // centro da torre ao longo da fachada leste (a partir do extremo sul da aresta longa) = meio da aresta
  towerV: 15, // centro da torre: recuo em relação à fachada (face frontal da torre a 4 m)
  towerSize: 22, // fuste ~22 m (proporção com o mostrador de 10 m nas fotos)
  notchMargin: 1.5, // folga entre a torre e as pontas arredondadas das alas
  wingRadius: 5, // raio das pontas arredondadas das alas que ladeiam a torre
  shaftTop: 76, // topo do fuste (~20º pavimento)
  clockStageTop: 96, // relógio entre o 21º e o 26º pavimento (Diário do Rio)
  clockStageSize: 15.5,
  clockCenter: 86,
  clockRadius: 5, // mostrador de 10 m de diâmetro (Diário do Rio)
  crown: [[96, 106, 11.5], [106, 110, 9]] as [number, number, number][],
  roofTop: 110, // "torre de 110 m" (Diário do Rio)
  mastTop: 135, // estrutura total ~134–135 m com antenas (Diário do Rio / guias)
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
  plinth: 0.9, // adro elevado (escadaria leste)
  facadeDepth: 12,
  facadeHalfW: 18.4, // fachada ~36,8 m (aresta leste do OSM)
  facadeCornice: 21.6, // cornija principal (2 ordens) — proporção nas fotos frontais
  frontispieceTop: 25.6,
  pedimentH: 5.2,
  tower: { half: 4.4, body: 31, belfry: 37.2, bulbTop: 42.8, lantern: 45.2, cross: 48.6 }, // ~49,5 m acima do chão (estimativa por foto)
  nave: { halfW: 18, centralHalfW: 8, centralH: 24, aisleH: 17 }, // largura total = OSM (~36 m)
  transept: { halfW: 21, h: 25, s0: -13, s1: 4 }, // braços do transepto = saliências do contorno OSM
  apse: { halfW: 18, h: 16, choirHalfW: 9, choirH: 22 }, // capela-mor alta + sacristias laterais (fundos, voltados à avenida)
  dome: { s: -4.5, drumR: 8.4, drumBase: 25, drumTop: 36, domeTop: 52.4, lanternTop: 58, crossTop: 62.3 }, // 62,3 m e Ø 16,8 m (base de dados)
};


/**
 * Planta da Central (módulo puro): bloco frontal dividido em duas alas + trecho central recuado
 * diante da torre (as alas terminam em cantos arredondados), gare posterior e retângulo da torre.
 * Usada pelo modelo (cliente) e pela colisão (cliente + servidor).
 */
export function centralPlan(lm: LandmarkRec) {
  const P = CENTRAL_PARAMS;
  const F = frameFromFootprint(lm.footprint);
  const toWorld = (u: number, v: number): XZ => [F.origin[0] + F.u[0] * u + F.v[0] * v, F.origin[1] + F.u[1] * u + F.v[1] * v];
  const uOf = (p: XZ) => (p[0] - F.origin[0]) * F.u[0] + (p[1] - F.origin[1]) * F.u[1];
  const vOf = (p: XZ) => (p[0] - F.origin[0]) * F.v[0] + (p[1] - F.origin[1]) * F.v[1];
  const fp = lm.footprint as [number, number][];
  const clip = (poly: XZ[], f: (p: XZ) => number) => clipPolygonHalfPlane(poly as [number, number][], f as (p: [number, number]) => number) as XZ[];
  const T = P.towerSize;
  const notchDepth = P.towerV - T / 2;
  const uA = P.towerU - T / 2 - P.notchMargin, uB = P.towerU + T / 2 + P.notchMargin;
  const front = clip(fp as XZ[], (p) => P.mainBlockDepth - vOf(p));
  const rear = clip(fp as XZ[], (p) => vOf(p) - P.mainBlockDepth);
  // canto arredondado (5 semiplanos tangentes ao círculo de raio r)
  const round = (poly: XZ[], cu: number, sgn: number) => {
    const r = P.wingRadius;
    const c = [cu - sgn * r, r];
    let out = poly;
    for (let k = 1; k <= 5; k++) {
      const th = (k / 6) * Math.PI / 2;
      const n = [sgn * Math.cos(th), -Math.sin(th)];
      out = clip(out, (p) => r - ((uOf(p) - c[0]) * n[0] + (vOf(p) - c[1]) * n[1]));
    }
    return out;
  };
  const wingS = round(clip(front, (p) => uA - uOf(p)), uA, 1);
  const wingN = round(clip(front, (p) => uOf(p) - uB), uB, -1);
  const mid = clip(clip(clip(front, (p) => uOf(p) - uA), (p) => uB - uOf(p)), (p) => vOf(p) - notchDepth);
  const rect = (cu: number, cv: number, su: number, sv: number): XZ[] => [
    toWorld(cu - su / 2, cv - sv / 2), toWorld(cu + su / 2, cv - sv / 2), toWorld(cu + su / 2, cv + sv / 2), toWorld(cu - su / 2, cv + sv / 2),
  ];
  return { F, toWorld, uOf, vOf, front, rear, wingS, wingN, mid, tower: rect(P.towerU, P.towerV, T, T), uA, uB, notchDepth };
}

export function centralColliders(lm: LandmarkRec): LandmarkCollider[] {
  const P = CENTRAL_PARAMS;
  const C = centralPlan(lm);
  const out: LandmarkCollider[] = [];
  for (const poly of [C.wingS, C.wingN, C.mid]) if (poly.length >= 3) out.push({ poly, height: P.mainBlockHeight });
  if (C.rear.length >= 3) out.push({ poly: C.rear, height: P.concourseHeight });
  out.push({ poly: C.tower, height: P.roofTop });
  return out;
}

/** Recorte de polígono por semiplano (Sutherland–Hodgman): mantém pontos com f(p) >= 0. */
export function clipPolygonHalfPlane(poly: [number, number][], f: (p: [number, number]) => number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
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
    { poly: rect(sA0 + 1, T.s0, P.apse.choirHalfW), height: P.apse.choirH + y0 },
    { poly: rect(T.s0, T.s1, T.halfW), height: D.domeTop },
    { poly: rect(T.s1, sF0, N.halfW), height: N.centralH + y0 },
    { poly: rect(sF0, sF1, P.facadeHalfW), height: TW.cross },
  ];
}

export function landmarkColliders(lm: LandmarkRec): LandmarkCollider[] {
  return lm.key === 'LANDMARK_CENTRAL' ? centralColliders(lm) : candelariaColliders(lm);
}
