/**
 * Veículos utilizáveis pelo jogador (docs/VEHICLES.md, ADR-011).
 *
 * Arquitetura (igual à do jogador — estado / simulação / visual separados, pronta para rede):
 *   RideableState      dado puro e serializável (posição, rumo, velocidade, ocupante)
 *   RIDEABLE_DEFS      parâmetros por tipo (bicycle, scooter, car)
 *   stepRideable()     simulação cinemática determinística (modelo de bicicleta) contra o CollisionWorld
 *   RideableSystem     spawns (estações reais), proximidade/uso, render com LOD por distância
 * Carro dirigível: definido aqui (parâmetros + controlador) mas ainda sem spawn/modelo — próxima etapa.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { legacyGeometry } from '../traffic/TrafficSystem';
import { getVehicleGeometry, vehicleMaterial } from '../traffic/vehicleModels';
import { distToVehicle } from '../net/rules';

export type RideableKind = 'bicycle' | 'scooter' | 'car';

export interface RideableDef {
  kind: RideableKind;
  label: string;
  maxSpeed: number; // m/s
  boostSpeed: number; // com Shift
  accel: number;
  brake: number;
  turnRate: number; // rad/s em velocidade de referência
  radius: number; // colisão
  pose: 'sit-pedal' | 'stand' | 'drive';
  seatHeight: number;
  /** pode andar na calçada? */
  sidewalk: boolean;
}

export const RIDEABLE_DEFS: Record<RideableKind, RideableDef> = {
  bicycle: { kind: 'bicycle', label: 'Bicicleta', maxSpeed: 6.5, boostSpeed: 9, accel: 3.2, brake: 7, turnRate: 1.9, radius: 0.45, pose: 'sit-pedal', seatHeight: 0.92, sidewalk: true },
  scooter: { kind: 'scooter', label: 'Patinete', maxSpeed: 5.5, boostSpeed: 7, accel: 3.6, brake: 6, turnRate: 2.3, radius: 0.4, pose: 'stand', seatHeight: 0.18, sidewalk: true },
  car: { kind: 'car', label: 'Automóvel', maxSpeed: 14, boostSpeed: 18, accel: 4.5, brake: 9, turnRate: 1.1, radius: 1.15, pose: 'drive', seatHeight: 0.42, sidewalk: false },
};

export interface RideableState {
  id: string;
  kind: RideableKind;
  x: number; y: number; z: number;
  heading: number;
  speed: number;
  /** id do jogador montado (servidor é a autoridade no multiplayer) */
  occupant: string | null;
}

export interface RideIntent { throttle: number; steer: number; boost: boolean }

/** Simulação cinemática (bicicleta): acelera/freia, esterça proporcional à velocidade, colide com prédios. */
export function stepRideable(v: RideableState, def: RideableDef, intent: RideIntent, dt: number, world: CollisionWorld) {
  const vmax = intent.boost ? def.boostSpeed : def.maxSpeed;
  const target = intent.throttle >= 0 ? intent.throttle * vmax : intent.throttle * vmax * 0.3; // ré lenta
  const rate = Math.sign(target - v.speed) === Math.sign(v.speed) || v.speed === 0 ? def.accel : def.brake;
  v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), rate * dt);
  if (Math.abs(intent.throttle) < 0.05) v.speed *= Math.exp(-0.6 * dt); // rolamento
  // carro fora do asfalto (saindo da vaga na calçada): só manobra lenta
  if (!def.sidewalk && world.groundHeight(v.x, v.z) > 0.1) v.speed = Math.max(-1.5, Math.min(2.5, v.speed));
  const steerScale = Math.min(1, Math.abs(v.speed) / 2.5) * Math.sign(v.speed || 1);
  v.heading += intent.steer * def.turnRate * steerScale * dt;
  const nx = v.x + Math.sin(v.heading) * v.speed * dt;
  const nz = v.z + Math.cos(v.heading) * v.speed * dt;
  const ok = (x: number, z: number) => {
    if (world.isBlockedSurface(x, z)) return false;
    const g = world.groundHeight(x, z);
    // carro não SOBE no meio-fio (pode descer da calçada onde estacionou)
    if (!def.sidewalk && g - v.y > 0.05) return false;
    return g - v.y <= 0.3;
  };
  if (ok(nx, nz)) { v.x = nx; v.z = nz; } else v.speed *= -0.2; // bate e para
  const p = { x: v.x, y: v.y, z: v.z };
  if (world.resolveCircle(p, def.radius, 1.6)) v.speed *= 0.6;
  v.x = p.x; v.z = p.z;
  const g = world.groundHeight(v.x, v.z);
  v.y += (g - v.y) * Math.min(1, dt * 12); // degrau do meio-fio suavizado
}

// ------------------------------------------------------------------------------- modelos
function part(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}

export function rideableModel(kind: RideableKind, color: number): THREE.Group {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7, metalness: 0.2 });
  if (kind === 'bicycle') {
    const wheels = mergeGeometries([
      part(new THREE.TorusGeometry(0.33, 0.035, 8, 24), 0, 0.35, 0.52, 0, Math.PI / 2),
      part(new THREE.TorusGeometry(0.33, 0.035, 8, 24), 0, 0.35, -0.52, 0, Math.PI / 2),
    ])!;
    const frame = mergeGeometries([
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), 0, 0.62, 0.05, Math.PI / 2 - 0.3), // tubo superior
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), 0, 0.5, 0.18, -0.9), // tubo inferior
      part(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 6), 0, 0.62, -0.18, 0.25), // selim
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), 0, 0.42, -0.38, Math.PI / 2 + 0.55), // traseiro
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.6, 6), 0, 0.68, 0.52, 0.25), // garfo
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6), 0, 1.0, 0.6, 0, 0, Math.PI / 2), // guidão
      part(new THREE.BoxGeometry(0.4, 0.06, 0.3), 0, 0.85, 0.72), // cesta (padrão de bike compartilhada)
    ])!;
    const seat = part(new THREE.BoxGeometry(0.14, 0.05, 0.26), 0, 0.94, -0.28);
    g.add(new THREE.Mesh(wheels, dark), new THREE.Mesh(frame, frameMat), new THREE.Mesh(seat, dark));
  } else if (kind === 'car') {
    // automóvel dirigível: mesmo sedan do trânsito (4,4 m × 1,8 m), cor de destaque via instanceColor
    const car = new THREE.InstancedMesh(getVehicleGeometry('sedan', 0, () => legacyGeometry('sedan')), vehicleMaterial(), 1);
    car.setMatrixAt(0, new THREE.Matrix4());
    car.setColorAt(0, new THREE.Color(color));
    car.name = 'car_body';
    g.add(car);
  } else if (kind === 'scooter') {
    const wheels = mergeGeometries([
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), 0, 0.1, 0.42, 0, 0, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), 0, 0.1, -0.42, 0, 0, Math.PI / 2),
    ])!;
    const body = mergeGeometries([
      part(new THREE.BoxGeometry(0.17, 0.06, 0.82), 0, 0.15, 0), // plataforma
      part(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8), 0, 0.68, 0.42, 0.12), // haste
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 6), 0, 1.16, 0.48, 0, 0, Math.PI / 2), // guidão
    ])!;
    g.add(new THREE.Mesh(wheels, dark), new THREE.Mesh(body, frameMat));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ------------------------------------------------------------------------------- sistema
export interface RideableInstance { state: RideableState; def: RideableDef; model: THREE.Group }

export class RideableSystem {
  readonly group = new THREE.Group();
  readonly items: RideableInstance[] = [];

  readonly byId = new Map<string, RideableInstance>();

  constructor(spawns: { id: string; kind: RideableKind; x: number; z: number; heading: number }[], heightAt: (x: number, z: number) => number, kinds: RideableKind[] = ['bicycle', 'scooter', 'car']) {
    this.group.name = 'rideables';
    for (const sp of spawns) {
      if (!kinds.includes(sp.kind)) continue;
      const state: RideableState = { id: sp.id, kind: sp.kind, x: sp.x, y: heightAt(sp.x, sp.z), z: sp.z, heading: sp.heading, speed: 0, occupant: null };
      const color = sp.kind === 'bicycle' ? 0xe0731c : sp.kind === 'scooter' ? 0x2e7d4f : 0xb3122e;
      const model = rideableModel(sp.kind, color);
      model.name = `rideable_${sp.id}`;
      this.group.add(model);
      const it = { state, def: RIDEABLE_DEFS[sp.kind], model };
      this.items.push(it);
      this.byId.set(sp.id, it);
    }
    this.sync();
  }

  /** estado vindo do servidor (veículos não controlados localmente): suavizado */
  applyServer(id: string, x: number, y: number, z: number, heading: number, occupant: string, localId: string) {
    const it = this.byId.get(id);
    if (!it) return;
    it.state.occupant = occupant || null;
    if (occupant === localId) return; // o motorista local é a fonte da pose (predição)
    (it as RideableInstance & { target?: { x: number; y: number; z: number; h: number } }).target = { x, y, z, h: heading };
  }

  /** interpola veículos remotos em direção ao alvo do servidor */
  smooth(dt: number, localId: string) {
    const k = 1 - Math.exp(-dt * 10);
    for (const it of this.items) {
      const tg = (it as RideableInstance & { target?: { x: number; y: number; z: number; h: number } }).target;
      if (!tg || it.state.occupant === localId) continue;
      it.state.x += (tg.x - it.state.x) * k;
      it.state.y += (tg.y - it.state.y) * k;
      it.state.z += (tg.z - it.state.z) * k;
      let dh = tg.h - it.state.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      it.state.heading += dh * k;
    }
  }

  /** veículo livre mais próximo dentro do alcance */
  nearest(x: number, z: number, range = 2.4): RideableInstance | null {
    let best: RideableInstance | null = null, bd = range;
    for (const it of this.items) {
      if (it.state.occupant) continue;
      // carro: alcance pela lateral da carroceria
      const d = distToVehicle(x, z, { x: it.state.x, z: it.state.z, heading: it.state.heading, kind: it.def.kind }) - (it.def.kind === 'car' ? 0.2 : 0);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  sync(cam?: THREE.Vector3) {
    for (const it of this.items) {
      const s = it.state;
      it.model.position.set(s.x, s.y, s.z);
      it.model.rotation.y = s.heading;
      it.model.visible = !cam || Math.hypot(s.x - cam.x, s.z - cam.z) < (it.def.kind === 'car' ? 400 : 140);
    }
  }
}
