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
import { timeUniforms } from '../renderer/timeOfDay';

type VType = 'car' | 'taxi' | 'bus';

interface LaneRT extends TrafficLane { cum: number[]; length: number }

interface Vehicle {
  type: VType;
  lane: LaneRT;
  /** próxima faixa planejada (escolhida ao entrar na faixa atual) */
  next: LaneRT | null;
  s: number;
  v: number;
  v0: number;
  len: number;
  width: number;
  x: number; z: number; heading: number;
  slot: number; // índice da instância no tipo
  color: THREE.Color;
  active: boolean;
}

const DIMS: Record<VType, { len: number; width: number }> = {
  car: { len: 4.4, width: 1.8 },
  taxi: { len: 4.4, width: 1.8 },
  bus: { len: 12.2, width: 2.55 },
};

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

interface ModelParts { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; dark: THREE.BufferGeometry; lights: THREE.BufferGeometry; stripe?: THREE.BufferGeometry }

function carModel(taxi: boolean): ModelParts {
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
export class TrafficSystem {
  readonly group = new THREE.Group();
  private lanes: LaneRT[] = [];
  private pvLanes: LaneRT[] = [];
  private vehicles: Vehicle[] = [];
  private meshes = new Map<VType, { body: THREE.InstancedMesh; parts: THREE.InstancedMesh[] }>();
  private capacity: Record<VType, number>;
  private free: Record<VType, number[]> = { car: [], taxi: [], bus: [] };
  private seed = 7;
  private dummy = new THREE.Object3D();
  private lightMat: THREE.MeshStandardMaterial;
  radius = 320;
  stats = { active: 0 };

  /** pontos que os veículos devem evitar (pedestres atravessando) */
  obstacles: { x: number; z: number }[] = [];
  signals: SignalController | null = null;
  stats2 = { stoppedAtRed: 0 };

  constructor(lanes: TrafficLane[], private max: number) {
    this.group.name = 'traffic';
    for (const l of lanes) {
      const cum = [0];
      for (let i = 1; i < l.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]));
      this.lanes.push({ ...l, cum, length: cum[cum.length - 1] });
    }
    this.pvLanes = this.lanes.filter((l) => l.pv);
    this.capacity = { car: Math.ceil(max * 0.7) + 4, taxi: Math.ceil(max * 0.25) + 2, bus: Math.ceil(max * 0.3) + 2 };

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
      // todas as instâncias começam escondidas (escala 0)
      for (let i = 0; i < cap; i++) this.free[t].push(i);
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      for (const im of [body, ...parts]) { for (let i = 0; i < cap; i++) im.setMatrixAt(i, this.dummy.matrix); im.count = cap; }
    }
  }

  private rnd() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private pickNext(l: LaneRT): LaneRT | null {
    const nexts = l.next;
    if (!nexts.length) return null;
    const pvNext = nexts.filter((id) => this.lanes[id].pv);
    const pool = pvNext.length && l.pv ? pvNext : nexts;
    return this.lanes[pool[Math.floor(this.rnd() * pool.length)]];
  }

  private posAt(l: LaneRT, s: number): { x: number; z: number; h: number } {
    let i = 1;
    while (i < l.cum.length - 1 && l.cum[i] < s) i++;
    const a = l.pts[i - 1], b = l.pts[i];
    const seg = l.cum[i] - l.cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - l.cum[i - 1]) / seg));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }

  private spawn(px: number, pz: number, camFwd: THREE.Vector3, initial: boolean): Vehicle | null {
    for (let attempt = 0; attempt < 30; attempt++) {
      const pool = this.rnd() < 0.75 ? this.pvLanes : this.lanes;
      const lane = pool[Math.floor(this.rnd() * pool.length)];
      if (!lane || lane.length < 8) continue;
      const s = this.rnd() * lane.length;
      const p = this.posAt(lane, s);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > this.radius || d < (initial ? 25 : 90)) continue;
      if (!initial && d < 200 && (p.x - px) * camFwd.x + (p.z - pz) * camFwd.z > 0) continue;
      // tipo: ônibus só em vias principais
      const r = this.rnd();
      const type: VType = lane.speed >= 12 && r < 0.24 ? 'bus' : r < 0.42 ? 'taxi' : 'car';
      const dims = DIMS[type];
      if (this.vehicles.some((o) => o.active && Math.hypot(o.x - p.x, o.z - p.z) < (o.len + dims.len) / 2 + 3)) continue;
      const slot = this.free[type].pop();
      if (slot === undefined) continue;
      const color = new THREE.Color(type === 'taxi' ? 0xf2c40f : type === 'bus' ? BUS_COLORS[Math.floor(this.rnd() * BUS_COLORS.length)] : CAR_COLORS[Math.floor(this.rnd() * CAR_COLORS.length)]);
      const v0 = lane.speed * (type === 'bus' ? 0.8 : 0.85 + this.rnd() * 0.3);
      return { type, lane, next: this.pickNext(lane), s, v: v0 * 0.7, v0, len: dims.len, width: dims.width, x: p.x, z: p.z, heading: p.h, slot, color, active: true };
    }
    return null;
  }

  private release(v: Vehicle) {
    v.active = false;
    this.free[v.type].push(v.slot);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    const m = this.meshes.get(v.type)!;
    for (const im of [m.body, ...m.parts]) { im.setMatrixAt(v.slot, this.dummy.matrix); im.instanceMatrix.needsUpdate = true; }
  }

  update(dt: number, camera: THREE.Camera, player: { x: number; z: number }) {
    if (!this.lanes.length) return;
    const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    // reposição
    this.vehicles = this.vehicles.filter((v) => v.active);
    let tries = 0;
    while (this.vehicles.length < this.max && tries++ < 6) {
      const v = this.spawn(player.x, player.z, camFwd, this.time < 1);
      if (v) this.vehicles.push(v);
    }
    // seguimento (gap ao veículo da frente / jogador / pedestres / semáforo)
    let stopped = 0;
    for (const v of this.vehicles) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      let gap = 80;
      for (const o of this.vehicles) {
        if (o === v) continue;
        const dx = o.x - v.x, dz = o.z - v.z;
        if (Math.abs(dx) > 45 || Math.abs(dz) > 45) continue;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0) continue;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 1.7) continue;
        if (Math.sin(o.heading) * fx + Math.cos(o.heading) * fz < 0.5) continue;
        gap = Math.min(gap, ahead - (v.len + o.len) / 2);
      }
      for (const ob of [player, ...this.obstacles]) {
        const dx = ob.x - v.x, dz = ob.z - v.z;
        const ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 30 && lat < v.width / 2 + 0.9) gap = Math.min(gap, ahead - v.len / 2 - 0.6);
      }
      // semáforos: linha de retenção da faixa atual (e início da próxima)
      if (this.signals) {
        const checkStops = (lane: LaneRT, base: number) => {
          for (const st of lane.stops ?? []) {
            const d = base + st.s - v.s - v.len / 2;
            if (d < -1 || d > 70) continue;
            const light = this.signals!.state(st.j, st.ph);
            if (light === 'G') continue;
            // amarelo: só para se ainda dá para frear com conforto
            if (light === 'Y' && d < (v.v * v.v) / (2 * 4.5)) continue;
            gap = Math.min(gap, d + 2.4);
            if (d < 6 && v.v < 0.5) stopped++;
          }
        };
        checkStops(v.lane, 0);
        if (v.next) checkStops(v.next, v.lane.length);
      }
      // velocidade desejada a partir do gap (distância mínima 3 m + 1,4 s de headway)
      const safe = Math.max(0, (gap - 3) / 1.4);
      const target = Math.min(v.v0, safe);
      const acc = target > v.v ? 2.2 : 6.5;
      v.v += Math.sign(target - v.v) * Math.min(Math.abs(target - v.v), acc * dt);
    }
    // movimento ao longo das faixas
    let active = 0;
    for (const v of this.vehicles) {
      v.s += v.v * dt;
      while (v.s > v.lane.length) {
        if (!v.next) { this.release(v); break; }
        v.s -= v.lane.length;
        v.lane = v.next;
        v.next = this.pickNext(v.lane);
      }
      if (!v.active) continue;
      const p = this.posAt(v.lane, v.s);
      // suaviza o rumo nas emendas dos trechos
      let dh = p.h - v.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      v.heading += dh * Math.min(1, dt * 8);
      v.x = p.x; v.z = p.z;
      if (Math.hypot(v.x - player.x, v.z - player.z) > this.radius + 60) { this.release(v); continue; }
      active++;
      const m = this.meshes.get(v.type)!;
      this.dummy.position.set(v.x, 0, v.z);
      this.dummy.rotation.set(0, v.heading, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      for (const im of [m.body, ...m.parts]) im.setMatrixAt(v.slot, this.dummy.matrix);
      m.body.setColorAt(v.slot, v.color);
    }
    for (const m of this.meshes.values()) {
      for (const im of [m.body, ...m.parts]) im.instanceMatrix.needsUpdate = true;
      if (m.body.instanceColor) m.body.instanceColor.needsUpdate = true;
    }
    this.lightMat.emissiveIntensity = 0.2 + timeUniforms.night.value * 3.5;
    this.stats2.stoppedAtRed = stopped;
    this.vehicles = this.vehicles.filter((v) => v.active);
    this.stats.active = active;
    this.time += dt;
  }

  /** impede o jogador de atravessar veículos (empurra para fora da caixa do veículo) */
  pushOut(p: { x: number; z: number }, radius = 0.35) {
    for (const v of this.vehicles) {
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

  private time = 0;
}
