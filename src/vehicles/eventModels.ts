/**
 * Modelos PROCEDURAIS dos veículos e do cenário de evento (rodada 7): carro de som, trio elétrico, caminhão de
 * campanha, telão de treliça e palco. Geometria própria (caixas/cilindros), sem modelos ou imagens de terceiros.
 *
 * Custo: cada nível de detalhe junta TODAS as peças por material (cores por vértice) →
 *   perto  carroceria (1) + luzes (1) + painéis de design (1) + grades de alto-falante (1) + telão (1, só trio/palco)
 *   médio  carroceria simplificada (1) + painéis (1) [+ telão]
 *   longe  uma caixa colorida (1)
 * O design (src/social/designs.ts) é só TEXTURA (`designTexture(id, alvo)`): trocar a campanha não cria geometria.
 *
 * Referencial: +z frente, +x lateral esquerda do motorista, y para cima, origem no chão no centro da carroceria
 * (o mesmo de src/vehicles/platform.ts).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { designTexture } from '../social/designPainter';
import { DESIGN_BY_KEY, type DesignTarget } from '../social/designs';
import { screenFeed } from '../events/screenFeed';
import { TRIO } from './platform';

type V3 = [number, number, number];

/** junta peças com cor por vértice (ou com UV, para painéis texturizados) numa só geometria */
class Kit {
  private parts: THREE.BufferGeometry[] = [];
  constructor(private uv = false) {}
  add(g: THREE.BufferGeometry, color: number, pos: V3, rot: V3 = [0, 0, 0]) {
    if (rot[0] || rot[1] || rot[2]) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
    g.translate(pos[0], pos[1], pos[2]);
    if (!this.uv) {
      g.deleteAttribute('uv');
      const c = new THREE.Color(color), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    this.parts.push(g);
    return this;
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rot?: V3) { return this.add(new THREE.BoxGeometry(w, h, d), color, [x, y, z], rot); }
  cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: number, rot?: V3) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, [x, y, z], rot); }
  /** painel plano com UV (escala de UV para repetir a textura sem esticar) */
  panel(w: number, h: number, pos: V3, ry: number, uScale = 1, vScale = 1) {
    const g = new THREE.PlaneGeometry(w, h);
    if (uScale !== 1 || vScale !== 1) { const uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale); }
    return this.add(g, 0, pos, [0, ry, 0]);
  }
  /** barra entre dois pontos (treliça, guarda-corpo) */
  bar(a: V3, b: V3, r: number, color: number) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const g = new THREE.BoxGeometry(r * 2, d.length(), r * 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
    return this.add(g, color, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  }
  /** treliça quadrada (4 banzos + diagonais em zigue-zague nas 4 faces) */
  truss(a: V3, b: V3, size: number, color: number, step = 0.7) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length(), dir = d.clone().normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(size / 2);
    const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(size / 2);
    const A = new THREE.Vector3(...a);
    const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
    const P = (t: number, c: THREE.Vector3): V3 => { const p = A.clone().addScaledVector(dir, t).add(c); return [p.x, p.y, p.z]; };
    for (const c of corners) this.bar(P(0, c), P(len, c), 0.025, color);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t0 = (i / n) * len, t1 = ((i + 1) / n) * len;
      for (let k = 0; k < 4; k++) {
        const c0 = corners[k], c1 = corners[(k + 1) % 4];
        this.bar(P(t0, i % 2 ? c0 : c1), P(t1, i % 2 ? c1 : c0), 0.012, color);
      }
    }
    return this;
  }
  get empty() { return !this.parts.length; }
  merge(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------------------------- materiais (compartilhados)
let mats: { body: THREE.MeshStandardMaterial; light: THREE.MeshBasicMaterial; grille: THREE.MeshStandardMaterial } | null = null;
function materials() {
  if (mats) return mats;
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
  body.name = 'event_vehicle';
  // luzes do trio/carro de som: sem iluminação, cor cheia (parecem acesas; o bloom faz o resto) — nenhuma luz real
  const light = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  light.name = 'event_lights';
  const grille = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.85, metalness: 0.1 });
  grille.name = 'speaker_grille';
  return (mats = { body, light, grille });
}

/** grade de alto-falante (canvas próprio): 2×2 cones por bloco, repetido pelos painéis */
function grilleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#141416'; x.fillRect(0, 0, 128, 128);
  for (const [cx, cy] of [[32, 32], [96, 32], [32, 96], [96, 96]]) {
    const g = x.createRadialGradient(cx, cy, 2, cx, cy, 28);
    g.addColorStop(0, '#5a5d63'); g.addColorStop(0.25, '#1e1f22'); g.addColorStop(0.8, '#2c2d31'); g.addColorStop(1, '#0b0b0c');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, 28, 0, Math.PI * 2); x.fill();
  }
  x.strokeStyle = '#2a2b2e'; x.lineWidth = 2; x.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.name = 'speaker_grille';
  return t;
}

/** design padrão dos veículos/cenário de evento quando nada foi configurado (arte neutra do ato) */
export const DEFAULT_EVENT_DESIGN = 'ato_pv';
export const resolveDesign = (id: number) => (id || DESIGN_BY_KEY.get(DEFAULT_EVENT_DESIGN)?.id || 0);

const designMats = new Map<string, THREE.MeshStandardMaterial>();
/** material de painel com um design (cacheado por design+alvo: veículos com a mesma arte compartilham) */
export function designMaterial(designId: number, target: DesignTarget = 'truck'): THREE.MeshStandardMaterial {
  const id = resolveDesign(designId);
  const key = `${id}:${target}`;
  let m = designMats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: designTexture(id, target, 256), roughness: 0.6, metalness: 0.05 });
    m.name = `design_panel_${key}`;
    designMats.set(key, m);
  }
  return m;
}

/** aplica um design (troca só o material dos painéis marcados) */
export function applyDesign(root: THREE.Object3D, designId: number) {
  root.traverse((o) => {
    const t = o.userData.designTarget as DesignTarget | undefined;
    if (t && (o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = designMaterial(designId, t);
  });
  root.userData.design = designId;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name: string, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/** monta um nível de detalhe a partir dos kits (pula os vazios) */
function level(name: string, kits: { body?: Kit; light?: Kit; grille?: Kit; panels?: Kit; panelTarget?: DesignTarget; extraPanels?: Kit; extraTarget?: DesignTarget; screen?: Kit }, design: number) {
  const g = new THREE.Group();
  g.name = name;
  const m = materials();
  // nível longe não projeta sombra (silhueta a 150 m+: sombra não aparece, custaria passes de sombra)
  if (kits.body && !kits.body.empty) g.add(mesh(kits.body.merge(), m.body, `${name}_body`, !name.endsWith('_far')));
  if (kits.light && !kits.light.empty) g.add(mesh(kits.light.merge(), m.light, `${name}_lights`, false));
  if (kits.grille && !kits.grille.empty) g.add(mesh(kits.grille.merge(), m.grille, `${name}_grille`, false));
  for (const [k, t] of [[kits.panels, kits.panelTarget ?? 'truck'], [kits.extraPanels, kits.extraTarget ?? 'truck']] as const) {
    if (!k || k.empty) continue;
    const p = mesh(k.merge(), designMaterial(design, t), `${name}_design`, false);
    p.userData.designTarget = t;
    g.add(p);
  }
  if (kits.screen && !kits.screen.empty) {
    const s = mesh(kits.screen.merge(), screenFeed().material, `${name}_screen`, false);
    s.userData.eventScreen = true;
    g.add(s);
  }
  return g;
}

function lod(levels: [THREE.Object3D, number][]): THREE.LOD {
  const l = new THREE.LOD();
  for (const [o, d] of levels) l.addLevel(o, d, 0.08);
  return l;
}

// ------------------------------------------------------------------------------- cores
const C = {
  white: 0xf0f0ec, black: 0x161618, dark: 0x1f2023, chassis: 0x2a2b2e, tire: 0x141414, rim: 0xaeb2b8,
  silver: 0xc4c8cc, truss: 0xb6bac0, deck: 0x3a3d40, glass: 0x1a2733, chrome: 0x8a8f96, amber: 0xffa21a,
  head: 0xfff1cf, tail: 0xc0141c, concrete: 0x9b9a96,
};
const LIGHT_COLORS = [0xff2bd6, 0x22d3ff, 0xffb000, 0xffffff, 0x7c4dff, 0x3cff6a];

function wheels(k: Kit, zs: number[], x: number, r: number, w: number, seg = 16) {
  for (const z of zs) for (const s of [-1, 1]) {
    k.cyl(r, r, w, seg, s * x, r, z, C.tire, [0, 0, Math.PI / 2]);
    k.cyl(r * 0.58, r * 0.58, w + 0.02, seg, s * x, r, z, C.rim, [0, 0, Math.PI / 2]);
  }
}

// ------------------------------------------------------------------------------- carro de som
/**
 * Carro de som: picape com baú (painéis de design nas laterais), rack no teto com caixas de som e quatro
 * cornetas num mastro, giroflex âmbar e fitas de LED. 5,0 × 2,0 m, ~3,6 m de altura.
 */
export function buildSoundcar(design = 0): THREE.Group {
  const near = { body: new Kit(), light: new Kit(), grille: new Kit(true), panels: new Kit(true) };
  const b = near.body;
  b.box(1.8, 0.25, 4.8, 0, 0.55, 0, C.chassis);
  wheels(b, [1.6, -1.5], 0.85, 0.36, 0.26, 14);
  b.box(1.9, 0.5, 1.0, 0, 0.95, 2.0, C.white) // capô
    .box(1.92, 0.12, 0.2, 0, 0.62, 2.5, C.black) // para-choque
    .box(1.9, 0.85, 1.25, 0, 1.6, 0.92, C.white) // cabine
    .box(1.7, 0.62, 0.04, 0, 1.62, 1.56, C.glass, [-0.45, 0, 0]) // para-brisa inclinado
    .box(0.04, 0.5, 0.9, 0.96, 1.7, 0.9, C.glass).box(0.04, 0.5, 0.9, -0.96, 1.7, 0.9, C.glass)
    .box(1.96, 1.52, 2.66, 0, 1.46, -1.17, C.white) // baú
    .box(1.98, 0.08, 2.7, 0, 2.24, -1.17, C.chrome); // friso do teto
  // rack e caixas
  for (const x of [-0.9, 0.9]) b.box(0.05, 0.05, 2.6, x, 2.32, -1.17, C.silver);
  for (const z of [-2.4, -1.17, 0.06]) b.box(1.85, 0.05, 0.05, 0, 2.32, z, C.silver);
  for (const [x, z] of [[-0.46, -0.32], [0.46, -0.32], [-0.46, -2.02], [0.46, -2.02]]) b.box(0.86, 0.72, 0.56, x, 2.72, z, C.black);
  for (const x of [-0.46, 0.46]) {
    near.grille.panel(0.8, 0.66, [x, 2.72, -0.03], 0, 1, 1);
    near.grille.panel(0.8, 0.66, [x, 2.72, -2.31], Math.PI, 1, 1);
  }
  near.grille.panel(1.8, 1.3, [0, 1.46, -2.51], Math.PI, 2, 1.5); // traseira: parede de alto-falantes
  // mastro e cornetas (4 direções)
  b.cyl(0.035, 0.035, 1.05, 6, 0, 3.4, -1.17, C.silver);
  for (const [ry, dx, dz] of [[0, 0, 1], [Math.PI, 0, -1], [Math.PI / 2, 1, 0], [-Math.PI / 2, -1, 0]] as const) {
    const g = new THREE.CylinderGeometry(0.3, 0.07, 0.55, 12);
    g.rotateX(Math.PI / 2); g.rotateY(ry);
    b.add(g, 0xdadada, [dx * 0.3, 3.82, -1.17 + dz * 0.3]);
  }
  // design nas laterais do baú (2,6 × 1,0 = proporção do alvo 'truck')
  near.panels.panel(2.55, 0.98, [0.99, 1.5, -1.17], Math.PI / 2).panel(2.55, 0.98, [-0.99, 1.5, -1.17], -Math.PI / 2);
  // luzes
  const L = near.light;
  L.cyl(0.1, 0.11, 0.14, 10, 0.5, 2.1, 0.95, C.amber); // giroflex
  L.box(0.34, 0.14, 0.04, 0.6, 1.0, 2.52, C.head).box(0.34, 0.14, 0.04, -0.6, 1.0, 2.52, C.head);
  L.box(0.2, 0.12, 0.03, 0.82, 0.9, -2.52, C.tail).box(0.2, 0.12, 0.03, -0.82, 0.9, -2.52, C.tail);
  L.box(0.03, 0.04, 2.6, 0.995, 2.17, -1.17, LIGHT_COLORS[0]).box(0.03, 0.04, 2.6, -0.995, 2.17, -1.17, LIGHT_COLORS[1]);

  const mid = { body: new Kit(), panels: new Kit(true) };
  mid.body.box(1.8, 0.25, 4.8, 0, 0.55, 0, C.chassis).box(1.9, 0.5, 1.0, 0, 0.95, 2.0, C.white).box(1.9, 0.85, 1.25, 0, 1.6, 0.92, C.white)
    .box(1.96, 1.52, 2.66, 0, 1.46, -1.17, C.white).box(1.85, 0.72, 2.3, 0, 2.72, -1.17, C.black).cyl(0.035, 0.035, 1.05, 4, 0, 3.4, -1.17, C.silver)
    .box(1.2, 0.4, 0.4, 0, 3.82, -1.17, 0xdadada);
  wheels(mid.body, [1.6, -1.5], 0.85, 0.36, 0.26, 8);
  mid.panels.panel(2.55, 0.98, [0.99, 1.5, -1.17], Math.PI / 2).panel(2.55, 0.98, [-0.99, 1.5, -1.17], -Math.PI / 2);
  const far = new Kit();
  far.box(1.9, 1.7, 4.8, 0, 1.25, 0, C.white).box(1.85, 0.75, 2.3, 0, 2.6, -1.17, C.black);

  const g = new THREE.Group();
  g.add(lod([[level('soundcar_near', near, design), 0], [level('soundcar_mid', mid, design), 45], [level('soundcar_far', { body: far }, design), 140]]));
  g.userData.design = design;
  return g;
}

// ------------------------------------------------------------------------------- trio elétrico
/**
 * Trio elétrico: caminhão de 3 eixos com carroceria-caixa de som (paredes de alto-falante + painel de design),
 * piso a 3,4 m com guarda-corpo, mesa de som, treliça com rig de luz (cabeças móveis e barras de LED, só
 * emissivas), quatro line arrays nos cantos, telão traseiro e escada de acesso atrás (TRIO.ladderFoot).
 */
export function buildTrio(design = 0): THREE.Group {
  const { len, width, deckH, cabZ0 } = TRIO;
  const z0 = -len / 2, z1 = len / 2, bodyLen = cabZ0 - 0.1 - z0, bodyZ = (z0 + cabZ0 - 0.1) / 2;
  const near = { body: new Kit(), light: new Kit(), grille: new Kit(true), panels: new Kit(true), screen: new Kit(true) };
  const b = near.body, L = near.light, G = near.grille;
  b.box(2.3, 0.35, len - 0.2, 0, 0.95, 0, C.chassis);
  wheels(b, [4.6, -3.0, -4.25], 1.1, 0.52, 0.42, 16);
  // cabine
  b.box(2.5, 2.3, z1 - cabZ0, 0, 2.05, (cabZ0 + z1) / 2, C.white)
    .box(2.2, 0.9, 0.05, 0, 2.62, z1 + 0.01, C.glass)
    .box(0.05, 0.7, 1.1, 1.26, 2.6, 5.1, C.glass).box(0.05, 0.7, 1.1, -1.26, 2.6, 5.1, C.glass)
    .box(2.52, 0.36, 0.26, 0, 0.78, z1 + 0.06, C.black)
    .box(1.4, 0.5, 0.04, 0, 1.55, z1 + 0.02, C.chrome)
    .box(2.42, 0.9, 1.1, 0, 3.66, 5.55, C.black); // caixa de som frontal sobre a cabine
  G.panel(2.3, 0.8, [0, 3.66, 6.11], 0, 3, 1);
  L.box(0.38, 0.2, 0.05, 0.85, 1.3, z1 + 0.04, C.head).box(0.38, 0.2, 0.05, -0.85, 1.3, z1 + 0.04, C.head);
  L.box(0.25, 0.15, 0.04, 1.05, 1.0, z0 - 0.02, C.tail).box(0.25, 0.15, 0.04, -1.05, 1.0, z0 - 0.02, C.tail);
  // carroceria (caixa de som) e piso
  b.box(width, deckH - 0.85, bodyLen, 0, (deckH + 0.85) / 2 - 0.05, bodyZ, C.dark);
  b.box(width + 0.1, 0.12, bodyLen + 0.1, 0, deckH - 0.04, bodyZ, C.deck);
  // laterais: design no meio (5,6 × 2,15 ≈ 2,6:1), paredes de alto-falante nas pontas
  const sideX = width / 2 + 0.01, midY = (deckH + 0.85) / 2 - 0.05, hh = deckH - 1.05;
  for (const [s, ry] of [[1, Math.PI / 2], [-1, -Math.PI / 2]] as const) {
    near.panels.panel(5.6, 2.15, [s * sideX, midY, -1.15], ry);
    G.panel(2.1, hh, [s * sideX, midY, z0 + 1.1], ry, 2, 3).panel(1.6, hh, [s * sideX, midY, cabZ0 - 0.95], ry, 2, 3);
  }
  G.panel(width - 0.2, hh, [0, midY, z0 - 0.01], Math.PI, 3, 3);
  L.box(0.04, 0.05, bodyLen, sideX + 0.01, 0.92, bodyZ, LIGHT_COLORS[1]).box(0.04, 0.05, bodyLen, -sideX - 0.01, 0.92, bodyZ, LIGHT_COLORS[0]);
  // guarda-corpo (abertura atrás, no topo da escada)
  const rx = width / 2 - 0.02, rz0 = z0 + 0.05, rz1 = cabZ0 - 0.15, y0 = deckH + 0.02;
  for (const y of [y0 + 0.55, y0 + 1.1]) {
    for (const s of [-1, 1]) b.bar([s * rx, y, rz0], [s * rx, y, rz1], 0.025, C.silver);
    b.bar([-rx, y, rz1], [rx, y, rz1], 0.025, C.silver);
    b.bar([-rx, y, rz0], [-0.55, y, rz0], 0.025, C.silver).bar([0.55, y, rz0], [rx, y, rz0], 0.025, C.silver);
  }
  for (let z = rz0; z <= rz1 + 1e-6; z += (rz1 - rz0) / 9) for (const s of [-1, 1]) b.bar([s * rx, y0, z], [s * rx, y0 + 1.1, z], 0.022, C.silver);
  for (const x of [-rx, -0.55, 0.55, rx]) b.bar([x, y0, rz0], [x, y0 + 1.1, rz0], 0.022, C.silver);
  // mesa de som (recorte do polígono do piso, frente-direita)
  b.box(0.85, 1.0, 1.2, -0.62, deckH + 0.5, 2.7, C.black).box(0.9, 0.06, 1.25, -0.62, deckH + 1.02, 2.7, C.chassis);
  L.box(0.7, 0.02, 1.0, -0.62, deckH + 1.06, 2.7, 0x3a6dff);
  // treliça e rig de luz
  const tz0 = z0 + 0.25, tz1 = cabZ0 - 0.3, ty = 7.3, tx = 1.12;
  for (const x of [-tx, tx]) for (const z of [tz0, tz1]) b.truss([x, deckH, z], [x, ty, z], 0.28, C.truss);
  for (const x of [-tx, tx]) b.truss([x, ty, tz0], [x, ty, tz1], 0.28, C.truss, 0.9);
  for (const z of [tz0, tz1, (tz0 + tz1) / 2]) b.truss([-tx, ty, z], [tx, ty, z], 0.28, C.truss);
  let li = 0;
  for (const x of [-tx, tx]) for (let k = 0; k < 5; k++) {
    const z = tz0 + 0.8 + (k * (tz1 - tz0 - 1.6)) / 4;
    b.cyl(0.13, 0.13, 0.26, 8, x, ty - 0.33, z, C.black);
    L.cyl(0.1, 0.1, 0.04, 8, x, ty - 0.48, z, LIGHT_COLORS[li++ % LIGHT_COLORS.length]);
  }
  for (const x of [-tx - 0.16, tx + 0.16]) L.box(0.05, 0.06, tz1 - tz0 - 0.4, x, ty - 0.12, (tz0 + tz1) / 2, LIGHT_COLORS[(li++) % LIGHT_COLORS.length]);
  // line arrays pendurados nos quatro cantos (curvatura crescente)
  for (const x of [-tx - 0.45, tx + 0.45]) for (const [z, dir] of [[tz0, -1], [tz1, 1]] as const) {
    for (let k = 0; k < 5; k++) b.box(0.62, 0.27, 0.48, x, ty - 0.35 - k * 0.29, z + dir * (0.05 + k * k * 0.012), C.black, [dir * k * 0.07, 0, 0]);
  }
  // telão traseiro (virado para trás: o cortejo vai atrás do trio)
  b.box(2.3, 1.42, 0.12, 0, 5.6, tz0 - 0.2, C.black);
  near.screen.panel(2.16, 1.22, [0, 5.6, tz0 - 0.27], Math.PI);
  // escada de acesso atrás (do chão ao piso)
  const [fx, fz] = TRIO.ladderFoot, lz0 = fz + 0.2, lz1 = z0;
  const tilt = Math.atan2(lz1 - lz0, deckH);
  for (const s of [-0.45, 0.45]) {
    b.box(0.06, Math.hypot(deckH, lz1 - lz0), 0.1, fx + s, deckH / 2, (lz0 + lz1) / 2, C.silver, [tilt, 0, 0]);
    b.bar([fx + s * 1.1, 0.9, lz0], [fx + s * 1.1, deckH + 1.0, lz1 + 0.1], 0.02, C.silver);
  }
  for (let i = 1; i <= 10; i++) { const t = i / 11; b.box(0.86, 0.05, 0.22, fx, t * deckH, lz0 + (lz1 - lz0) * t, C.chrome); }

  // médio: volumes + treliça simplificada + painéis + telão
  const mid = { body: new Kit(), panels: new Kit(true), screen: new Kit(true) };
  const m = mid.body;
  m.box(2.3, 0.35, len - 0.2, 0, 0.95, 0, C.chassis).box(2.5, 2.3, z1 - cabZ0, 0, 2.05, (cabZ0 + z1) / 2, C.white).box(2.42, 0.9, 1.1, 0, 3.66, 5.55, C.black)
    .box(width, deckH - 0.85, bodyLen, 0, midY, bodyZ, C.dark).box(width + 0.1, 0.12, bodyLen + 0.1, 0, deckH - 0.04, bodyZ, C.deck)
    .box(0.04, 1.1, bodyLen - 0.3, rx, deckH + 0.55, bodyZ, C.silver).box(0.04, 1.1, bodyLen - 0.3, -rx, deckH + 0.55, bodyZ, C.silver);
  wheels(m, [4.6, -3.0, -4.25], 1.1, 0.52, 0.42, 8);
  for (const x of [-tx, tx]) for (const z of [tz0, tz1]) m.box(0.28, ty - deckH, 0.28, x, (ty + deckH) / 2, z, C.truss);
  for (const x of [-tx, tx]) m.box(0.28, 0.28, tz1 - tz0, x, ty, (tz0 + tz1) / 2, C.truss);
  for (const z of [tz0, tz1]) m.box(2 * tx, 0.28, 0.28, 0, ty, z, C.truss);
  m.box(2.3, 1.42, 0.12, 0, 5.6, tz0 - 0.2, C.black);
  for (const x of [-tx - 0.45, tx + 0.45]) for (const z of [tz0, tz1]) m.box(0.62, 1.45, 0.5, x, ty - 1.0, z, C.black);
  for (const [s, ry] of [[1, Math.PI / 2], [-1, -Math.PI / 2]] as const) mid.panels.panel(5.6, 2.15, [s * sideX, midY, -1.15], ry);
  mid.screen.panel(2.16, 1.22, [0, 5.6, tz0 - 0.27], Math.PI);
  // longe: silhueta (caixa + cabine + "pórtico" da treliça)
  const far = new Kit();
  far.box(width, deckH - 0.4, bodyLen, 0, (deckH - 0.4) / 2 + 0.4, bodyZ, C.dark).box(2.5, 2.8, z1 - cabZ0, 0, 1.8, (cabZ0 + z1) / 2, C.white)
    .box(2 * tx + 0.3, 0.3, tz1 - tz0, 0, ty, (tz0 + tz1) / 2, C.truss);
  for (const z of [tz0, tz1]) for (const x of [-tx, tx]) far.box(0.3, ty - deckH, 0.3, x, (ty + deckH) / 2, z, C.truss);

  const g = new THREE.Group();
  g.add(lod([[level('trio_near', near, design), 0], [level('trio_mid', mid, design), 70], [level('trio_far', { body: far }, design), 200]]));
  g.userData.design = design;
  return g;
}

// ------------------------------------------------------------------------------- caminhão de campanha
/**
 * Caminhão de campanha (cenário, não utilizável): cavalo + baú com painéis de design nas laterais e na traseira.
 * `stage`: palquinho no teto (guarda-corpo, duas caixas de som e um pórtico de luz). 8,5 × 2,5 m.
 * Mesma geometria para todas as campanhas — só a TEXTURA dos painéis muda.
 */
export function buildCampaignTruck(design = 0, stage = false): THREE.Group {
  const near = { body: new Kit(), light: new Kit(), panels: new Kit(true), extraPanels: new Kit(true), extraTarget: 'flag' as DesignTarget };
  const b = near.body;
  b.box(2.2, 0.3, 8.3, 0, 0.75, 0, C.chassis);
  wheels(b, [3.2, -2.2, -3.4], 1.05, 0.48, 0.36, 14);
  b.box(2.45, 2.0, 1.75, 0, 1.9, 3.35, C.white).box(2.2, 0.8, 0.05, 0, 2.35, 4.24, C.glass).box(2.47, 0.32, 0.2, 0, 0.75, 4.3, C.black)
    .box(0.05, 0.6, 0.8, 1.23, 2.3, 3.4, C.glass).box(0.05, 0.6, 0.8, -1.23, 2.3, 3.4, C.glass)
    .box(2.5, 2.6, 6.6, 0, 2.3, -0.95, C.white).box(2.54, 0.08, 6.64, 0, 3.62, -0.95, C.chrome);
  near.panels.panel(6.0, 2.3, [1.26, 2.3, -0.95], Math.PI / 2).panel(6.0, 2.3, [-1.26, 2.3, -0.95], -Math.PI / 2);
  near.extraPanels.panel(2.3, 2.2, [0, 2.3, -4.26], Math.PI);
  near.light.box(0.36, 0.18, 0.04, 0.8, 1.15, 4.42, C.head).box(0.36, 0.18, 0.04, -0.8, 1.15, 4.42, C.head)
    .box(0.22, 0.14, 0.03, 1.0, 1.0, -4.27, C.tail).box(0.22, 0.14, 0.03, -1.0, 1.0, -4.27, C.tail);
  if (stage) {
    const y = 3.66;
    for (const [a, c] of [[[-1.2, y + 1, -4.1], [-1.2, y + 1, 2.2]], [[1.2, y + 1, -4.1], [1.2, y + 1, 2.2]], [[-1.2, y + 1, 2.2], [1.2, y + 1, 2.2]], [[-1.2, y + 1, -4.1], [1.2, y + 1, -4.1]]] as [V3, V3][]) b.bar(a, c, 0.025, C.silver);
    for (let z = -4.1; z <= 2.21; z += 1.05) for (const x of [-1.2, 1.2]) b.bar([x, y, z], [x, y + 1, z], 0.02, C.silver);
    for (const x of [-0.75, 0.75]) b.box(0.7, 1.1, 0.6, x, y + 0.55, 1.75, C.black);
    b.truss([-1.15, y, -0.4], [-1.15, y + 2.6, -0.4], 0.22, C.truss).truss([1.15, y, -0.4], [1.15, y + 2.6, -0.4], 0.22, C.truss).truss([-1.15, y + 2.6, -0.4], [1.15, y + 2.6, -0.4], 0.22, C.truss);
    for (let k = 0; k < 4; k++) near.light.cyl(0.09, 0.09, 0.05, 8, -0.75 + k * 0.5, y + 2.4, -0.4, LIGHT_COLORS[k]);
  }
  const mid = { body: new Kit(), panels: new Kit(true) };
  mid.body.box(2.2, 0.3, 8.3, 0, 0.75, 0, C.chassis).box(2.45, 2.0, 1.75, 0, 1.9, 3.35, C.white).box(2.5, 2.6, 6.6, 0, 2.3, -0.95, C.white);
  if (stage) mid.body.box(1.6, 1.1, 0.6, 0, 4.2, 1.75, C.black).box(2.3, 0.22, 0.22, 0, 6.3, -0.4, C.truss);
  wheels(mid.body, [3.2, -2.2, -3.4], 1.05, 0.48, 0.36, 8);
  mid.panels.panel(6.0, 2.3, [1.26, 2.3, -0.95], Math.PI / 2).panel(6.0, 2.3, [-1.26, 2.3, -0.95], -Math.PI / 2);
  const far = new Kit();
  far.box(2.45, 2.6, 8.3, 0, 1.9, 0, C.white);
  const g = new THREE.Group();
  g.add(lod([[level('truck_near', near, design), 0], [level('truck_mid', mid, design), 50], [level('truck_far', { body: far }, design), 160]]));
  g.userData.design = design;
  return g;
}

// ------------------------------------------------------------------------------- telão de treliça
/** telão avulso: duas torres de treliça com lastro, viga no topo, tela 4,8 × 2,7 m virada para +z */
export function buildScreenStand(): THREE.Group {
  const near = { body: new Kit(), screen: new Kit(true) };
  const b = near.body;
  for (const x of [-2.6, 2.6]) { b.truss([x, 0.3, 0], [x, 6.4, 0], 0.4, C.truss).box(1.0, 0.3, 1.0, x, 0.15, 0, C.concrete); }
  b.truss([-2.8, 6.4, 0], [2.8, 6.4, 0], 0.4, C.truss);
  b.box(5.0, 2.9, 0.18, 0, 4.65, -0.1, C.black);
  near.screen.panel(4.8, 2.7, [0, 4.65, 0.0], 0);
  const mid = { body: new Kit(), screen: new Kit(true) };
  for (const x of [-2.6, 2.6]) mid.body.box(0.4, 6.4, 0.4, x, 3.2, 0, C.truss);
  mid.body.box(5.6, 0.4, 0.4, 0, 6.4, 0, C.truss).box(5.0, 2.9, 0.18, 0, 4.65, -0.1, C.black);
  mid.screen.panel(4.8, 2.7, [0, 4.65, 0.0], 0);
  const g = new THREE.Group();
  g.add(lod([[level('screen_near', near, 0), 0], [level('screen_mid', mid, 0), 60]]));
  return g;
}

// ------------------------------------------------------------------------------- palco
/**
 * Palco modular 10 × 7 m: tablado a 1,4 m com saia, quatro torres de treliça e cobertura, telão no fundo,
 * faixa de design acima do telão (alvo 'stage'), line arrays nas laterais, subwoofers no chão, rig de luz.
 */
export function buildStage(design = 0): THREE.Group {
  const near = { body: new Kit(), light: new Kit(), grille: new Kit(true), panels: new Kit(true), panelTarget: 'stage' as DesignTarget, screen: new Kit(true) };
  const b = near.body, W = 10, D = 7, H = 1.4, top = 8.4;
  b.box(W, H, D, 0, H / 2, 0, C.dark).box(W + 0.2, 0.08, D + 0.2, 0, H + 0.04, 0, C.deck);
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) b.truss([x, H, z], [x, top, z], 0.4, C.truss, 0.8);
  for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) b.truss([-W / 2 + 0.2, top, z], [W / 2 - 0.2, top, z], 0.4, C.truss, 0.9);
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) b.truss([x, top, -D / 2 + 0.2], [x, top, D / 2 - 0.2], 0.4, C.truss, 0.9);
  b.box(W + 0.6, 0.12, D + 0.6, 0, top + 0.3, 0, C.black); // cobertura
  b.box(5.8, 3.3, 0.2, 0, 5.0, -D / 2 + 0.35, C.black);
  near.screen.panel(5.4, 3.04, [0, 5.0, -D / 2 + 0.47], 0);
  b.box(6.6, 1.8, 0.12, 0, 7.35, -D / 2 + 0.35, C.black);
  near.panels.panel(6.4, 1.6, [0, 7.35, -D / 2 + 0.42], 0);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) b.box(0.8, 0.32, 0.6, s * (W / 2 + 0.6), top - 0.6 - k * 0.34, D / 2 - 0.6, C.black, [k * 0.05, 0, 0]);
    b.box(1.3, 1.2, 1.0, s * (W / 2 + 0.9), 0.6, D / 2 - 0.4, C.black);
    near.grille.panel(1.2, 1.1, [s * (W / 2 + 0.9), 0.6, D / 2 + 0.11], 0, 1, 1);
    for (let k = 0; k < 4; k++) b.box(1.6, 0.18, 0.35, s * 3.6, 0.09 + k * 0.35, -D / 2 - 0.2 - k * 0.35 + 1.05, C.chrome); // escadas no fundo
  }
  near.grille.panel(W - 0.4, H - 0.3, [0, H / 2, D / 2 + 0.01], 0, 8, 1);
  let li = 0;
  for (let k = 0; k < 8; k++) { const x = -W / 2 + 1.2 + k * ((W - 2.4) / 7); b.cyl(0.15, 0.15, 0.3, 8, x, top - 0.4, D / 2 - 0.2, C.black); near.light.cyl(0.12, 0.12, 0.04, 8, x, top - 0.57, D / 2 - 0.2, LIGHT_COLORS[li++ % LIGHT_COLORS.length]); }
  near.light.box(W - 1, 0.06, 0.06, 0, top - 0.25, D / 2 + 0.05, LIGHT_COLORS[2]);
  const mid = { body: new Kit(), panels: new Kit(true), panelTarget: 'stage' as DesignTarget, screen: new Kit(true) };
  mid.body.box(W, H, D, 0, H / 2, 0, C.dark).box(W + 0.6, 0.3, D + 0.6, 0, top + 0.2, 0, C.black).box(5.8, 3.3, 0.2, 0, 5.0, -D / 2 + 0.35, C.black);
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (const z of [-D / 2 + 0.2, D / 2 - 0.2]) mid.body.box(0.4, top - H, 0.4, x, (top + H) / 2, z, C.truss);
  for (const s of [-1, 1]) mid.body.box(0.8, 2.0, 0.6, s * (W / 2 + 0.6), top - 1.5, D / 2 - 0.6, C.black);
  mid.screen.panel(5.4, 3.04, [0, 5.0, -D / 2 + 0.47], 0);
  mid.panels.panel(6.4, 1.6, [0, 7.35, -D / 2 + 0.42], 0);
  const far = new Kit();
  far.box(W, H, D, 0, H / 2, 0, C.dark).box(W + 0.6, 0.4, D + 0.6, 0, top + 0.2, 0, C.black);
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) far.box(0.4, top - H, 0.4, x, (top + H) / 2, -D / 2 + 0.2, C.truss);
  const g = new THREE.Group();
  g.add(lod([[level('stage_near', near, design), 0], [level('stage_mid', mid, design), 70], [level('stage_far', { body: far }, design), 220]]));
  g.userData.design = design;
  return g;
}

/** telões (malhas) dentro de um objeto — para trocar de material perto/longe */
export function screenMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if (o.userData.eventScreen) out.push(o as THREE.Mesh); });
  return out;
}
