/**
 * Geometria dos itens — construída UMA vez por (tipo, qualidade) e compartilhada por todos os personagens e pela
 * multidão instanciada. Tudo procedural (sem modelos externos), em metros, com proporções reais:
 *
 *  - partes rígidas de um item numa só malha (`rigid`): cor por vértice + rugosidade/metalicidade por vértice
 *    (`aPbr`) → um draw call com o material único de corpo (propMaterials.propBodyMaterial)
 *  - partes com DESIGN (`parts`): tecido de bandeira/faixa ou face de cartaz, cada uma com sua transformação no
 *    referencial do item e seu tamanho; a malha do tecido é compartilhada por (tamanho, LOD)
 *
 * Referencial do item: origem no ponto de pegada (centro do punho; cartaz "pela borda": meio das duas mãos),
 * +Y ao longo do cabo/mastro, +Z para a frente (face do cartaz, boca do megafone).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropKind, DesignSlot } from '../props';
import { assetManager } from '../../core/AssetManager';
import { PROP_CATEGORY, type DesignPartKind } from './propMaterials';
import { clothSegments, type ClothLod } from './grips';

export type GeoQuality = 'near' | 'far';

/** parte com design (tecido ou face de cartaz) no referencial do item */
export interface DesignPart {
  slot: DesignSlot;
  part: DesignPartKind;
  /** largura × altura (m) */
  w: number;
  h: number;
  /** parte → item (tecido: origem no canto superior junto ao mastro; face: no centro) */
  m: THREE.Matrix4;
}

export interface PropModel {
  rigid: THREE.BufferGeometry;
  parts: DesignPart[];
  /** guarda-chuva: lona colorida separada (cor por design) */
  canopy?: THREE.BufferGeometry;
}

// ------------------------------------------------------------------ medidas (m)
export const FLAG_SMALL = { poleLen: 1.4, poleBelow: 0.38, poleR: 0.0105, clothW: 0.9, clothH: 0.63 };
export const FLAG_LARGE = { poleLen: 4.3, poleBelow: 1.05, poleR: 0.019, clothW: 3.2, clothH: 2.24 };
export const SIGN_SMALL = { w: 0.48, h: 0.64, t: 0.006, below: 0.05 };
export const SIGN_LARGE = { w: 0.66, h: 0.88, t: 0.012, stickBelow: 0.36, boardFrom: 0.26 };
export const SIGN_DOUBLE = { w: 0.5, h: 0.667, t: 0.01, stickBelow: 0.36, boardFrom: 0.3, spread: 0.11 };
export const BANNER = { poleLen: 1.55, poleBelow: 0.42, poleR: 0.0135, clothH: 0.7, nominalW: 2.4 };
export const DRUM = { r: 0.22, h: 0.36 };

// ------------------------------------------------------------------ montagem
type Paint = { color: number; rough: number; metal: number };
const C = (color: number, rough: number, metal = 0): Paint => ({ color, rough, metal });
const WOOD = C(0x9a6b3f, 0.72), WOOD_LIGHT = C(0xc9a576, 0.66), ALU = C(0xb9bec4, 0.32, 0.92), STEEL = C(0x8d9196, 0.38, 0.9);
const CARDBOARD = C(0xa47a4c, 0.92), CARDBOARD_BACK = C(0xb48c5d, 0.94), FOAM_EDGE = C(0xe8e6df, 0.85);
const PLASTIC_DARK = C(0x1d1f22, 0.5), PLASTIC_CREAM = C(0xe9e4d6, 0.42), PLASTIC_RED = C(0xb3261e, 0.45), RUBBER = C(0x141414, 0.88);
const NYLON = C(0x23262b, 0.8), SKIN_HEAD = C(0xece6d6, 0.55), FELT = C(0xf0efe8, 0.95), GOLD = C(0xc8a24a, 0.35, 0.85);

const _c = new THREE.Color();
/** prepara uma peça: cor/PBR por vértice, transformação, índice garantido (mergeGeometries exige uniformidade) */
function piece(g: THREE.BufferGeometry, p: Paint | ((x: number, y: number, z: number) => Paint), m?: THREE.Matrix4): THREE.BufferGeometry {
  if (m) g.applyMatrix4(m);
  if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3), pbr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const q = typeof p === 'function' ? p(pos.getX(i), pos.getY(i), pos.getZ(i)) : p;
    _c.setHex(q.color, THREE.SRGBColorSpace);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    pbr[i * 2] = q.rough; pbr[i * 2 + 1] = q.metal;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'aPbr'].includes(k)) g.deleteAttribute(k);
  return g;
}

function merge(list: THREE.BufferGeometry[], name: string): THREE.BufferGeometry {
  const g = mergeGeometries(list, false)!;
  list.forEach((x) => x.dispose());
  g.name = name;
  g.computeBoundingSphere();
  return g;
}

const M = () => new THREE.Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);
const RX = (a: number) => M().makeRotationX(a);
const RZ = (a: number) => M().makeRotationZ(a);
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((acc, m) => acc.multiply(m), M());

/** cilindro ao longo de Y de y0 a y1 (raios r0 embaixo, r1 em cima) */
function rod(r0: number, r1: number, y0: number, y1: number, seg: number, p: Paint, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open);
  return piece(g, p, T(0, (y0 + y1) / 2, 0));
}

/** caixa de cantos chanfrados (placa com espessura real): perfil arredondado extrudado em Z, centrada */
function board(w: number, h: number, t: number, r: number, p: Paint | ((x: number, y: number, z: number) => Paint), q: GeoQuality) {
  if (q === 'far') return piece(new THREE.BoxGeometry(w, h, t), p);
  const s = new THREE.Shape();
  const x0 = -w / 2, y0 = -h / 2;
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const bevel = Math.min(t * 0.3, 0.0015);
  const g = new THREE.ExtrudeGeometry(s, { depth: t - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  // UVs do extrude são em metros: escala para o desgaste repetir ~2× por metro
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  return piece(g, p);
}

// ------------------------------------------------------------------ itens
function flagSmall(q: GeoQuality): PropModel {
  const f = FLAG_SMALL, seg = q === 'near' ? 10 : 5;
  const top = f.poleLen - f.poleBelow;
  const list = [
    rod(f.poleR, f.poleR * 0.92, -f.poleBelow, top, seg, WOOD_LIGHT),
    // ponteira e pé de borracha
    piece(new THREE.SphereGeometry(f.poleR * 1.7, seg, 6), GOLD, T(0, top + f.poleR * 1.2, 0)),
    rod(f.poleR * 1.1, f.poleR * 1.1, -f.poleBelow - 0.01, -f.poleBelow + 0.02, seg, RUBBER),
  ];
  return { rigid: merge(list, 'prop_flag_small'), parts: [{ slot: 'flag', part: 'flag_small', w: f.clothW, h: f.clothH, m: T(f.poleR, top - 0.015, 0) }] };
}

function flagLarge(q: GeoQuality): PropModel {
  const f = FLAG_LARGE, seg = q === 'near' ? 12 : 5;
  const top = f.poleLen - f.poleBelow;
  const list = [
    // mastro de alumínio em duas seções (encaixe visível) e lança na ponta
    rod(f.poleR, f.poleR, -f.poleBelow, 1.2, seg, ALU),
    rod(f.poleR * 1.25, f.poleR * 1.25, 1.18, 1.26, seg, STEEL),
    rod(f.poleR * 0.85, f.poleR * 0.8, 1.2, top, seg, ALU),
    rod(f.poleR * 1.3, 0.002, top, top + 0.12, seg, GOLD),
    rod(f.poleR * 1.15, f.poleR * 1.15, -f.poleBelow - 0.015, -f.poleBelow + 0.03, seg, RUBBER),
  ];
  if (q === 'near') {
    // empunhadura emborrachada onde vão as mãos
    list.push(rod(f.poleR * 1.12, f.poleR * 1.12, -0.32, 0.3, seg, RUBBER));
  }
  return { rigid: merge(list, 'prop_flag_large'), parts: [{ slot: 'flag', part: 'flag_large', w: f.clothW, h: f.clothH, m: T(f.poleR, top - 0.03, 0) }] };
}

/** papelão ondulado: borda com listras finas (as "ondas" do miolo) */
const corrugated = (x: number, y: number, z: number): Paint => (Math.abs(z) < 0.0025 && Math.sin((x + y) * 900) > 0 ? C(0x8a6239, 0.95) : CARDBOARD);

function signSmall(q: GeoQuality): PropModel {
  const s = SIGN_SMALL;
  // papelão: segurado pela borda de baixo com as duas mãos (sem cabo)
  const list = [board(s.w, s.h, s.t, 0.004, corrugated, q)];
  list[0].translate(0, s.h / 2 - s.below, 0);
  if (q === 'near') {
    // fita adesiva nos cantos de cima (desgaste)
    for (const sx of [-1, 1]) list.push(piece(new THREE.BoxGeometry(0.05, 0.022, s.t + 0.001), C(0xd8cfae, 0.6), mul(T(sx * (s.w / 2 - 0.02), s.h - s.below - 0.015, 0), RZ(sx * 0.7))));
  }
  return { rigid: merge(list, 'prop_sign_small'), parts: [{ slot: 'sign', part: 'face', w: s.w - 0.012, h: s.h - 0.012, m: T(0, s.h / 2 - s.below, s.t / 2 + 0.0008) }] };
}

function signLarge(q: GeoQuality): PropModel {
  const s = SIGN_LARGE;
  const boardC = s.boardFrom + s.h / 2;
  const stickZ = -s.t / 2 - 0.011;
  const b = board(s.w, s.h, s.t, 0.006, (_x, _y, z) => (z < -s.t / 2 + 0.002 ? CARDBOARD_BACK : FOAM_EDGE), q);
  b.translate(0, boardC, 0);
  const list = [
    b,
    // sarrafo de madeira 2×2 cm atrás da placa
    piece(new THREE.BoxGeometry(0.021, s.boardFrom + s.stickBelow + s.h * 0.75, 0.021), WOOD, T(0, (-s.stickBelow + s.boardFrom + s.h * 0.75) / 2, stickZ)),
  ];
  if (q === 'near') {
    // grampos/parafusos prendendo a placa
    for (const y of [s.boardFrom + 0.08, s.boardFrom + s.h * 0.45, s.boardFrom + s.h * 0.7]) list.push(piece(new THREE.CylinderGeometry(0.004, 0.004, 0.004, 6), STEEL, mul(T(0, y, s.t / 2 + 0.0005), RX(Math.PI / 2))));
  }
  return { rigid: merge(list, 'prop_sign_large'), parts: [{ slot: 'sign', part: 'face', w: s.w - 0.014, h: s.h - 0.014, m: T(0, boardC, s.t / 2 + 0.0008) }] };
}

function signDouble(q: GeoQuality): PropModel {
  const s = SIGN_DOUBLE;
  const list: THREE.BufferGeometry[] = [];
  const parts: DesignPart[] = [];
  const top = s.boardFrom + s.h;
  // duas placas em cavalete (unidas no topo, abertas embaixo), cada uma com design para fora
  const ang = Math.atan2(s.spread / 2, s.h);
  for (const side of [1, -1]) {
    const b = board(s.w, s.h, s.t, 0.005, (_x, _y, z) => (Math.abs(z) < s.t / 2 - 0.002 ? FOAM_EDGE : CARDBOARD_BACK), q);
    b.translate(0, -s.h / 2, 0);
    const hinge = mul(T(0, top, side * 0.006), RX(-side * ang));
    b.applyMatrix4(hinge);
    list.push(b);
    parts.push({ slot: 'sign', part: 'face', w: s.w - 0.012, h: s.h - 0.012, m: mul(hinge.clone(), T(0, -s.h / 2, side * (s.t / 2 + 0.0008)), side > 0 ? M() : M().makeRotationY(Math.PI)) });
  }
  // dobradiça de fita no topo e cabo de madeira passando entre as placas
  list.push(piece(new THREE.BoxGeometry(s.w, 0.016, 0.03), C(0x2b2b2b, 0.55), T(0, top, 0)));
  list.push(piece(new THREE.BoxGeometry(0.022, s.stickBelow + top - 0.05, 0.022), WOOD, T(0, (-s.stickBelow + top - 0.05) / 2, 0)));
  // travessa que mantém as placas abertas
  list.push(piece(new THREE.BoxGeometry(0.018, 0.018, s.spread + 0.02), WOOD, T(0, s.boardFrom + 0.05, 0)));
  return { rigid: merge(list, 'prop_sign_double'), parts };
}

/** faixa: um mastro curto (por mão). A largura do pano vem da distância entre as mãos (ver PropAttachment) */
function bannerPole(q: GeoQuality): PropModel {
  const b = BANNER, seg = q === 'near' ? 8 : 5;
  const top = b.poleLen - b.poleBelow;
  const list = [
    rod(b.poleR, b.poleR * 0.9, -b.poleBelow, top, seg, WOOD),
    piece(new THREE.SphereGeometry(b.poleR * 1.5, seg, 5), WOOD, T(0, top, 0)),
  ];
  return { rigid: merge(list, 'prop_banner_pole'), parts: [{ slot: 'banner', part: 'banner', w: b.nominalW, h: b.clothH, m: T(0, top - 0.04, 0) }] };
}

function megaphone(q: GeoQuality): PropModel {
  const seg = q === 'near' ? 20 : 8;
  const list: THREE.BufferGeometry[] = [];
  // cabo de pistola no punho (+Y), corpo e corneta para a frente (+Z) logo acima do punho
  list.push(piece(new THREE.BoxGeometry(0.032, 0.115, 0.04), PLASTIC_DARK, mul(T(0, 0.0, -0.005), RX(-0.12))));
  list.push(piece(new THREE.BoxGeometry(0.012, 0.03, 0.014), PLASTIC_RED, T(0, 0.035, 0.026))); // gatilho
  const bodyY = 0.085;
  list.push(piece(new THREE.CylinderGeometry(0.043, 0.043, 0.16, seg), PLASTIC_CREAM, mul(T(0, bodyY, -0.03), RX(Math.PI / 2))));
  list.push(piece(new THREE.CylinderGeometry(0.044, 0.044, 0.025, seg), PLASTIC_DARK, mul(T(0, bodyY, -0.115), RX(Math.PI / 2)))); // tampa da pilha
  // corneta com parede de espessura real (perfil fechado no torno)
  const pts = [[0.044, 0], [0.06, 0.05], [0.085, 0.13], [0.112, 0.2], [0.116, 0.205], [0.11, 0.205], [0.106, 0.2], [0.08, 0.13], [0.055, 0.05], [0.04, 0.005]].map(([r, y]) => new THREE.Vector2(r, y));
  const horn = new THREE.LatheGeometry(pts, seg);
  list.push(piece(horn, (_x, y) => (y > 0.192 ? PLASTIC_RED : PLASTIC_CREAM), mul(T(0, bodyY, 0.05), RX(Math.PI / 2))));
  // grade do alto-falante (fundo da corneta)
  list.push(piece(new THREE.CircleGeometry(0.043, seg), PLASTIC_DARK, mul(T(0, bodyY, 0.056))));
  return { rigid: merge(list, 'prop_megaphone'), parts: [] };
}

function whistle(q: GeoQuality): PropModel {
  const seg = q === 'near' ? 12 : 6;
  const list = [
    // corpo (câmara redonda + bocal) saindo do lado do polegar
    piece(new THREE.CylinderGeometry(0.0125, 0.0125, 0.016, seg), C(0xd9dde1, 0.25, 0.95), mul(T(0, 0.022, 0.0), RZ(Math.PI / 2))),
    piece(new THREE.BoxGeometry(0.012, 0.03, 0.009), C(0xd9dde1, 0.25, 0.95), T(0, 0.04, 0.006)),
    piece(new THREE.TorusGeometry(0.006, 0.0015, 4, seg), C(0xd9dde1, 0.25, 0.95), T(0, 0.008, -0.004)),
    // cordão
    piece(new THREE.TorusGeometry(0.035, 0.0018, 4, seg * 2), C(0xc0262a, 0.8), mul(T(0, -0.028, -0.004), RX(0.3))),
  ];
  return { rigid: merge(list, 'prop_whistle'), parts: [] };
}

function umbrella(q: GeoQuality): PropModel {
  const seg = q === 'near' ? 8 : 6;
  const list: THREE.BufferGeometry[] = [];
  const shaftTop = 0.86, R = 0.52, crown = shaftTop - 0.02, rim = crown - 0.27;
  // cabo em J (madeira) e haste metálica
  const j = new THREE.TorusGeometry(0.045, 0.012, 6, q === 'near' ? 12 : 6, Math.PI);
  list.push(piece(j, WOOD, mul(T(0.045, -0.06, 0), RZ(Math.PI))));
  list.push(rod(0.013, 0.013, -0.06, 0.08, seg, WOOD));
  list.push(rod(0.006, 0.006, 0.08, shaftTop + 0.06, seg, STEEL));
  // varetas (8): do topo até a borda, seguindo a lona
  const ribs = 8;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const len = Math.hypot(R, crown - rim);
    const tilt = Math.atan2(R, crown - rim);
    list.push(piece(new THREE.CylinderGeometry(0.0022, 0.0022, len, 4), STEEL, mul(M().makeRotationY(a), T(0, crown, 0), RZ(-tilt), T(0, -len / 2, 0), RX(Math.PI))));
    // ponteira
    list.push(piece(new THREE.SphereGeometry(0.006, 4, 3), C(0x222222, 0.5), mul(M().makeRotationY(a), T(R, rim - 0.003, 0))));
  }
  // lona: gomos com barriga entre as varetas (borda recortada em arco)
  const rings = q === 'near' ? 6 : 3, perPanel = q === 'near' ? 5 : 2;
  const cols = ribs * perPanel;
  const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2;
      const inPanel = (c % perPanel) / perPanel;
      const sag = Math.sin(inPanel * Math.PI) * 0.05 * t; // entre varetas a lona fica mais baixa e recolhida
      const rr = R * t * (1 - sag * 0.6);
      const y = crown - (crown - rim) * Math.pow(t, 1.25) - sag * 0.6;
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      uvs.push(c / cols, t);
    }
  }
  for (let r = 0; r < rings; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + cols + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const canopy = new THREE.BufferGeometry();
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  canopy.setIndex(idx);
  canopy.computeVertexNormals();
  canopy.name = 'prop_umbrella_canopy';
  canopy.computeBoundingSphere();
  return { rigid: merge(list, 'prop_umbrella'), parts: [], canopy };
}

function drum(q: GeoQuality): PropModel {
  const d = DRUM, seg = q === 'near' ? 28 : 10;
  const list: THREE.BufferGeometry[] = [];
  // casco de alumínio, peles, aros e tirantes (surdo)
  list.push(piece(new THREE.CylinderGeometry(d.r, d.r, d.h, seg, 1, true), ALU));
  for (const s of [1, -1]) {
    list.push(piece(new THREE.CircleGeometry(d.r * 0.985, seg), SKIN_HEAD, mul(T(0, (s * d.h) / 2 + s * 0.003, 0), RX(-s * Math.PI / 2))));
    list.push(piece(new THREE.TorusGeometry(d.r + 0.006, 0.009, 6, seg), STEEL, mul(T(0, (s * d.h) / 2, 0), RX(Math.PI / 2))));
  }
  const rods = q === 'near' ? 8 : 0;
  for (let i = 0; i < rods; i++) {
    const a = (i / rods) * Math.PI * 2;
    list.push(piece(new THREE.CylinderGeometry(0.0035, 0.0035, d.h + 0.01, 5), STEEL, T(Math.cos(a) * (d.r + 0.014), 0, Math.sin(a) * (d.r + 0.014))));
    list.push(piece(new THREE.BoxGeometry(0.014, 0.03, 0.012), STEEL, mul(M().makeRotationY(-a), T(d.r + 0.008, 0, 0))));
  }
  // argolas da alça
  for (const s of [1, -1]) list.push(piece(new THREE.TorusGeometry(0.012, 0.003, 4, 8), STEEL, T(s * (d.r + 0.02), d.h * 0.32, 0)));
  return { rigid: merge(list, 'prop_drum'), parts: [] };
}

/** baqueta do surdo (na mão direita) */
function mallet(q: GeoQuality): THREE.BufferGeometry {
  const seg = q === 'near' ? 8 : 5;
  return merge([
    rod(0.0095, 0.0085, -0.08, 0.26, seg, WOOD_LIGHT),
    piece(new THREE.CylinderGeometry(0.034, 0.034, 0.05, seg * 2), FELT, mul(T(0, 0.28, 0), RZ(Math.PI / 2))),
  ], 'prop_mallet');
}

function bat(q: GeoQuality): PropModel {
  const seg = q === 'near' ? 14 : 6;
  // perfil real de taco (knob, cabo fino, transição, barril), 0,84 m; pegada a 8 cm do knob
  const prof = [[0, -0.1], [0.024, -0.1], [0.027, -0.09], [0.016, -0.08], [0.0125, -0.05], [0.0125, 0.18], [0.017, 0.32], [0.028, 0.48], [0.033, 0.62], [0.033, 0.72], [0.028, 0.735], [0, 0.74]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const list = [piece(g, (_x, y) => (y < 0.14 && y > -0.075 ? C(0x1c1c1c, 0.9) : WOOD_LIGHT))];
  return { rigid: merge(list, 'prop_bat'), parts: [] };
}

const BUILDERS: Record<PropKind, (q: GeoQuality) => PropModel> = {
  flag_small: flagSmall, flag_large: flagLarge, sign_small: signSmall, sign_large: signLarge, sign_double: signDouble,
  banner: bannerPole, megaphone, whistle, umbrella, drum, bat,
};

const models = new Map<string, PropModel>();
/** modelo compartilhado do item (construído na primeira vez; vive a sessão inteira — poucos KB por tipo) */
export function propModel(kind: PropKind, q: GeoQuality = 'near'): PropModel {
  const key = `${kind}:${q}`;
  let m = models.get(key);
  if (!m) {
    m = BUILDERS[kind](q);
    assetManager.register({ category: PROP_CATEGORY, geometry: m.rigid });
    if (m.canopy) assetManager.register({ category: PROP_CATEGORY, geometry: m.canopy });
    models.set(key, m);
  }
  return m;
}

let malletGeo: Record<GeoQuality, THREE.BufferGeometry | null> = { near: null, far: null };
export function malletGeometry(q: GeoQuality = 'near'): THREE.BufferGeometry {
  if (!malletGeo[q]) { malletGeo[q] = mallet(q); assetManager.register({ category: PROP_CATEGORY, geometry: malletGeo[q]! }); }
  return malletGeo[q]!;
}

// ------------------------------------------------------------------ tecido e faces (compartilhadas)
const clothGeos = new Map<string, THREE.BufferGeometry>();
/**
 * Malha do tecido: x de 0 (mastro) a w, y de 0 (topo) a −h, z = 0; uv.x = 0 no mastro.
 * Densidade por LOD (grips.clothSegments). Geometria unitária (w = h = 1) para os instanciados.
 */
export function clothGeometry(kind: 'flag_small' | 'flag_large' | 'banner' | 'big', lod: ClothLod, w: number, h: number): THREE.BufferGeometry {
  const key = `${kind}:${lod}:${w}x${h}`;
  let g = clothGeos.get(key);
  if (g) return g;
  const [sx, sy] = clothSegments(kind, lod);
  g = new THREE.PlaneGeometry(w, h, sx, sy);
  g.translate(w / 2, -h / 2, 0);
  g.name = `prop_cloth_${key}`;
  // a onda pode tirar o pano de dentro da caixa de repouso: esfera folgada (culling por objeto)
  g.computeBoundingSphere();
  g.boundingSphere!.radius += Math.max(w, h) * 0.3;
  assetManager.register({ category: PROP_CATEGORY, geometry: g });
  clothGeos.set(key, g);
  return g;
}

const faceGeos = new Map<string, THREE.BufferGeometry>();
/** face de cartaz (plano centrado, normal +Z) */
export function faceGeometry(w: number, h: number): THREE.BufferGeometry {
  const key = `${w}x${h}`;
  let g = faceGeos.get(key);
  if (!g) {
    g = new THREE.PlaneGeometry(w, h);
    g.name = `prop_face_${key}`;
    assetManager.register({ category: PROP_CATEGORY, geometry: g });
    faceGeos.set(key, g);
  }
  return g;
}

/** alça de nylon (caixa unitária ao longo de Y, esticada entre dois pontos a cada quadro) */
let strapGeo: THREE.BufferGeometry | null = null;
export function strapGeometry(): THREE.BufferGeometry {
  if (!strapGeo) {
    strapGeo = piece(new THREE.BoxGeometry(0.04, 1, 0.004), NYLON, T(0, 0.5, 0));
    strapGeo.name = 'prop_strap';
    assetManager.register({ category: PROP_CATEGORY, geometry: strapGeo });
  }
  return strapGeo;
}
