/**
 * Edifícios de RECONHECIMENTO (rodada 6): prédios que não são landmarks "heróis", mas cuja silhueta e
 * fachada ajudam a reconhecer cada trecho da Pres. Vargas (ver docs/RECOGNITION_BUILDINGS.md).
 *
 * Kit enxuto sobre o ArchBuilder (mesmos materiais compartilhados dos landmarks — nenhuma textura por
 * edifício):
 *  - janelas como placas (2 triângulos) sobre a massa extrudada do contorno OSM — barato;
 *  - térreo em galeria (padrão PA) coerente com a colisão: usa `arcadeSpans` (mesma função do cliente
 *    e do servidor) para recuar a parede e posicionar as colunas;
 *  - três níveis: detalhe (≤ DETAIL_DIST: aparelhos de ar-condicionado, montantes), corpo (≤ FAR_DIST) e
 *    LOD distante (massa + faixas de janela por pavimento, poucas centenas de triângulos).
 */
import * as THREE from 'three';
import type { BuildingRec, XZ } from '../types';
import { arcadeSpans, type ArcadeSpan } from '../arcades';
import { ArchBuilder, type ArchMat } from './arch';
import type { LandmarkInstance } from './central';

/** além disso o corpo dá lugar ao LOD distante */
export const RECOG_FAR_DIST = 460;
/** além disso o tier de detalhe (ar-condicionado, montantes) some */
export const RECOG_DETAIL_DIST = 170;

/** anel sem pontos repetidos consecutivos (ExtrudeGeometry não gosta de arestas nulas) */
export function cleanRing(ring: XZ[]): XZ[] {
  const out: XZ[] = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

export function centroidOf(ring: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

/** semente determinística 0..1 a partir do id OSM */
export function hash01(n: number): number {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Anel do térreo com as arestas de galeria recuadas exatamente como a colisão (a → ai = a − n·depth).
 * Vértices compartilhados por duas galerias recebem os dois recuos.
 */
export function arcadeInsetRing(ring: XZ[], spans: ArcadeSpan[]): XZ[] {
  return ring.map((p, i) => {
    let x = p[0], z = p[1];
    for (const sp of spans) {
      if (sp.a === p || sp.c === p || (sp.a[0] === p[0] && sp.a[1] === p[1]) || (sp.c[0] === p[0] && sp.c[1] === p[1])) {
        x -= sp.n[0] * sp.depth;
        z -= sp.n[1] * sp.depth;
      }
    }
    void i;
    return [x, z] as XZ;
  });
}

export type ColumnShape = 'round' | 'square' | 'tapered' | 'pilotis';

export interface MassOpts {
  wall: THREE.ColorRepresentation;
  wallMat?: ArchMat;
  /** cor das colunas da galeria */
  column?: THREE.ColorRepresentation;
  columnMat?: ArchMat;
  columnShape?: ColumnShape;
  /** raio (ou meia largura) da coluna */
  columnR?: number;
  /** vitrine no fundo da galeria */
  storefront?: THREE.ColorRepresentation;
}

/**
 * Massa principal com galeria no térreo (se houver arcadeEdges): térreo recuado + corpo do pavimento
 * da galeria até `top`. Retorna a altura do teto da galeria (0 se não houver).
 */
export function massWithArcade(ab: ArchBuilder, b: BuildingRec, ring: XZ[], top: number, o: MassOpts): number {
  const spans = arcadeSpans(b);
  const wm = o.wallMat ?? 'stone';
  if (!spans.length) {
    ab.prism(ring, 0, top, o.wall, wm);
    return 0;
  }
  const hA = Math.max(...spans.map((s) => s.height));
  const inset = cleanRing(arcadeInsetRing(b.poly.outer, spans));
  ab.prism(inset, 0, hA, o.wall, wm);
  ab.prism(ring, hA, top, o.wall, wm);
  const colC = o.column ?? o.wall;
  const colM = o.columnMat ?? wm;
  const r = o.columnR ?? 0.36;
  for (const sp of spans) {
    for (const c of sp.columns) {
      const shape = o.columnShape ?? 'square';
      if (shape === 'round') ab.cyl(r, r, sp.height, c[0], 0, c[1], colC, 12, colM);
      else if (shape === 'tapered') ab.cyl(r * 1.45, r * 0.8, sp.height, c[0], 0, c[1], colC, 12, colM);
      else if (shape === 'pilotis') ab.cyl(r * 0.85, r * 1.2, sp.height, c[0], 0, c[1], colC, 10, colM);
      else ab.add(new THREE.BoxGeometry(r * 2, sp.height, r * 2).rotateY(-Math.atan2(sp.n[1], sp.n[0])).translate(c[0], sp.height / 2, c[1]), colC, colM);
    }
    // vitrine no fundo da galeria (entre ai e ci, um pouco à frente da parede recuada)
    if (o.storefront !== undefined) {
      const len = Math.hypot(sp.ci[0] - sp.ai[0], sp.ci[1] - sp.ai[1]);
      const ang = Math.atan2(sp.ci[1] - sp.ai[1], sp.ci[0] - sp.ai[0]);
      const g = new THREE.PlaneGeometry(Math.max(0.5, len - 1.2), sp.height - 1.6);
      // normal da placa = +Z local; girar para apontar para fora (n)
      g.rotateY(Math.atan2(sp.n[0], sp.n[1]));
      g.translate((sp.ai[0] + sp.ci[0]) / 2 + sp.n[0] * 0.04, 0.3 + (sp.height - 1.6) / 2, (sp.ai[1] + sp.ci[1]) / 2 + sp.n[1] * 0.04);
      void ang;
      ab.add(g, o.storefront, 'glass', 0.05);
    }
    // forro escuro da galeria (pequeno recuo à sombra)
  }
  return hA;
}

export interface WindowsOpts {
  x0: number; x1: number;
  y0: number; floors: number; floorH: number;
  bay: number; winW: number; winH: number; sill: number;
  glass: THREE.ColorRepresentation;
  /** chance de janela "fechada" (persiana/cortina clara) */
  blinds?: number;
  blindColor?: THREE.ColorRepresentation;
  /** aparelhos de ar-condicionado (tier de detalhe) sob parte das janelas */
  ac?: number;
  acColor?: THREE.ColorRepresentation;
  /** afastamento da placa em relação à parede */
  z?: number;
}

/** Janelas como placas sobre a parede (frame local: x ao longo, z para fora). Retorna nº de vãos. */
export function windows(ab: ArchBuilder, o: WindowsOpts): number {
  const width = o.x1 - o.x0;
  if (width < 1.2 || o.floors < 1) return 0;
  const nb = Math.max(1, Math.round(width / o.bay));
  const bay = width / nb;
  const w = Math.min(o.winW, bay - 0.25);
  const z = o.z ?? 0.03;
  for (let k = 0; k < o.floors; k++) {
    const y = o.y0 + k * o.floorH + o.sill;
    for (let i = 0; i < nb; i++) {
      const x = o.x0 + (i + 0.5) * bay;
      const r = ab.rand();
      const c = r < (o.blinds ?? 0.15) ? (o.blindColor ?? 0x8c8a80) : o.glass;
      ab.quad(w, o.winH, x, y, z, c, 'glass');
      if (o.ac && ab.rand() < o.ac) ab.detail(() => ab.box(0.62, 0.42, 0.5, x + (ab.rand() - 0.5) * (w - 0.7), y - 0.5, z + 0.25, o.acColor ?? 0xd8d6cf, 'metal'));
    }
  }
  return nb;
}

/** Faixas de janela por pavimento (LOD distante / janelas em fita). */
export function ribbons(ab: ArchBuilder, x0: number, x1: number, y0: number, floors: number, floorH: number, sill: number, winH: number, color: THREE.ColorRepresentation, z = 0.03) {
  if (x1 - x0 < 1) return;
  for (let k = 0; k < floors; k++) ab.quad(x1 - x0, winH, (x0 + x1) / 2, y0 + k * floorH + sill, z, color, 'glass');
}

/** Caixa de máquinas / caixa d'água na cobertura, centrada no centroide e alinhada à aresta mais longa. */
export function roofBox(ab: ArchBuilder, ring: XZ[], y: number, w: number, d: number, h: number, color: THREE.ColorRepresentation, mat: ArchMat = 'concrete') {
  const c = centroidOf(ring);
  let best = 0, rot = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], q = ring[(i + 1) % ring.length];
    const l = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (l > best) { best = l; rot = Math.atan2(q[1] - a[1], q[0] - a[0]); }
  }
  ab.add(new THREE.BoxGeometry(w, h, d).rotateY(-rot).translate(c[0], y + h / 2, c[1]), color, mat);
}

/** Polígono deslocado para dentro (recuo de coroamento), simples: escala em torno do centroide. */
export function shrinkRing(ring: XZ[], inset: number): XZ[] {
  const c = centroidOf(ring);
  // escala que recua ~inset na menor dimensão
  let minR = Infinity;
  for (const p of ring) minR = Math.min(minR, Math.hypot(p[0] - c[0], p[1] - c[1]));
  const s = Math.max(0.3, 1 - inset / Math.max(1, minR));
  return ring.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s] as XZ);
}

/** tamanho da célula de agrupamento (m): edifícios de reconhecimento da mesma célula viram um só lote */
export const RECOG_CLUSTER_CELL = 220;

interface ClusterMember { name: string; near: ArchBuilder; far: ArchBuilder; center: THREE.Vector3; dists: { detail: number; far: number } }

/**
 * Lote de edifícios de reconhecimento de uma célula: as peças de todos os membros são mescladas por
 * material (≈ 2–4 malhas por lote em vez de 2–4 por edifício) e o LOD é decidido pela distância da
 * câmera à caixa que envolve os membros. Reconstruído quando chega um membro novo (chunk carregado).
 */
class RecogCluster {
  readonly group = new THREE.Group();
  private members: ClusterMember[] = [];
  private nearG?: THREE.Group;
  private farG?: THREE.Group;
  private box = new THREE.Box3();
  private dists = { detail: RECOG_DETAIL_DIST, far: RECOG_FAR_DIST };
  private state = -1;
  tris = { near: 0, far: 0 };
  constructor(key: string, private mats: Record<ArchMat, THREE.Material>) {
    this.group.name = `RECOG_cluster_${key}`;
  }

  add(m: ClusterMember) {
    this.members.push(m);
    this.box.expandByPoint(m.center);
    this.dists = { detail: Math.max(this.dists.detail, m.dists.detail), far: Math.max(this.dists.far, m.dists.far) };
    this.rebuild();
  }

  private rebuild() {
    for (const g of [this.nearG, this.farG]) if (g) {
      this.group.remove(g);
      g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    }
    const near = new ArchBuilder(), far = new ArchBuilder();
    for (const m of this.members) { near.absorb(m.near); far.absorb(m.far); }
    this.tris = { near: near.triangleCount(), far: far.triangleCount() };
    this.nearG = near.build(this.mats, `${this.group.name}_near`);
    this.farG = far.build(this.mats, `${this.group.name}_far`);
    // LOD distante: só a massa projeta sombra (silhueta longa na avenida)
    this.farG.traverse((o) => { const me = o as THREE.Mesh; if (me.isMesh) me.castShadow = !me.name.endsWith('_glass') && !me.name.endsWith('_d'); });
    this.group.add(this.nearG, this.farG);
    this.group.userData.members = this.members.map((m) => m.name);
    this.group.userData.tris = this.tris;
    this.state = -1;
  }

  update(cam: THREE.Vector3) {
    if (!cam || !this.nearG || !this.farG) return;
    // distância até a caixa dos centros (com folga de meio quarteirão)
    const d = Math.max(0, this.box.distanceToPoint(cam) - 25);
    const s = d > this.dists.far ? 2 : d > this.dists.detail ? 1 : 0;
    if (s === this.state) return;
    this.state = s;
    this.nearG.visible = s < 2;
    this.farG.visible = s === 2;
    const detail = this.nearG.userData.detail as THREE.Object3D | undefined;
    if (detail) detail.visible = s === 0;
  }
}

const clusters = new Map<string, RecogCluster>();

/** estatística para QA/documentação */
export function recognitionStats() {
  return [...clusters.entries()].map(([k, c]) => ({ cluster: k, members: c.group.userData.members as string[], tris: c.tris }));
}

/**
 * Registra um edifício de reconhecimento (corpo + LOD distante) no lote da sua célula. O primeiro
 * membro de cada lote devolve o grupo do lote (adicionado à cena pelo jogo); os seguintes devolvem um
 * grupo vazio — o lote é reconstruído e já está na cena.
 */
export function lodInstance(name: string, near: ArchBuilder, far: ArchBuilder, mats: Record<ArchMat, THREE.Material>, center: THREE.Vector3, dists = { detail: RECOG_DETAIL_DIST, far: RECOG_FAR_DIST }): LandmarkInstance {
  const key = `${Math.floor(center.x / RECOG_CLUSTER_CELL)}_${Math.floor(center.z / RECOG_CLUSTER_CELL)}`;
  let cl = clusters.get(key);
  // materiais diferentes (outra instância do jogo) → lote novo
  const fresh = !cl || (cl as unknown as { mats: unknown }).mats !== mats;
  if (fresh) { cl = new RecogCluster(key, mats); clusters.set(key, cl); }
  cl!.add({ name, near, far, center, dists });
  if (!fresh) return { group: new THREE.Group(), colliders: [], update() { /* o lote é atualizado pelo primeiro membro */ } };
  const c = cl!;
  return { group: c.group, colliders: [], update(_t: Date, cam: THREE.Vector3) { c.update(cam); } };
}

/** Frame da aresta mais longa de um anel que aponta para (ou se afasta de) um ponto; útil para fachada principal. */
export function edgeFacing(ring: XZ[], target: XZ, minLen = 6): number {
  let best = -1, score = -Infinity;
  ArchBuilder.edgeFrames(ring, minLen, (m, len, i, a, b) => {
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const mid: XZ = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = target[0] - mid[0], dz = target[1] - mid[1];
    const dl = Math.hypot(dx, dz) || 1;
    const s = (n.x * dx + n.z * dz) / dl + len * 0.002;
    if (s > score) { score = s; best = i; }
  });
  return best;
}
