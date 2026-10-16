/**
 * Trânsito de ambiente (cliente, ADR-003): veículos seguem as faixas reais geradas do OSM
 * (sentido correto, mão direita), com seguimento do veículo da frente (modelo simplificado tipo IDM),
 * frenagem para o jogador, continuidade entre trechos e reposição fora da vista.
 * Modelos procedurais originais, desenhados por instancing (poucos draw calls para dezenas de veículos).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrafficLane } from '../world/types';
import type { SignalController } from './SignalController';
import { TrafficSim, VTYPE_NAMES, type SimVehicle, type Obstacle } from './TrafficSim';
import { timeUniforms } from '../renderer/timeOfDay';

type VType = 'car' | 'taxi' | 'bus';

const CAR_COLORS = [0xe8e8e8, 0x1a1a1a, 0x8a8f96, 0xb5b9be, 0x7a1a1a, 0x1f3a63, 0x3d4a3a, 0xf4f4f0, 0x5a5f66, 0x2a2a30];
// cores de ônibus municipais genéricas (sem marcas reais de consórcios)
const BUS_COLORS = [0x1f5fa8, 0x2e8b57, 0xd8742a, 0xc23b3b, 0xe2c23a, 0x3a3f8f];

// ---------------------------------------------------------------- modelos
function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}
function wheels(len: number, width: number, r: number, axles: number[]) {
  const gs: THREE.BufferGeometry[] = [];
  for (const az of axles) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(r, r, 0.26, 14);
    g.rotateZ(Math.PI / 2);
    g.translate(s * (width / 2 - 0.12), r, az * len / 2);
    g.deleteAttribute('uv');
    gs.push(g);
  }
  return mergeGeometries(gs)!;
}
/** cabine com teto inclinado (para-brisa/vidro traseiro) a partir de uma caixa deformada */
function cabin(w: number, h: number, d: number, y: number, z: number, taper = 0.32) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setZ(i, p.getZ(i) * (1 - taper)); p.setX(i, p.getX(i) * 0.92); }
  }
  g.computeVertexNormals();
  g.translate(0, y + h / 2, z);
  g.deleteAttribute('uv');
  return g;
}

export interface ModelParts { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; dark: THREE.BufferGeometry; lights: THREE.BufferGeometry; stripe?: THREE.BufferGeometry }

export function carModel(taxi: boolean): ModelParts {
  const L = 4.4, W = 1.8;
  const body = mergeGeometries([box(W, 0.62, L, 0, 0.62, 0), box(W - 0.06, 0.12, L - 0.3, 0, 0.98, 0)])!;
  const glass = cabin(W - 0.12, 0.5, 2.2, 1.0, -0.15);
  const roof = box(W - 0.3, 0.06, 1.3, 0, 1.53, -0.15);
  const dark = mergeGeometries([wheels(L, W, 0.33, [0.62, -0.62]), box(W + 0.02, 0.18, L + 0.04, 0, 0.36, 0)])!;
  const lights = mergeGeometries([box(0.35, 0.12, 0.05, 0.6, 0.8, L / 2 + 0.01), box(0.35, 0.12, 0.05, -0.6, 0.8, L / 2 + 0.01),
    box(0.3, 0.12, 0.05, 0.62, 0.82, -L / 2 - 0.01), box(0.3, 0.12, 0.05, -0.62, 0.82, -L / 2 - 0.01)])!;
  const parts: ModelParts = { body: mergeGeometries([body, roof])!, glass, dark, lights };
  // táxi carioca: amarelo com faixa azul lateral + luminoso no teto
  if (taxi) parts.stripe = mergeGeometries([box(W + 0.02, 0.1, L - 0.6, 0, 0.75, 0), box(0.5, 0.14, 0.2, 0, 1.63, -0.15)])!;
  return parts;
}

function busModel(): ModelParts {
  const L = 12.2, W = 2.55;
  const body = mergeGeometries([box(W, 2.0, L, 0, 1.45, 0), box(W - 0.05, 0.25, L - 0.2, 0, 2.95, 0)])!;
  const glass = mergeGeometries([box(W + 0.02, 1.0, L - 1.6, 0, 1.95, -0.3), box(W - 0.2, 1.3, 0.05, 0, 1.75, L / 2 + 0.01)])!;
  const dark = mergeGeometries([wheels(L, W, 0.5, [0.62, -0.5]), box(W + 0.02, 0.3, L + 0.02, 0, 0.55, 0)])!;
  const lights = mergeGeometries([box(0.35, 0.2, 0.05, 0.9, 0.85, L / 2 + 0.02), box(0.35, 0.2, 0.05, -0.9, 0.85, L / 2 + 0.02),
    box(0.3, 0.3, 0.05, 1.0, 1.0, -L / 2 - 0.02), box(0.3, 0.3, 0.05, -1.0, 1.0, -L / 2 - 0.02), box(1.6, 0.25, 0.05, 0, 2.7, L / 2 + 0.03)])!;
  return { body, glass, dark, lights };
}

// ---------------------------------------------------------------- sistema
interface Slot { type: VType; slot: number; rx: number; rz: number; rh: number; ox: number; oz: number }

export class TrafficSystem {
  readonly group = new THREE.Group();
  readonly sim: TrafficSim;
  private meshes = new Map<VType, { body: THREE.InstancedMesh; parts: THREE.InstancedMesh[] }>();
  private capacity: Record<VType, number>;
  private free: Record<VType, number[]> = { car: [], taxi: [], bus: [] };
  private slots = new Map<number, Slot>();
  private dummy = new THREE.Object3D();
  private lightMat: THREE.MeshStandardMaterial;
  private colorTmp = new THREE.Color();
  radius = 320;
  /** 'local' = simula ao redor do jogador (singleplayer); 'remote' = estado vindo do servidor */
  mode: 'local' | 'remote' = 'local';
  stats = { active: 0 };
  stats2 = { stoppedAtRed: 0 };
  /** pontos que os veículos devem evitar (pedestres atravessando, carros de jogadores…) */
  obstacles: Obstacle[] = [];
  signals: SignalController | null = null;
  private time = 0;

  constructor(lanes: TrafficLane[], private max: number, seed = 7) {
    this.group.name = 'traffic';
    this.sim = new TrafficSim(lanes, seed);
    this.sim.signals = (j, ph) => (this.signals ? this.signals.state(j, ph) : 'G');
    const capFor = (n: number) => ({ car: Math.ceil(n * 0.7) + 4, taxi: Math.ceil(n * 0.5) + 2, bus: Math.ceil(n * 0.35) + 2 });
    this.capacity = capFor(Math.max(max, 160));

    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1b2328, roughness: 0.06, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.1 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0cc, emissiveIntensity: 0.2, roughness: 0.3 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.4, metalness: 0.3 });
    const models: Record<VType, ModelParts> = { car: carModel(false), taxi: carModel(true), bus: busModel() };
    for (const t of ['car', 'taxi', 'bus'] as VType[]) {
      const cap = this.capacity[t];
      const m = models[t];
      const mk = (g: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
        const im = new THREE.InstancedMesh(g, mat, cap);
        im.count = 0;
        im.castShadow = shadow;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.name = `traffic_${t}`;
        this.group.add(im);
        return im;
      };
      const body = mk(m.body, bodyMat, true);
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      const parts = [mk(m.glass, glassMat, false), mk(m.dark, darkMat, true), mk(m.lights, this.lightMat, false)];
      if (m.stripe) parts.push(mk(m.stripe, stripeMat, false));
      this.meshes.set(t, { body, parts });
      for (let i = cap - 1; i >= 0; i--) this.free[t].push(i);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      for (const im of [body, ...parts]) { for (let i = 0; i < cap; i++) im.setMatrixAt(i, this.dummy.matrix); im.count = cap; }
    }
  }

  /** veículos ativos (para o carro dirigível, impactos, etc.) */
  get vehicles(): SimVehicle[] { return this.sim.vehicles; }

  private colorOf(v: SimVehicle): number {
    const t = VTYPE_NAMES[v.type];
    return t === 'taxi' ? 0xf2c40f : t === 'bus' ? BUS_COLORS[v.color % BUS_COLORS.length] : CAR_COLORS[v.color % CAR_COLORS.length];
  }

  private slotFor(v: SimVehicle): Slot | null {
    const existing = this.slots.get(v.id);
    const t = VTYPE_NAMES[v.type];
    if (existing && existing.type === t) return existing;
    if (existing) this.releaseSlot(v.id);
    const slot = this.free[t].pop();
    if (slot === undefined) return null;
    const s: Slot = { type: t, slot, rx: v.x, rz: v.z, rh: v.heading, ox: 0, oz: 0 };
    this.slots.set(v.id, s);
    return s;
  }

  private releaseSlot(id: number) {
    const s = this.slots.get(id);
    if (!s) return;
    this.free[s.type].push(s.slot);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    const m = this.meshes.get(s.type)!;
    for (const im of [m.body, ...m.parts]) im.setMatrixAt(s.slot, this.dummy.matrix);
    this.slots.delete(id);
  }

  /** multiplayer: snapshot binário do servidor (área de interesse) */
  applySnapshot(buf: Uint8Array) {
    this.mode = 'remote';
    // guarda a posição renderizada antes da correção para suavizar
    const before = new Map<number, { x: number; z: number }>();
    for (const [id, s] of this.slots) before.set(id, { x: s.rx, z: s.rz });
    const r = this.sim.applySnapshot(buf);
    for (const v of r.removed) this.releaseSlot(v.id);
    for (const v of r.updated) {
      const s = this.slots.get(v.id), b = before.get(v.id);
      if (s && b) {
        const ex = b.x - v.x, ez = b.z - v.z;
        // correções pequenas são suavizadas; grandes (troca de faixa/respawn) aplicadas direto
        if (Math.hypot(ex, ez) < 6) { s.ox = ex; s.oz = ez; } else { s.ox = s.oz = 0; }
      }
    }
  }

  update(dt: number, camera: THREE.Camera, player: { x: number; z: number }) {
    if (!this.sim.lanes.length) return;
    if (this.mode === 'local') {
      const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      this.sim.populateAround(this.max, player.x, player.z, this.radius, this.time < 1, { x: camFwd.x, z: camFwd.z });
    }
    this.sim.step(dt, [{ x: player.x, z: player.z }, ...this.obstacles], false);
    if (this.mode === 'local') this.sim.cull(player.x, player.z, this.radius + 60);
    // slots de veículos que saíram
    const alive = new Set(this.sim.vehicles.map((v) => v.id));
    for (const id of [...this.slots.keys()]) if (!alive.has(id)) this.releaseSlot(id);
    let active = 0;
    const decay = Math.exp(-dt / 0.35);
    for (const v of this.sim.vehicles) {
      const s = this.slotFor(v);
      if (!s) continue;
      active++;
      s.ox *= decay; s.oz *= decay;
      s.rx = v.x + s.ox; s.rz = v.z + s.oz; s.rh = v.heading;
      const m = this.meshes.get(s.type)!;
      this.dummy.position.set(s.rx, 0, s.rz);
      this.dummy.rotation.set(0, s.rh, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      for (const im of [m.body, ...m.parts]) im.setMatrixAt(s.slot, this.dummy.matrix);
      m.body.setColorAt(s.slot, this.colorTmp.setHex(this.colorOf(v)));
    }
    for (const m of this.meshes.values()) {
      for (const im of [m.body, ...m.parts]) im.instanceMatrix.needsUpdate = true;
      if (m.body.instanceColor) m.body.instanceColor.needsUpdate = true;
    }
    this.lightMat.emissiveIntensity = 0.2 + timeUniforms.night.value * 3.5;
    this.stats2.stoppedAtRed = this.sim.stoppedAtRed;
    this.stats.active = active;
    this.time += dt;
  }

  /** impede o jogador de atravessar veículos (empurra para fora da caixa do veículo) */
  pushOut(p: { x: number; z: number }, radius = 0.35) {
    for (const v of this.sim.vehicles) {
      const dx = p.x - v.x, dz = p.z - v.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const lz = dx * fx + dz * fz; // ao longo
      const lx = dx * fz - dz * fx; // lateral
      const hx = v.width / 2 + radius, hz = v.len / 2 + radius;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
        const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
        let nlx = lx, nlz = lz;
        if (px < pz) nlx = Math.sign(lx || 1) * hx; else nlz = Math.sign(lz || 1) * hz;
        p.x = v.x + nlz * fx + nlx * fz;
        p.z = v.z + nlz * fz - nlx * fx;
      }
    }
  }
}
