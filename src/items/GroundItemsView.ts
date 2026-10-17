/**
 * Itens no chão / nos pontos de apoio (rodada 9) — desenho no cliente do que o servidor manda em `item_list`.
 * Poucos itens (dezenas no máximo): um Mesh leve por item com a geometria/material COMPARTILHADOS dos props
 * (propGeometry/propMaterials) + um anel discreto no chão para o largado; ponto de apoio = estrado de madeira
 * procedural (geometria única, ripas + travessas) onde os itens ficam deitados lado a lado. Nada por quadro.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROP_BY_ID } from '../social/props';
import { propModel } from '../social/props/propGeometry';
import { propBodyMaterial } from '../social/props/propMaterials';
import { ITEM_STATE, rackPlacement, type ItemView, type SupplyRack } from './protocol';

/** altura do tampo do estrado (m) */
const PALLET_TOP = 0.13;
let palletGeo: THREE.BufferGeometry | null = null;
let palletMat: THREE.MeshStandardMaterial | null = null;
let ringGeo: THREE.BufferGeometry | null = null;
let ringMat: THREE.MeshBasicMaterial | null = null;

function pallet() {
  if (!palletGeo) {
    // estrado 1,5 × 0,95 m: três travessas embaixo, seis ripas em cima (eixo longo = fileira de itens, +X)
    const parts: THREE.BufferGeometry[] = [];
    for (const z of [-0.4, 0, 0.4]) parts.push(new THREE.BoxGeometry(1.5, 0.095, 0.09).translate(0, 0.0475, z));
    for (let i = 0; i < 6; i++) parts.push(new THREE.BoxGeometry(0.2, 0.024, 0.95).translate(-0.65 + i * 0.26, 0.095 + 0.012, 0));
    palletGeo = mergeGeometries(parts.map((g) => g.toNonIndexed()), false)!;
    parts.forEach((g) => g.dispose());
    palletGeo.computeVertexNormals();
    palletGeo.name = 'item_rack_pallet';
  }
  if (!palletMat) { palletMat = new THREE.MeshStandardMaterial({ color: 0xa27b4f, roughness: 0.88 }); palletMat.name = 'item_rack_pallet'; }
  return { geo: palletGeo, mat: palletMat };
}
function ring() {
  if (!ringGeo) { ringGeo = new THREE.RingGeometry(0.34, 0.46, 32); ringGeo.rotateX(-Math.PI / 2); ringGeo.name = 'item_ring'; }
  if (!ringMat) { ringMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.35, depthWrite: false }); ringMat.name = 'item_ring'; }
  return { geo: ringGeo, mat: ringMat };
}

/** centro e raio do item ao longo do cabo (+Y do item): para deitar centrado e encostado no chão/tampo */
const extents = new Map<string, { mid: number; r: number }>();
function extentOf(kind: Parameters<typeof propModel>[0]) {
  let e = extents.get(kind);
  if (!e) {
    const g = propModel(kind, 'near').rigid;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox!;
    e = { mid: (b.min.y + b.max.y) / 2, r: Math.max(-b.min.z, b.max.z, -b.min.x, b.max.x) };
    extents.set(kind, e);
  }
  return e;
}

interface Shown { group: THREE.Group; prop: number; state: number; x: number; z: number }

export class GroundItemsView {
  readonly group = new THREE.Group();
  private shown = new Map<number, Shown>();
  private racks: { mesh: THREE.Mesh; x: number; z: number; heading: number }[] = [];
  /** QA */
  stats = { items: 0, lists: 0 };

  constructor(private ground: (x: number, z: number) => number) {
    this.group.name = 'ground_items';
  }

  /** estrados dos pontos de apoio (dados públicos: o mesmo arquivo do servidor) */
  setRacks(racks: readonly SupplyRack[], axis: [number, number][]) {
    for (const r of this.racks) r.mesh.removeFromParent();
    this.racks = [];
    const { geo, mat } = pallet();
    for (const r of racks) {
      const pl = rackPlacement(r, axis);
      const m = new THREE.Mesh(geo, mat);
      m.name = `rack_${r.id}`;
      m.position.set(pl.x, this.ground(pl.x, pl.z), pl.z);
      m.rotation.y = pl.heading; // +X local = direção da fileira de vagas
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      this.racks.push({ mesh: m, x: pl.x, z: pl.z, heading: pl.heading });
    }
    // itens já mostrados no apoio ganham a orientação do estrado
    for (const [id, s] of [...this.shown]) if (s.state === ITEM_STATE.RACK) { s.group.removeFromParent(); this.shown.set(id, this.build({ id, prop: s.prop, x: s.x, z: s.z, state: ITEM_STATE.RACK })); }
  }

  /** lista autoritativa da área de interesse (substitui a anterior) */
  apply(list: readonly ItemView[]) {
    this.stats.lists++;
    const keep = new Set<number>();
    for (const it of list) {
      keep.add(it.id);
      const cur = this.shown.get(it.id);
      if (cur && cur.prop === it.prop && cur.state === it.state && cur.x === it.x && cur.z === it.z) continue;
      if (cur) cur.group.removeFromParent();
      this.shown.set(it.id, this.build(it));
    }
    for (const [id, s] of this.shown) if (!keep.has(id)) { s.group.removeFromParent(); this.shown.delete(id); }
    this.stats.items = this.shown.size;
  }

  private build(it: ItemView): Shown {
    const def = PROP_BY_ID.get(it.prop);
    const g = new THREE.Group();
    g.name = `item_${it.id}_${def?.kind ?? it.prop}`;
    const onRack = it.state === ITEM_STATE.RACK;
    let yaw = (it.id * 2.399) % (Math.PI * 2);
    if (onRack) {
      // perpendicular à fileira do estrado mais próximo (itens lado a lado)
      let best = Infinity;
      for (const r of this.racks) { const d = Math.hypot(r.x - it.x, r.z - it.z); if (d < best) { best = d; yaw = r.heading; } }
      if (best > 3) yaw = 0;
    }
    g.position.set(it.x, this.ground(it.x, it.z) + (onRack ? PALLET_TOP : 0), it.z);
    g.rotation.y = yaw;
    if (def) {
      const e = extentOf(def.kind);
      const m = new THREE.Mesh(propModel(def.kind, 'near').rigid, propBodyMaterial());
      m.castShadow = true;
      // deitado: o cabo (+Y do item) vai para −Z local, centrado no ponto; a frente (+Z do item) para cima
      m.rotation.set(-Math.PI / 2, 0, 0);
      m.position.set(0, e.r, e.mid);
      g.add(m);
    }
    if (!onRack) { const r = ring(); const rm = new THREE.Mesh(r.geo, r.mat); rm.position.y = 0.012; rm.renderOrder = 2; g.add(rm); }
    this.group.add(g);
    return { group: g, prop: it.prop, state: it.state, x: it.x, z: it.z };
  }

  /** item mais próximo a ≤ r de (x, z) (o que o R pega) */
  nearest(x: number, z: number, r: number): { id: number; prop: number; d: number } | null {
    let best: { id: number; prop: number; d: number } | null = null;
    for (const [id, s] of this.shown) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d <= r && (!best || d < best.d)) best = { id, prop: s.prop, d };
    }
    return best;
  }

  get list() { return [...this.shown].map(([id, s]) => ({ id, prop: s.prop, state: s.state, x: s.x, z: s.z })); }

  /** limpa tudo (desconectou) */
  clear() { for (const s of this.shown.values()) s.group.removeFromParent(); this.shown.clear(); this.stats.items = 0; }
}
