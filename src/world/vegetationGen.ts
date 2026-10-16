/**
 * Geração procedural das árvores do Centro do Rio com o ez-tree (MIT, Daniel Greenheck —
 * https://github.com/dgreenheck/ez-tree), feita UMA vez no carregamento (~10 variantes, sem download de malhas).
 *
 * Espécies (censo de arborização viária do Centro — ver docs/VEGETATION.md):
 *   oiti (Licania tomentosa) · amendoeira (Terminalia catappa) · cássia-siamesa (Senna siamea)
 *   ficus (Ficus spp.) · munguba (Pachira aquatica) · ipê-amarelo (Handroanthus) · palmeira-imperial (Roystonea)
 * Cada variante sai com 2 LODs de malha: 0 = perto (completa), 1 = média (tronco + galhos principais e
 * ~1/4 dos cartões de folha, ampliados). O LOD distante (impostor) é renderizado depois, em vegetation.ts.
 *
 * Observação: o import '@dgreenheck/ez-tree' é redirecionado (vite.config.ts) para o código-fonte do pacote,
 * sem o módulo de texturas (o build publicado embute ~4 MB de imagens em base64 que não usamos).
 */
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

export interface VegGeo { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry }
export interface VegVariant { name: string; species: string; height: number; radius: number; lods: VegGeo[] }

// células do atlas de folhas (tools/vegetation/make_textures.py)
const CELL = { small: 0, broad: 1, ipe: 2, frond: 3 } as const;
// metade do atlas de casca: 0 = plátano (casca genérica cinza-amarronzada), 1 = palmeira
const BARK = { generic: 0, palm: 1 } as const;

type V3 = [number, number, number];
interface SpeciesParams {
  angle: V3; children: V3; gnarl: number[]; length: number[]; radius: number[]; sections: number[]; segments: number[];
  start: V3; force?: number; leafCount: number; leafSize: number; leafAngle?: number; leafStart?: number; leafVar?: number;
  type?: 'deciduous' | 'evergreen'; levels?: number; taper?: number[]; twist?: number[];
}
interface Species {
  name: string; cell: number; barkCell: number; seeds: number[]; heights: number[];
  leafTint: V3; barkTint: V3; midKeep: number; clear?: number; o: SpeciesParams;
}

// ------------------------------------------------------------------------------------------
// espécies — parâmetros do ez-tree (unidades arbitrárias; a árvore é reescalada para `heights`)
// ------------------------------------------------------------------------------------------
export const SPECIES: Species[] = [
  {
    // copa densa, arredondada, verde-escura; tronco curto que se abre em pernadas
    name: 'oiti', cell: CELL.small, barkCell: BARK.generic, seeds: [11, 23, 37], heights: [8.5, 9.5, 7.5],
    leafTint: [0.62, 0.78, 0.55], barkTint: [1, 0.96, 0.92], midKeep: 0.28,
    o: {
      angle: [52, 48, 40], children: [6, 4, 3], gnarl: [0.06, 0.18, 0.25, 0.1],
      length: [7, 9, 5, 2.4], radius: [1.1, 0.62, 0.62, 0.6], sections: [6, 4, 2, 1], segments: [9, 6, 3, 3],
      start: [0.62, 0.3, 0.2], force: 0.02, leafCount: 7, leafSize: 3.3, leafAngle: 35, leafStart: 0.1,
    },
  },
  {
    // pernadas horizontais em verticilos (copa em "andares"), folhas grandes nas pontas
    name: 'amendoeira', cell: CELL.broad, barkCell: BARK.generic, seeds: [5, 71], heights: [11, 9.5],
    leafTint: [0.72, 0.82, 0.62], barkTint: [1, 0.98, 0.95], midKeep: 0.3, clear: 3.0,
    o: {
      type: 'evergreen', levels: 2,
      angle: [84, 30, 30], children: [12, 6, 0], gnarl: [0.02, 0.05, 0.1, 0.1],
      length: [30, 30, 6, 2], radius: [1.0, 0.45, 0.6, 0.6], sections: [12, 6, 2, 2], segments: [9, 5, 3, 3],
      start: [0.3, 0.3, 0.2], force: -0.002, leafCount: 7, leafSize: 4.2, leafAngle: 70, leafStart: 0.2,
      twist: [0.6, 0, 0, 0],
    },
  },
  {
    // copa arredondada mais aberta e clara, folhagem fina (pinada)
    name: 'cassia', cell: CELL.small, barkCell: BARK.generic, seeds: [91], heights: [9],
    leafTint: [0.80, 0.92, 0.62], barkTint: [0.95, 0.9, 0.86], midKeep: 0.3,
    o: {
      angle: [42, 50, 45], children: [5, 4, 3], gnarl: [0.08, 0.22, 0.3, 0.1],
      length: [8, 9, 5, 2.4], radius: [0.9, 0.6, 0.6, 0.6], sections: [6, 4, 2, 1], segments: [8, 6, 3, 3],
      start: [0.55, 0.35, 0.2], force: 0.03, leafCount: 6, leafSize: 3.2, leafAngle: 45, leafStart: 0.15,
    },
  },
  {
    // grande, tronco grosso e claro, copa larga muito densa e escura
    name: 'ficus', cell: CELL.small, barkCell: BARK.generic, seeds: [303], heights: [13],
    leafTint: [0.50, 0.66, 0.46], barkTint: [1, 1, 0.98], midKeep: 0.25, clear: 3.2,
    o: {
      angle: [46, 50, 45], children: [7, 4, 3], gnarl: [0.04, 0.15, 0.22, 0.1],
      length: [7, 6.5, 5, 2.6], radius: [1.6, 0.6, 0.6, 0.6], sections: [6, 5, 2, 1], segments: [11, 6, 4, 3],
      start: [0.5, 0.25, 0.2], force: 0.0, leafCount: 7, leafSize: 3.6, leafAngle: 35, leafStart: 0.05,
    },
  },
  {
    // tronco reto esverdeado, galhos ascendentes, folhas palmadas grandes
    name: 'munguba', cell: CELL.broad, barkCell: BARK.generic, seeds: [404], heights: [10],
    leafTint: [0.70, 0.86, 0.58], barkTint: [0.9, 1, 0.82], midKeep: 0.3,
    o: {
      angle: [38, 45, 40], children: [5, 3, 3], gnarl: [0.03, 0.12, 0.2, 0.1],
      length: [12, 8, 4, 2], radius: [0.9, 0.55, 0.6, 0.6], sections: [8, 4, 2, 1], segments: [8, 5, 3, 3],
      start: [0.6, 0.3, 0.2], force: 0.04, leafCount: 6, leafSize: 3.0, leafAngle: 50, leafStart: 0.3,
    },
  },
  {
    // ipê-amarelo florido: copa irregular e aberta
    name: 'ipe', cell: CELL.ipe, barkCell: BARK.generic, seeds: [505], heights: [9],
    leafTint: [1.0, 0.86, 0.42], barkTint: [0.85, 0.8, 0.76], midKeep: 0.3,
    o: {
      angle: [40, 55, 45], children: [4, 4, 3], gnarl: [0.1, 0.25, 0.3, 0.1],
      length: [8, 8, 5, 2], radius: [0.8, 0.6, 0.6, 0.6], sections: [6, 4, 2, 1], segments: [8, 5, 3, 3],
      start: [0.55, 0.3, 0.2], force: 0.03, leafCount: 5, leafSize: 3.0, leafAngle: 45, leafStart: 0.3,
    },
  },
];

function options(seed: number, o: SpeciesParams) {
  const lv = (a: number[]) => ({ 0: a[0], 1: a[1], 2: a[2], 3: a[3] ?? a[2] });
  return {
    seed,
    type: o.type ?? 'deciduous',
    bark: { type: 'oak', tint: 0xffffff, flatShading: false, textured: false, textureScale: { x: 1, y: 1 } },
    branch: {
      levels: o.levels ?? 3,
      angle: { 1: o.angle[0], 2: o.angle[1], 3: o.angle[2] },
      children: { 0: o.children[0], 1: o.children[1], 2: o.children[2] },
      force: { direction: { x: 0, y: 1, z: 0 }, strength: o.force ?? 0.01 },
      gnarliness: lv(o.gnarl), length: lv(o.length), radius: lv(o.radius), sections: lv(o.sections), segments: lv(o.segments),
      start: { 1: o.start[0], 2: o.start[1], 3: o.start[2] },
      taper: lv(o.taper ?? [0.7, 0.7, 0.7, 0.7]), twist: lv(o.twist ?? [0, 0, 0, 0]),
    },
    leaves: {
      type: 'oak', billboard: 'double', angle: o.leafAngle ?? 40, count: o.leafCount,
      start: o.leafStart ?? 0, size: o.leafSize, sizeVariance: o.leafVar ?? 0.4, tint: 0xffffff, alphaTest: 0.5,
    },
    trellis: { enabled: false },
  };
}

// ------------------------------------------------------------------------------------------
// ez-tree com rastreio de galhos (nível, parentesco) e de folhas — necessário para a poda e o LOD médio
// ------------------------------------------------------------------------------------------
interface BranchRange { level: number; i0: number; i1: number; baseY: number; parent: BranchRange | null; drop?: boolean }
interface LeafRange { v0: number; v1: number; origin: THREE.Vector3; branch: BranchRange | null }

class TrackedTree extends Tree {
  branchRanges: BranchRange[] = [];
  leafRanges: LeafRange[] = [];
  private cur: BranchRange | null = null;

  generate() {
    this.branchRanges = [];
    this.leafRanges = [];
    super.generate();
  }

  generateBranch(branch: Parameters<Tree['generateBranch']>[0]) {
    const b = branch as typeof branch & { __range?: BranchRange };
    const range: BranchRange = { level: b.level, i0: this.branches.indices.length, i1: 0, baseY: b.origin.y, parent: b.__range ?? null };
    const q0 = this.branchQueue.length;
    this.cur = range;
    super.generateBranch(branch);
    range.i1 = this.branches.indices.length;
    // filhos (e o galho terminal) entram no fim da fila durante a chamada acima
    for (let i = q0; i < this.branchQueue.length; i++) (this.branchQueue[i] as typeof b).__range = range;
    this.branchRanges.push(range);
  }

  generateLeaf(origin: THREE.Vector3, orientation: THREE.Euler) {
    const v0 = this.leaves.verts.length / 3;
    super.generateLeaf(origin, orientation);
    this.leafRanges.push({ v0, v1: this.leaves.verts.length / 3, origin: origin.clone(), branch: this.cur });
  }
}

// ------------------------------------------------------------------------------------------
// conversão para a geometria do jogo
// ------------------------------------------------------------------------------------------
class Geo {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; idx: number[] = [];
  get vc() { return this.p.length / 3; }
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: number[]) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(c[0], c[1], c[2]);
    return this.vc - 1;
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const col = new Uint8Array(this.vc * 3);
    for (let i = 0; i < this.c.length; i++) col[i] = Math.round(clamp01(this.c[i]) * 255);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const cellUV = (cell: number, u: number, v: number): [number, number] => {
  const e = 0.003; // margem contra sangramento entre células
  const cx = cell % 2, row = Math.floor(cell / 2);
  return [cx * 0.5 + e + clamp01(u) * (0.5 - 2 * e), (1 - row) * 0.5 + e + clamp01(v) * (0.5 - 2 * e)];
};
const barkU = (half: number, u: number) => half * 0.5 + 0.004 + clamp01(u) * 0.492;

function mulberry(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** converte a árvore do ez-tree em geometria (escalada para `height`) — lod 0 (perto) ou 1 (médio) */
function convertTree(tree: TrackedTree, sp: Species, height: number, lod: 0 | 1) {
  const B = tree.branches, L = tree.leaves;
  const clear = sp.clear ?? 2.6; // poda urbana: copa acima da passagem de pedestres/ônibus
  let maxY = 0;
  for (let i = 1; i < B.verts.length; i += 3) maxY = Math.max(maxY, B.verts[i]);
  for (let i = 1; i < L.verts.length; i += 3) maxY = Math.max(maxY, L.verts[i]);
  const k = height / maxY;
  const crown = new THREE.Box3();
  const tmp = new THREE.Vector3();
  for (let i = 0; i < L.verts.length; i += 3) {
    tmp.set(L.verts[i], L.verts[i + 1], L.verts[i + 2]).multiplyScalar(k);
    if (tmp.y > clear) crown.expandByPoint(tmp);
  }
  const cc = crown.getCenter(new THREE.Vector3());
  const cr = crown.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const occl = (p: THREE.Vector3) => {
    // posição normalizada no elipsoide da copa → oclusão (dentro/embaixo = mais escuro) e normal "volumétrica"
    const q = new THREE.Vector3((p.x - cc.x) / cr.x, (p.y - cc.y) / cr.y, (p.z - cc.z) / cr.z);
    const d = clamp01(q.length());
    const h = clamp01((p.y - crown.min.y) / (2 * cr.y));
    return { ao: 0.32 + 0.68 * (0.35 * d + 0.65 * d * d) * (0.7 + 0.3 * h), dir: q.normalize() };
  };
  const dropped = (r: BranchRange | null): boolean => {
    if (!r) return false;
    if (r.drop === undefined) r.drop = dropped(r.parent) || (r.level >= 2 && r.baseY * k < clear);
    return r.drop;
  };

  // ---------- casca ----------
  const bark = new Geo();
  const remap = new Map<number, number>();
  const maxLevel = lod === 0 ? 99 : 1;
  for (const r of tree.branchRanges) {
    if (r.level > maxLevel || dropped(r)) continue;
    for (let i = r.i0; i < r.i1; i++) {
      const s = B.indices[i];
      let d = remap.get(s);
      if (d === undefined) {
        const p = new THREE.Vector3(B.verts[s * 3], B.verts[s * 3 + 1], B.verts[s * 3 + 2]).multiplyScalar(k);
        const n = new THREE.Vector3(B.normals[s * 3], B.normals[s * 3 + 1], B.normals[s * 3 + 2]);
        const ao = Math.min(1, 0.25 + (p.y > crown.min.y ? occl(p).ao : 1));
        d = bark.vert(p, n, barkU(sp.barkCell, B.uvs[s * 2]), B.uvs[s * 2 + 1], sp.barkTint.map((x) => x * ao));
        remap.set(s, d);
      }
      bark.idx.push(d);
    }
  }

  // ---------- folhas ----------
  const leaves = new Geo();
  const rnd = mulberry(sp.seeds[0] * 7 + lod);
  const keep = lod === 0 ? 1 : sp.midKeep;
  const grow = lod === 0 ? 1 : (1 / Math.sqrt(keep)) * 0.92;
  const up = new THREE.Vector3(0, 0.35, 0);
  for (const r of tree.leafRanges) {
    if (lod > 0 && rnd() > keep) continue;
    if (dropped(r.branch) || r.origin.y * k < clear) continue;
    const o = r.origin.clone().multiplyScalar(k);
    const tint = 0.85 + rnd() * 0.3;
    const quads = (r.v1 - r.v0) / 4;
    for (let qi = 0; qi < quads; qi++) {
      const base = leaves.vc;
      for (let j = 0; j < 4; j++) {
        const s = r.v0 + qi * 4 + j;
        const p = new THREE.Vector3(L.verts[s * 3], L.verts[s * 3 + 1], L.verts[s * 3 + 2]).multiplyScalar(k);
        p.sub(o).multiplyScalar(grow).add(o);
        const { ao, dir } = occl(p);
        const n = dir.multiplyScalar(0.85).add(up).normalize();
        const [u, v] = cellUV(sp.cell, L.uvs[s * 2], L.uvs[s * 2 + 1]);
        leaves.vert(p, n, u, v, sp.leafTint.map((x, ci) => x * ao * (ci === 1 ? tint : 1)));
      }
      leaves.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { bark, leaves, radius: Math.max(cr.x, cr.z) + Math.hypot(cc.x, cc.z) };
}

// ------------------------------------------------------------------------------------------
// palmeira-imperial (Roystonea oleracea): procedural próprio (estipe liso anelado, palmito verde, folhas arqueadas)
// ------------------------------------------------------------------------------------------
function palm(lod: 0 | 1) {
  const bark = new Geo(), leaves = new Geo();
  const H = 14; // estipe até o palmito
  const rings = lod === 0 ? 14 : 6, seg = lod === 0 ? 12 : 6;
  const radiusAt = (t: number) => 0.27 * (1 + 0.18 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.12 * t) + (t < 0.04 ? 0.08 * (1 - t / 0.04) : 0);
  const shaft = 2.2; // palmito (bainha verde)
  const tot = H + shaft;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, y = t * tot;
    const isShaft = y > H;
    const r = isShaft ? 0.24 * (1 - 0.25 * ((y - H) / shaft)) : radiusAt(y / H);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const n = new THREE.Vector3(Math.cos(a), 0.05, Math.sin(a)).normalize();
      bark.vert(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), n, barkU(BARK.palm, j / seg), y / 2.5, isShaft ? [0.42, 0.55, 0.30] : [0.86, 0.85, 0.82]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    bark.idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // folhas: faixas arqueadas com dobra em V (2 quads por segmento)
  const rnd = mulberry(77 + lod);
  const fronds = lod === 0 ? 15 : 9, segs = lod === 0 ? 7 : 4;
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + rnd() * 0.3;
    const len = 4.4 + rnd() * 0.8;
    const lift = 0.25 + (f % 3) * 0.28 + rnd() * 0.2; // ângulo inicial acima da horizontal
    const width = 1.9;
    const dirH = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
    const side = new THREE.Vector3(-dirH.z, 0, dirH.x);
    const pts: { p: THREE.Vector3; ang: number }[] = [];
    const p = new THREE.Vector3(0, tot - 0.2, 0);
    let ang = lift;
    for (let s = 0; s <= segs; s++) {
      pts.push({ p: p.clone(), ang });
      const step = len / segs;
      p.add(dirH.clone().multiplyScalar(Math.cos(ang) * step)).add(new THREE.Vector3(0, Math.sin(ang) * step, 0));
      ang -= 0.32 + rnd() * 0.08; // arqueia para baixo
    }
    const start = leaves.vc;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const { p: c, ang: a } = pts[s];
      const upv = new THREE.Vector3(-Math.sin(a) * dirH.x, Math.cos(a), -Math.sin(a) * dirH.z);
      const w = width * 0.5 * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.2 + t)));
      const fold = 0.28 * w; // folíolos em V
      const ao = 0.55 + 0.45 * t;
      const n = upv.multiplyScalar(0.8).add(dirH.clone().multiplyScalar(0.4)).normalize();
      for (const sx of [-1, 0, 1]) {
        const q = c.clone().add(side.clone().multiplyScalar(sx * w)).add(new THREE.Vector3(0, sx === 0 ? 0 : -fold, 0));
        const [u, v] = cellUV(CELL.frond, 0.5 + sx * 0.5, t);
        leaves.vert(q, n, u, v, [0.78 * ao, 0.86 * ao, 0.7 * ao]);
      }
    }
    for (let s = 0; s < segs; s++) for (let x = 0; x < 2; x++) {
      const a = start + s * 3 + x, b = a + 3;
      leaves.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { bark, leaves, radius: 5 };
}

/** gera todas as variantes (determinístico). `onVariant` permite ceder o thread entre variantes. */
export async function generateVegetation(onVariant?: (i: number, total: number) => Promise<void> | void): Promise<VegVariant[]> {
  const out: VegVariant[] = [];
  const total = SPECIES.reduce((n, s) => n + s.seeds.length, 0) + 1;
  for (const sp of SPECIES) {
    for (let vi = 0; vi < sp.seeds.length; vi++) {
      const tree = new TrackedTree();
      tree.options.copy(options(sp.seeds[vi], sp.o) as unknown as typeof tree.options);
      tree.generate();
      const l0 = convertTree(tree, sp, sp.heights[vi], 0), l1 = convertTree(tree, sp, sp.heights[vi], 1);
      // libera a geometria interna do ez-tree (não é usada)
      tree.branchesMesh.geometry.dispose();
      tree.leavesMesh.geometry.dispose();
      out.push({
        name: `${sp.name}_${vi}`, species: sp.name, height: sp.heights[vi], radius: l0.radius,
        lods: [l0, l1].map((l) => ({ bark: l.bark.build(), leaves: l.leaves.build() })),
      });
      await onVariant?.(out.length, total);
    }
  }
  const p0 = palm(0), p1 = palm(1);
  out.push({ name: 'palmeira_0', species: 'palmeira', height: 18, radius: 5, lods: [p0, p1].map((l) => ({ bark: l.bark.build(), leaves: l.leaves.build() })) });
  await onVariant?.(out.length, total);
  return out;
}
