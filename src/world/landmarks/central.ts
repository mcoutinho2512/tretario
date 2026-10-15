/**
 * LANDMARK_CENTRAL — Estação Central do Brasil (Edifício D. Pedro II, art déco, 1943).
 *
 * Fontes de forma/proporção (ver docs/MAP_VALIDATION.md):
 *  - footprint real do OSM (way 81100866), incluindo os cantos arredondados (streamline);
 *  - bloco principal de 7 andares; torre com ~110 m (fontes divergem: 110–135 m incl. mastro);
 *  - relógio de 4 faces entre o 21º e o 26º andar da torre; coroamento escalonado + mastro;
 *  - torre próxima à extremidade sul da fachada leste (Praça Cristiano Ottoni), conforme fotos.
 * Itens marcados como ESTIMATIVA precisam de validação humana / refinamento no Blender.
 */
import * as THREE from 'three';
import type { BuildingRec, LandmarkRec, XZ } from '../types';
import { FacadeStyle } from '../types';
import { buildBuildingsGeometry } from '../builders/buildings';
import { ArchBuilder, clipPolygonHalfPlane, type ArchMat } from './arch';

export interface LandmarkInstance {
  group: THREE.Group;
  /** volumes para colisão: polígono + altura */
  colliders: { poly: XZ[]; height: number; minHeight?: number }[];
  update(simTime: Date, cameraPos: THREE.Vector3): void;
}

const CREAM = 0xeee8da;
const CREAM_DARK = 0xd8d0be;

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

function frameFromFootprint(fp: XZ[]) {
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

function makeClockDial(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3efe4';
  g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  g.lineWidth = 14; g.strokeStyle = '#2b2b2b';
  g.beginPath(); g.arc(256, 256, 243, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1c1c1c';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    const r0 = big ? 180 : 215, r1 = 228;
    g.save();
    g.translate(256, 256);
    g.rotate(a);
    g.fillRect(-(big ? 9 : 3), -r1, big ? 18 : 6, r1 - r0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildCentral(lm: LandmarkRec, buildingMat: THREE.Material, archMats: Record<ArchMat, THREE.Material>): LandmarkInstance {
  const P = CENTRAL_PARAMS;
  const fp = lm.footprint;
  const F = frameFromFootprint(fp);
  const toWorld = (u: number, v: number): XZ => [F.origin[0] + F.u[0] * u + F.v[0] * v, F.origin[1] + F.u[1] * u + F.v[1] * v];
  const vOf = (p: XZ) => (p[0] - F.origin[0]) * F.v[0] + (p[1] - F.origin[1]) * F.v[1];

  const group = new THREE.Group();
  group.name = 'LANDMARK_CENTRAL';
  const colliders: LandmarkInstance['colliders'] = [];

  // ---------- volumes principais (mesmo shader de fachada da cidade, parâmetros dedicados) ----------
  const front = clipPolygonHalfPlane(fp as [number, number][], (p) => P.mainBlockDepth - vOf(p as XZ)) as XZ[];
  const rear = clipPolygonHalfPlane(fp as [number, number][], (p) => vOf(p as XZ) - P.mainBlockDepth) as XZ[];
  const vol = (poly: XZ[], h: number, minH: number, style: FacadeStyle, floorH: number, tint: number, seed: number): BuildingRec => ({
    id: -1, poly: { outer: poly }, height: h, minHeight: minH, levels: Math.round((h - minH) / floorH), heightSource: 'estimate',
    cls: 'A', style, tint, seed,
  });
  const recs: BuildingRec[] = [];
  if (front.length >= 3) recs.push(vol(front, P.mainBlockHeight, 0, FacadeStyle.ModernOffice, 3.6, 0.3, 0.31));
  if (rear.length >= 3) recs.push(vol(rear, P.concourseHeight, 0, FacadeStyle.Institutional, 5, 0.3, 0.77));

  // torre: retângulo alinhado à fachada
  const rect = (cu: number, cv: number, su: number, sv: number): XZ[] => [
    toWorld(cu - su / 2, cv - sv / 2), toWorld(cu + su / 2, cv - sv / 2), toWorld(cu + su / 2, cv + sv / 2), toWorld(cu - su / 2, cv + sv / 2),
  ];
  const T = P.towerSize;
  recs.push(vol(rect(P.towerU, P.towerV, T, T), P.shaftTop, P.mainBlockHeight - 0.5, FacadeStyle.ArtDecoPiers, 3.3, 0.3, 0.12));
  const geo = buildBuildingsGeometry(recs, { roofDetails: false });
  if (geo) {
    const m = new THREE.Mesh(geo, buildingMat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = 'central_volumes';
    group.add(m);
  }
  colliders.push({ poly: fp, height: P.mainBlockHeight });
  colliders.push({ poly: rect(P.towerU, P.towerV, T, T), height: P.crown[2][1] });

  // ---------- detalhes arquitetônicos ----------
  const ab = new ArchBuilder();
  // frame local: x = u (ao longo da fachada, para o norte), z = −v (para fora da fachada, leste)
  const ang = Math.atan2(F.u[1], F.u[0]);
  ab.frame.makeRotationY(-ang).setPosition(F.origin[0], 0, F.origin[1]);
  // checar se o eixo z local aponta para fora (v negativo); se não, espelhar
  const zw = new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().makeRotationY(-ang));
  const outward = -(zw.x * F.v[0] + zw.z * F.v[1]) > 0 ? 1 : -1; // +1: z local = para fora
  const Z = (v: number) => -v * outward; // converte "recuo v" para z local

  const tu = P.towerU, tv = P.towerV;
  // pilastras verticais salientes no fuste da torre (marca art déco)
  for (const side of [-1, 1]) {
    for (let k = -2; k <= 2; k++) {
      // faces norte/sul (perpendiculares a u)
      ab.box(0.7, P.shaftTop - P.mainBlockHeight, 0.5, tu + side * (T / 2 + 0.2), P.mainBlockHeight, Z(tv + k * (T / 5)), CREAM, 'stone');
      // faces leste/oeste
      ab.box(0.5, P.shaftTop - P.mainBlockHeight, 0.7, tu + k * (T / 5), P.mainBlockHeight, Z(tv + side * (T / 2 + 0.2)), CREAM, 'stone');
    }
  }
  // estágio do relógio e coroamento escalonado (pedra/reboco creme)
  ab.box(T - 1.4, P.clockStageTop - P.shaftTop, T - 1.4, tu, P.shaftTop, Z(tv), CREAM);
  for (const [y0, y1, s] of P.crown) ab.box(s, y1 - y0, s, tu, y0, Z(tv), CREAM);
  // cornijas dos escalonamentos
  ab.box(T + 1.6, 1.0, T + 1.6, tu, P.shaftTop - 0.6, Z(tv), CREAM_DARK);
  ab.box(T + 0.4, 0.8, T + 0.4, tu, P.clockStageTop - 0.4, Z(tv), CREAM_DARK);
  for (const [, y1, s] of P.crown) ab.box(s + 0.8, 0.6, s + 0.8, tu, y1 - 0.3, Z(tv), CREAM_DARK);
  // aletas verticais do coroamento
  for (const [y0, y1, s] of P.crown) {
    for (const side of [-1, 1]) for (const k of [-1, 0, 1]) {
      ab.box(0.5, y1 - y0, 0.4, tu + side * (s / 2 + 0.15), y0, Z(tv + k * s / 3.2), CREAM);
      ab.box(0.4, y1 - y0, 0.5, tu + k * s / 3.2, y0, Z(tv + side * (s / 2 + 0.15)), CREAM);
    }
  }
  // mastro e antenas
  const top = P.crown[2][1];
  ab.cyl(0.9, 1.2, 2.0, tu, top, Z(tv), CREAM_DARK, 12);
  ab.cyl(0.18, 0.3, P.mastTop - top - 2, tu, top + 2, Z(tv), 0x8c8c8c, 8, 'metal');
  for (const s of [-1, 1]) ab.box(0.12, 6, 0.12, tu + s * 2.2, top, Z(tv + s * 1.5), 0x8c8c8c, 'metal');
  ab.box(4.6, 0.12, 0.12, tu, top + 5.5, Z(tv), 0x8c8c8c, 'metal');
  // molduras do relógio (anel escuro) nas 4 faces
  const half = (T - 1.4) / 2;
  const clockPos: { x: number; z: number; ry: number }[] = [
    { x: tu, z: Z(tv) + (half + 0.05) * 1, ry: 0 },
    { x: tu, z: Z(tv) - (half + 0.05), ry: Math.PI },
    { x: tu + half + 0.05, z: Z(tv), ry: Math.PI / 2 },
    { x: tu - half - 0.05, z: Z(tv), ry: -Math.PI / 2 },
  ];
  for (const c of clockPos) {
    const ring = new THREE.TorusGeometry(P.clockRadius + 0.25, 0.32, 8, 48);
    ring.rotateY(c.ry);
    ring.translate(c.x, P.clockCenter, c.z);
    ab.add(ring, 0x3a3a38, 'metal');
  }
  // marquise sobre o acesso principal (fachada leste) — ESTIMATIVA
  ab.box(36, 0.5, 5.0, tu + 22, 6.2, Z(-2.5), CREAM_DARK);
  // base/embasamento escuro (granito) no térreo da fachada
  ab.box(F.facadeLen - 2, 1.2, 0.4, F.facadeLen / 2, 0, Z(-0.15), 0x6b6560);
  group.add(ab.build(archMats, 'central_details'));

  // ---------- relógio (mostradores + ponteiros funcionando) ----------
  const dialTex = makeClockDial();
  const dialMat = new THREE.MeshStandardMaterial({ map: dialTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: dialTex, emissiveIntensity: 0.06 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.3 });
  const clockRoot = new THREE.Group();
  clockRoot.applyMatrix4(ab.frame);
  const hands: { hour: THREE.Mesh; minute: THREE.Mesh }[] = [];
  for (const c of clockPos) {
    const face = new THREE.Group();
    face.position.set(c.x, P.clockCenter, c.z);
    face.rotation.y = c.ry;
    const dial = new THREE.Mesh(new THREE.CircleGeometry(P.clockRadius, 48), dialMat);
    dial.position.z = 0.02;
    face.add(dial);
    const minute = new THREE.Mesh(new THREE.BoxGeometry(0.28, P.clockRadius * 0.92, 0.08).translate(0, P.clockRadius * 0.38, 0), handMat);
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.42, P.clockRadius * 0.6, 0.08).translate(0, P.clockRadius * 0.22, 0), handMat);
    minute.position.z = 0.16;
    hour.position.z = 0.12;
    face.add(minute, hour);
    hands.push({ hour, minute });
    clockRoot.add(face);
  }
  group.add(clockRoot);

  return {
    group,
    colliders,
    update(simTime: Date) {
      // hora local do Rio (UTC−3)
      const h = (simTime.getUTCHours() + 21) % 24;
      const m = simTime.getUTCMinutes() + simTime.getUTCSeconds() / 60;
      const aMin = -(m / 60) * Math.PI * 2;
      const aHour = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
      for (const hd of hands) {
        hd.minute.rotation.z = aMin;
        hd.hour.rotation.z = aHour;
      }
    },
  };
}
