/**
 * Mobiliário urbano e vegetação — modelos procedurais originais, desenhados por instancing
 * (um InstancedMesh por parte de modelo, global para todos os chunks próximos).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropRec } from '../types';
import { CURB_HEIGHT } from '../types';
import { mulberry32 } from '../../renderer/noise';
import { loadVegetation, speciesAt, VegetationSystem, vegetationOptionsFor, type TreeInstance } from '../vegetation';

type Part = { geo: THREE.BufferGeometry; mat: THREE.Material; castShadow: boolean };
export interface PropModel { parts: Part[] }

function colorize(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, seed = 1): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const rnd = mulberry32(seed);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rnd() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      arr[(i + k) * 3] = c.r * j; arr[(i + k) * 3 + 1] = c.g * j; arr[(i + k) * 3 + 2] = c.b * j;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

const merge = (gs: THREE.BufferGeometry[]) => {
  const m = mergeGeometries(gs, false)!;
  m.computeBoundingSphere();
  return m;
};

// ------------------------------------------------------------------------------------------
// materiais compartilhados
// ------------------------------------------------------------------------------------------
export interface PropMaterials {
  painted: THREE.MeshStandardMaterial; // vertexColors, aço pintado (acetinado)
  metal: THREE.MeshStandardMaterial; // vertexColors, aço galvanizado
  matte: THREE.MeshStandardMaterial; // vertexColors, madeira/concreto
  plastic: THREE.MeshStandardMaterial; // vertexColors, plástico (lixeiras)
  lampGlow: THREE.MeshStandardMaterial;
  signalLights: THREE.MeshStandardMaterial;
  signalLamp: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
  /** tempo para o vento das folhas (VegetationSystem) */
  windUniform: { value: number };
}

export function createPropMaterials(_noise: THREE.Texture): PropMaterials {
  const windUniform = { value: 0 };
  return {
    painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.85 }),
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }),
    plastic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff4dd, emissive: 0xffe2b0, emissiveIntensity: 0.15, roughness: 0.3 }),
    signalLights: new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3, metalness: 0 }),
    signalLamp: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb4bb, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35, depthWrite: false }),
    windUniform,
  };
}

// ------------------------------------------------------------------------------------------
// mobiliário (rodada 5): proporções reais, chanfros (RoundedBox/Lathe/Tube/Extrude) e materiais
// distintos — aço pintado, aço galvanizado, plástico, madeira, vidro. Tudo instanciado.
// ------------------------------------------------------------------------------------------
const C = {
  steel: 0x5f6468, // cinza-grafite dos postes da Pres. Vargas
  steelDark: 0x3a3e41,
  galv: 0xa9adb0, // galvanizado
  black: 0x1d1f21,
  signal: 0x26292b,
  wood: 0x8a6239,
  comlurb: 0xf07a14, // laranja da Comlurb
  comlurbDark: 0xc95f0a,
  kiosk: 0x2f5d3e,
};

/**
 * LOD do mobiliário: os mesmos construtores geram a versão distante (LO = true) com caixas sem chanfro,
 * menos segmentos e sem detalhes pequenos (usada além de PROP_LOD_DIST).
 */
let LO = false;
export const PROP_LOD_DIST = 95;

/** caixa com cantos arredondados (chanfro real nas arestas) */
const rbox = (w: number, h: number, d: number, r = 0.02, seg = 1): THREE.BufferGeometry =>
  LO ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

/** sólido de revolução a partir de um perfil [raio, altura] */
const lathe = (profile: [number, number][], seg = 12) => new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), LO ? Math.max(5, seg >> 1) : seg);

/** tubo ao longo de uma curva */
const tube = (pts: THREE.Vector3[], r: number, seg = 16, radial = 6) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), LO ? Math.max(4, seg >> 1) : seg, r, LO ? 4 : radial, false);

/** prisma extrudado de um contorno 2D (no plano XY, extrusão em Z, centrado) */
function extrude(shape: [number, number][], depth: number, bevel = 0.01): THREE.BufferGeometry {
  const s = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** posições (no espaço do modelo) das duas luminárias do poste — usadas também para as luzes noturnas */
export const LAMP_HEADS: [number, number, number][] = [[2.55, 11.05, 0], [-2.55, 11.05, 0]];

function lampModel(mats: PropMaterials): PropModel {
  // poste cônico de aço (~11,5 m) com base flangeada e dois braços curvos com luminárias LED planas
  const H = 10.9;
  const pole = lathe([[0, 0], [0.24, 0], [0.24, 0.05], [0.17, 0.08], [0.15, 0.55], [0.125, 0.62], [0.11, 1.0], [0.065, H], [0.07, H + 0.05], [0, H + 0.12]], 10);
  const metal = [colorize(pole, C.steel)];
  // chumbadores/base de concreto
  const base = [colorize(at(rbox(0.62, 0.12, 0.62, 0.03), 0, 0.06, 0), 0x8f8c86, 0.05)];
  // portinhola de inspeção
  if (!LO) metal.push(colorize(at(rbox(0.1, 0.36, 0.05, 0.012), 0, 0.85, 0.15), C.steelDark));
  const glow: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const [hx, hy] = LAMP_HEADS[s === 1 ? 0 : 1];
    // braço: sobe do topo do poste e se curva para fora
    metal.push(colorize(tube([
      new THREE.Vector3(0, H - 0.9, 0), new THREE.Vector3(s * 0.25, H - 0.1, 0), new THREE.Vector3(s * 1.0, H + 0.45, 0),
      new THREE.Vector3(s * 1.9, H + 0.35, 0), new THREE.Vector3(hx - s * 0.45, hy + 0.04, 0),
    ], 0.045, 12, 6), C.steel));
    // luminária: corpo achatado com chanfro, levemente inclinado
    metal.push(colorize(at(rbox(0.95, 0.13, 0.4, 0.05), hx, hy + 0.04, 0, 0, 0, s * -0.06), C.steelDark));
    metal.push(colorize(at(rbox(0.3, 0.09, 0.22, 0.03), hx - s * 0.5, hy + 0.06, 0, 0, 0, s * -0.06), C.steelDark));
    // lente (emissiva à noite)
    glow.push(at(rbox(0.78, 0.03, 0.3, 0.012), hx + s * 0.02, hy - 0.035, 0, 0, 0, s * -0.06));
  }
  return {
    parts: [
      { geo: merge(metal), mat: mats.painted, castShadow: true },
      { geo: merge(base), mat: mats.matte, castShadow: false },
      { geo: merge(glow.map((g) => { g.deleteAttribute('uv'); return g; })), mat: mats.lampGlow, castShadow: false },
    ],
  };
}

function signalModel(mats: PropMaterials): PropModel {
  // coluna semafórica com grupo focal de 3 lentes, pala (viseira) em cada foco e anteparo preto com borda
  const body = [
    colorize(lathe([[0, 0], [0.13, 0], [0.13, 0.04], [0.085, 0.07], [0.075, 0.3], [0.068, 3.0], [0.07, 3.02], [0, 3.05]], 8), C.signal),
    // braçadeiras
    colorize(at(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8), 0, 2.86, 0), C.steelDark),
    colorize(at(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8), 0, 3.72, 0), C.steelDark),
    // caixa do grupo focal
    colorize(at(rbox(0.36, 1.04, 0.26, 0.05), 0, 3.3, 0.17), C.signal),
    // anteparo (backplate) com borda branca retrorrefletiva
    colorize(at(rbox(0.6, 1.26, 0.025, 0.04), 0, 3.3, 0.03), C.black),
  ];
  // borda retrorrefletiva e botoeira de pedestre (só no detalhado)
  if (!LO) body.push(colorize(at(rbox(0.64, 1.3, 0.012, 0.045), 0, 3.3, 0.012), 0xd8d8d2), colorize(at(rbox(0.12, 0.2, 0.1, 0.02), 0, 1.15, 0.1), 0xd4b21c));
  for (let i = 0; i < (LO ? 0 : 3); i++) {
    // pala: meio cilindro aberto acima de cada lente
    const hood = new THREE.CylinderGeometry(0.135, 0.135, 0.2, 6, 1, true, -Math.PI / 2, Math.PI);
    body.push(colorize(at(hood, 0, 3.62 - i * 0.32, 0.4, -Math.PI / 2, 0, 0), C.signal));
  }
  // lentes (vermelho, amarelo, verde) — partes separadas, cor por instância conforme o ciclo (updateSignals)
  const lamp = (y: number) => {
    const g = new THREE.SphereGeometry(0.11, 10, 2, 0, Math.PI * 2, 0, Math.PI / 2.6);
    g.rotateX(Math.PI / 2);
    g.scale(1, 1, 0.35);
    g.translate(0, y, 0.3);
    return g;
  };
  return {
    parts: [
      { geo: merge(body), mat: mats.painted, castShadow: true },
      { geo: lamp(3.62), mat: mats.signalLamp, castShadow: false },
      { geo: lamp(3.3), mat: mats.signalLamp, castShadow: false },
      { geo: lamp(2.98), mat: mats.signalLamp, castShadow: false },
    ],
  };
}

function benchModel(mats: PropMaterials): PropModel {
  // banco de praça: ripas de madeira sobre laterais de ferro fundido (perfil extrudado com chanfro)
  const wood: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) wood.push(colorize(at(rbox(1.9, 0.04, 0.085, 0.015), 0, 0.45, 0.17 - i * 0.105), C.wood, 0.12, i));
  for (let i = 0; i < 3; i++) wood.push(colorize(at(rbox(1.9, 0.085, 0.035, 0.012), 0, 0.62 + i * 0.12, -0.22 - i * 0.025, -0.2), C.wood, 0.12, 9 + i));
  // lateral: pé dianteiro, assento, encosto inclinado e braço
  const side: [number, number][] = [
    [0.22, 0], [0.3, 0], [0.24, 0.42], [0.27, 0.62], [0.33, 0.66], [0.33, 0.7], [0.2, 0.7], [0.17, 0.44],
    [-0.2, 0.44], [-0.26, 0.92], [-0.31, 0.92], [-0.25, 0.42], [-0.24, 0], [-0.17, 0], [-0.17, 0.38], [0.18, 0.38],
  ];
  const iron: THREE.BufferGeometry[] = [];
  for (const x of [-0.82, 0.82]) {
    const g = extrude(side.map(([z, y]) => [z, y]), 0.05, 0.008);
    g.rotateY(-Math.PI / 2); // perfil (z, y) → plano ZY, frente do banco em +Z
    iron.push(colorize(at(g, x, 0, 0), C.black));
  }
  return {
    parts: [
      { geo: merge(wood), mat: mats.matte, castShadow: true },
      { geo: merge(iron), mat: mats.painted, castShadow: true },
    ],
  };
}

function busStopModel(mats: PropMaterials): PropModel {
  // abrigo de ônibus: estrutura de aço, cobertura curva, painéis de vidro, banco e painel publicitário iluminado
  const frame = C.steelDark;
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-1.95, 0, 1.95]) parts.push(colorize(at(rbox(0.09, 2.55, 0.09, 0.02), x, 1.275, -0.72), frame));
  // vigas da cobertura (em balanço para a frente)
  for (const x of [-1.95, 0, 1.95]) parts.push(colorize(tube([new THREE.Vector3(x, 2.5, -0.78), new THREE.Vector3(x, 2.62, 0), new THREE.Vector3(x, 2.58, 0.85)], 0.04, 6, 5), frame));
  // cobertura curva (chapa) com pingadeira
  const roofShape: [number, number][] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; roofShape.push([-0.85 + 1.75 * t, 2.62 + 0.08 * Math.sin(Math.PI * t)]); }
  for (let i = 8; i >= 0; i--) { const t = i / 8; roofShape.push([-0.85 + 1.75 * t, 2.66 + 0.08 * Math.sin(Math.PI * t)]); }
  const roof = extrude(roofShape, 4.3, 0.005);
  roof.rotateY(-Math.PI / 2);
  parts.push(colorize(roof, 0xb7bdc0));
  // banco perfurado (lâminas) e apoios
  parts.push(colorize(at(rbox(3.4, 0.04, 0.36, 0.015), 0, 0.48, -0.5), C.galv));
  for (const x of [-1.5, 1.5]) parts.push(colorize(at(rbox(0.05, 0.46, 0.3, 0.01), x, 0.24, -0.52), frame));
  // painel publicitário (MUPI) na lateral direita: caixa com moldura
  parts.push(colorize(at(rbox(1.3, 1.95, 0.14, 0.03), 2.6, 1.15, -0.3, 0, Math.PI / 2, 0), frame));
  // rodapé do vidro
  parts.push(colorize(at(rbox(3.9, 0.06, 0.05, 0.01), 0, 0.32, -0.74), frame));
  const ad = [colorize(at(new THREE.PlaneGeometry(1.15, 1.75), 2.6 + 0.075, 1.15, -0.3, 0, Math.PI / 2, 0), 0xf0e7d0)];
  const glass = [at(rbox(1.85, 1.95, 0.012, 0.004), -0.975, 1.33, -0.74), at(rbox(1.85, 1.95, 0.012, 0.004), 0.975, 1.33, -0.74)];
  return {
    parts: [
      { geo: merge(parts), mat: mats.painted, castShadow: true },
      { geo: merge(ad), mat: mats.lampGlow, castShadow: false },
      { geo: merge(glass.map((g) => { g.deleteAttribute('uv'); return g; })), mat: mats.glass, castShadow: false },
    ],
  };
}

function busPoleModel(mats: PropMaterials): PropModel {
  // poste de parada (sem abrigo): tubo galvanizado com placa azul "ÔNIBUS" chanfrada
  return {
    parts: [{
      geo: merge([
        colorize(lathe([[0, 0], [0.07, 0], [0.07, 0.03], [0.042, 0.06], [0.04, 2.95], [0, 2.97]], 8), C.galv),
        colorize(at(rbox(0.52, 0.66, 0.035, 0.03), 0, 2.55, 0.05), 0x1f4fa8),
        colorize(at(rbox(0.42, 0.16, 0.04, 0.012), 0, 2.67, 0.055), 0xf4f4f0),
        colorize(at(rbox(0.3, 0.22, 0.04, 0.012), 0, 2.42, 0.055), 0xf4f4f0),
      ]),
      mat: mats.metal, castShadow: true,
    }],
  };
}

function bollardModel(mats: PropMaterials): PropModel {
  // frade de ferro fundido com cabeça arredondada e anel
  const prof: [number, number][] = [[0, 0], [0.13, 0], [0.13, 0.05], [0.105, 0.09], [0.095, 0.62], [0.11, 0.66], [0.11, 0.7], [0.09, 0.72], [0.085, 0.8], [0.06, 0.86], [0.03, 0.885], [0, 0.89]];
  return { parts: [{ geo: merge([colorize(lathe(prof, 8), 0x2b2e30)]), mat: mats.painted, castShadow: true }] };
}

function wasteModel(mats: PropMaterials): PropModel {
  // "laranjinha" da Comlurb: cesto plástico afunilado com aro e tampa basculante, preso a um poste
  const body = lathe([[0.17, 0.42], [0.2, 0.44], [0.235, 0.98], [0.255, 1.0], [0.255, 1.04], [0.24, 1.05], [0.215, 0.99], [0.18, 0.47], [0, 0.46]], 12);
  const lid = lathe([[0, 1.1], [0.2, 1.1], [0.25, 1.06], [0.26, 1.045], [0, 1.045]], 12);
  return {
    parts: [
      { geo: merge([colorize(body, C.comlurb), colorize(lid, C.comlurbDark)]), mat: mats.plastic, castShadow: true },
      {
        geo: merge([
          colorize(at(new THREE.CylinderGeometry(0.035, 0.04, 1.2, 8), 0, 0.6, -0.29), C.galv),
          colorize(at(rbox(0.08, 0.5, 0.06, 0.015), 0, 0.8, -0.25), C.galv),
        ]), mat: mats.metal, castShadow: true,
      },
    ],
  };
}

function kioskModel(mats: PropMaterials): PropModel {
  // banca de jornal: caixa metálica com cobertura em balanço, letreiro, vitrines laterais abertas e revistas
  const parts = [
    colorize(at(rbox(3.0, 2.3, 2.0, 0.06), 0, 1.2, 0), C.kiosk),
    colorize(at(rbox(3.7, 0.12, 2.7, 0.04), 0, 2.48, 0.12, 0.03), 0x244a30),
    colorize(at(rbox(3.0, 0.38, 0.06, 0.02), 0, 2.2, 1.04), 0xf2efe6), // letreiro
    colorize(at(rbox(3.0, 0.08, 0.06, 0.02), 0, 2.0, 1.05), 0xd2a21c),
    colorize(at(rbox(3.04, 0.1, 2.04, 0.02), 0, 0.05, 0), 0x2b2e30), // rodapé
    // vitrine frontal (vão) e prateleiras
    colorize(at(rbox(2.5, 1.35, 0.04, 0.01), 0, 1.25, 1.0), LO ? 0x8a6a5a : 0x1f2a22),
  ];
  // revistas: pequenos retângulos coloridos em 3 prateleiras + abas laterais abertas
  const rnd = mulberry32(42);
  const pal = [0xd8402f, 0x2a6fc0, 0xf1c232, 0xffffff, 0x3a9b4a, 0xe07fb0, 0x222222, 0xf08a24];
  for (let row = 0; row < 3; row++) {
    parts.push(colorize(at(rbox(2.45, 0.025, 0.2, 0.005), 0, 0.72 + row * 0.42, 1.06), 0x8d8f8a));
    for (let i = 0; i < (LO ? 0 : 9); i++) {
      const c = pal[Math.floor(rnd() * pal.length)];
      parts.push(colorize(at(new THREE.BoxGeometry(0.2, 0.28, 0.012), -1.08 + i * 0.27, 0.88 + row * 0.42, 1.035, -0.12), c, 0.2, i + row * 9));
    }
  }
  for (const s of [1, -1]) {
    parts.push(colorize(at(rbox(0.04, 1.5, 0.9, 0.01), s * 1.53, 1.3, 1.35, 0, s * 0.5, 0), C.kiosk));
    for (let i = 0; i < (LO ? 0 : 4); i++) {
      const c = pal[Math.floor(rnd() * pal.length)];
      parts.push(colorize(at(new THREE.BoxGeometry(0.012, 0.28, 0.2), s * 1.555 + Math.sin(s * 0.5) * 0.02, 0.9 + (i % 2) * 0.42, 1.18 + Math.floor(i / 2) * 0.3, 0, s * 0.5, 0), c, 0.2, 50 + i));
    }
  }
  return { parts: [{ geo: merge(parts), mat: mats.painted, castShadow: true }] };
}

// ------------------------------------------------------------------------------------------
// Gerenciador de instâncias
// ------------------------------------------------------------------------------------------
type FurnitureKind = 'lamp' | 'signal' | 'bench' | 'bus_stop' | 'bus_pole' | 'bollard' | 'waste' | 'kiosk';
type ModelKey = FurnitureKind | `${FurnitureKind}_lo`;
const BUILDERS: Record<FurnitureKind, (m: PropMaterials) => PropModel> = {
  lamp: lampModel, signal: signalModel, bench: benchModel, bus_stop: busStopModel,
  bollard: bollardModel, bus_pole: busPoleModel, waste: wasteModel, kiosk: kioskModel,
};
/** versões distantes que ainda projetam sombra (as demais são pequenas demais para justificar o custo) */
const LO_SHADOW = new Set<FurnitureKind>(['lamp', 'bus_stop', 'kiosk']);

interface Inst { p: [number, number]; r: number; s: number; y: number; j?: number; ph?: number }

export class PropSystem {
  readonly group = new THREE.Group();
  private models = new Map<ModelKey, PropModel>();
  private meshes = new Map<ModelKey, THREE.InstancedMesh[]>();
  readonly mats: PropMaterials;
  private dummy = new THREE.Object3D();
  /** posições das luminárias ativas (para luzes reais próximas à noite) */
  private lampHeads: THREE.Vector3[] = [];
  /** semáforos instanciados: cruzamento e fase de cada instância */
  private signalInfo = new Map<ModelKey, { j: number; ph: number }[]>();
  /** mobiliário do último rebuild (o LOD perto/longe é refeito quando a câmera se afasta do centro) */
  private furniture: { kind: FurnitureKind; it: Inst }[] = [];
  private lodCenter: THREE.Vector3 | null = null;
  private lastCam: THREE.Vector3 | null = null;
  private nightLights: THREE.PointLight[] = [];
  /** árvores/palmeiras (sistema próprio com LOD e impostores) */
  veg?: VegetationSystem;
  private pendingTrees: { rec: PropRec; y: number }[] | null = null;

  constructor(noise: THREE.Texture) {
    this.group.name = 'props';
    this.mats = createPropMaterials(noise);
    for (const [kind, build] of Object.entries(BUILDERS) as [FurnitureKind, (m: PropMaterials) => PropModel][]) {
      this.models.set(kind, build(this.mats));
      LO = true;
      const lo = build(this.mats);
      LO = false;
      for (const p of lo.parts) p.castShadow &&= LO_SHADOW.has(kind);
      this.models.set(`${kind}_lo`, lo);
    }
    // pool fixo de luzes pontuais (sempre presentes → sem recompilar shaders ao anoitecer)
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 30, 1.6);
      l.castShadow = false;
      this.nightLights.push(l);
      this.group.add(l);
    }
  }

  /** Atualiza as lâmpadas dos semáforos conforme o estado de cada cruzamento. */
  updateSignals(stateOf: (j: number, ph: number) => 'G' | 'Y' | 'R') {
    for (const key of ['signal', 'signal_lo'] as const) this.updateSignalMeshes(key, stateOf);
  }

  private updateSignalMeshes(key: ModelKey, stateOf: (j: number, ph: number) => 'G' | 'Y' | 'R') {
    const meshes = this.meshes.get(key);
    const info = this.signalInfo.get(key);
    if (!meshes || meshes.length < 4 || !info) return;
    const [, red, yellow, green] = meshes;
    for (const m of [red, yellow, green]) if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
    const on = { R: [1, 0.06, 0.03], Y: [1, 0.62, 0.02], G: [0.1, 1, 0.5] } as const;
    const off = [0.035, 0.03, 0.028];
    for (let i = 0; i < info.length; i++) {
      const si = info[i];
      const st = si.j < 0 ? 'G' : stateOf(si.j, si.ph);
      const set = (m: THREE.InstancedMesh, active: boolean, c: readonly number[]) => {
        const v = active ? c : off;
        m.instanceColor!.setXYZ(i, v[0], v[1], v[2]);
      };
      set(red, st === 'R', on.R);
      set(yellow, st === 'Y', on.Y);
      set(green, st === 'G', on.G);
    }
    for (const m of [red, yellow, green]) m.instanceColor!.needsUpdate = true;
  }

  /** À noite: acende as luminárias (emissivo) e posiciona luzes reais nos postes mais próximos. */
  updateNightLights(cam: THREE.Vector3, night: number) {
    this.mats.lampGlow.emissiveIntensity = 0.15 + night * 9;
    this.mats.signalLights.emissiveIntensity = 0.15 + night * 2.5;
    if (night < 0.05) {
      for (const l of this.nightLights) l.intensity = 0;
      return;
    }
    const sorted = this.lampHeads
      .map((p) => ({ p, d: p.distanceToSquared(cam) }))
      .sort((a, b) => a.d - b.d);
    this.nightLights.forEach((l, i) => {
      const it = sorted[i];
      if (!it) { l.intensity = 0; return; }
      l.position.copy(it.p);
      l.intensity = 260 * night;
    });
  }

  /**
   * Carrega a vegetação pré-gerada (public/vegetation/) e renderiza os impostores.
   * Falha de rede não derruba o jogo: o mundo segue sem árvores (aviso no console).
   */
  async loadVegetation(renderer: THREE.WebGLRenderer, vegetationDensity: number, baseUrl = `${import.meta.env.BASE_URL}vegetation/`) {
    try {
      const assets = await loadVegetation(baseUrl);
      this.veg = new VegetationSystem(renderer, assets, this.mats.windUniform, vegetationOptionsFor(vegetationDensity));
      this.group.add(this.veg.group);
      if (this.pendingTrees) this.veg.setTrees(this.treeInstances(this.pendingTrees));
    } catch (e) {
      console.warn('vegetação indisponível:', e);
    }
  }

  private treeInstances(list: { rec: PropRec; y: number }[]): TreeInstance[] {
    const veg = this.veg!;
    return list.map(({ rec, y }) => {
      const [x, z] = rec.p;
      const species = rec.k === 'palm' ? 'palmeira' : speciesAt(x, z);
      const h = Math.abs(Math.sin(x * 4.231 + z * 9.137) * 43758.5453) % 1;
      return {
        x, y, z,
        rot: h * Math.PI * 2,
        scale: (rec.s ?? 1) * (0.88 + 0.24 * ((h * 7.31) % 1)),
        variant: veg.variantFor(species, x, z),
      };
    });
  }

  /**
   * Reconstrói as instâncias a partir dos props dos chunks ativos.
   * near: mobiliário em detalhe + árvores; far: somente árvores (o LOD das árvores é por distância,
   * decidido a cada passo da câmera em VegetationSystem — perto/médio/impostor).
   */
  rebuild(near: PropRec[], far: PropRec[], _vegetationDensity: number, heightAt: (x: number, z: number) => number) {
    const trees: { rec: PropRec; y: number }[] = [];
    this.furniture = [];
    for (const rec of near) {
      if (rec.k === 'tree' || rec.k === 'palm') trees.push({ rec, y: heightAt(rec.p[0], rec.p[1]) });
      else this.furniture.push({ kind: rec.k as FurnitureKind, it: { p: rec.p, r: rec.r ?? 0, s: rec.s ?? 1, y: heightAt(rec.p[0], rec.p[1]), j: rec.j, ph: rec.ph } });
    }
    for (const rec of far) if (rec.k === 'tree' || rec.k === 'palm') trees.push({ rec, y: heightAt(rec.p[0], rec.p[1]) });
    this.pendingTrees = trees;
    if (this.veg) this.veg.setTrees(this.treeInstances(trees));
    this.fillFurniture(this.lastCam);
  }

  /** distribui o mobiliário entre os modelos detalhado/distante conforme a distância a `center` */
  private fillFurniture(center: THREE.Vector3 | null) {
    this.lodCenter = center ? center.clone() : null;
    const d2 = PROP_LOD_DIST * PROP_LOD_DIST;
    const buckets = new Map<ModelKey, Inst[]>();
    for (const { kind, it } of this.furniture) {
      const far = center !== null && (it.p[0] - center.x) ** 2 + (it.p[1] - center.z) ** 2 > d2;
      const key: ModelKey = far ? `${kind}_lo` : kind;
      const arr = buckets.get(key) ?? [];
      arr.push(it);
      buckets.set(key, arr);
    }
    this.lampHeads = [];
    for (const [key, model] of this.models) {
      const list = buckets.get(key) ?? [];
      let meshes = this.meshes.get(key);
      const cap = meshes?.[0]?.instanceMatrix.count ?? 0;
      if (!meshes || cap < list.length) {
        meshes?.forEach((m) => { this.group.remove(m); m.dispose(); });
        const capacity = Math.max(16, Math.ceil(list.length * 1.3));
        meshes = model.parts.map((p) => {
          const m = new THREE.InstancedMesh(p.geo, p.mat, capacity);
          m.castShadow = p.castShadow;
          m.receiveShadow = true;
          m.frustumCulled = false; // instâncias espalhadas; bounding recalculado abaixo
          m.name = `props_${key}`;
          this.group.add(m);
          return m;
        });
        this.meshes.set(key, meshes);
      }
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        this.dummy.position.set(it.p[0], it.y, it.p[1]);
        // r = direção (no plano XZ) para onde o +Z do modelo aponta
        this.dummy.rotation.set(0, Math.atan2(Math.cos(it.r), Math.sin(it.r)), 0);
        this.dummy.scale.setScalar(it.s);
        this.dummy.updateMatrix();
        for (const m of meshes) m.setMatrixAt(i, this.dummy.matrix);
      }
      if (key === 'signal' || key === 'signal_lo') this.signalInfo.set(key, list.map((it) => ({ j: it.j ?? -1, ph: it.ph ?? 0 })));
      if (key === 'lamp' || key === 'lamp_lo') {
        for (const it of list) {
          // as duas luminárias ficam no eixo X local do modelo (LAMP_HEADS)
          const ang = Math.atan2(Math.cos(it.r), Math.sin(it.r));
          for (const [hx, hy] of LAMP_HEADS) {
            this.lampHeads.push(new THREE.Vector3(it.p[0] + Math.cos(ang) * hx, it.y + hy - 0.3, it.p[1] - Math.sin(ang) * hx));
          }
        }
      }
      for (const m of meshes) {
        m.count = list.length;
        m.instanceMatrix.needsUpdate = true;
        m.visible = list.length > 0;
        if (list.length) { m.computeBoundingSphere(); m.frustumCulled = true; }
      }
    }
  }

  update(time: number, camera?: THREE.Vector3) {
    this.mats.windUniform.value = time;
    if (!camera) return;
    (this.lastCam ??= new THREE.Vector3()).copy(camera);
    if (!this.lodCenter || this.lodCenter.distanceToSquared(camera) > 35 * 35) this.fillFurniture(camera);
    this.veg?.update(camera);
  }

  get instanceCount() {
    let n = 0;
    for (const ms of this.meshes.values()) n += ms[0]?.count ?? 0;
    return n + (this.pendingTrees?.length ?? 0);
  }
}

export const PROP_BASE_Y = CURB_HEIGHT;
