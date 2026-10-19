/**
 * Veículos utilizáveis pelo jogador (docs/VEHICLES.md, ADR-011).
 *
 * Arquitetura (igual à do jogador — estado / simulação / visual separados, pronta para rede):
 *   RideableState      dado puro e serializável (posição, rumo, velocidade, ocupante)
 *   RIDEABLE_DEFS      parâmetros por tipo (bicycle, scooter, car, moto, soundcar, trio) — limites urbanos (avenida fechada)
 *   stepRideable()     simulação cinemática determinística (modelo de bicicleta) contra o CollisionWorld
 *   RideableSystem     spawns (estações reais), proximidade/uso, render com LOD por distância
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { legacyGeometry } from '../traffic/legacyModels';
import { getVehicleGeometry, getVehicleSplit, vehicleGlassMaterial, vehicleMaterial } from '../traffic/vehicleModels';
import { mountProfile } from './seats'; // rodada 10 — montagem
import type { RideDyn } from '../characters/human/vehicleClips';
import { angleDelta } from '../npc/gait';
import { distToVehicle, EVENT_VEHICLE_KINDS } from '../net/rules';
import { TRIO, distToCabDoor, localToWorld } from './platform';
import { applyDesign, buildSoundcar, buildTrio } from './eventModels';
import { rallyPoints, RALLY_DEFAULT_WEIGHTS, RALLY_SHAPE } from '../social/rally';

export type RideableKind = 'bicycle' | 'scooter' | 'car' | 'moto' | 'soundcar' | 'trio';

export interface RideableDef {
  kind: RideableKind;
  label: string;
  /** artigo para a interface ("o carro", "a moto") */
  article: 'o' | 'a';
  maxSpeed: number; // m/s
  boostSpeed: number; // com Shift
  accel: number;
  brake: number;
  turnRate: number; // rad/s em velocidade de referência
  radius: number; // colisão
  pose: 'sit-pedal' | 'stand' | 'drive' | 'ride';
  seatHeight: number;
  /** pode andar na calçada? */
  sidewalk: boolean;
  /** tem marcha à ré (carro); os demais só freiam */
  reverse: boolean;
  /** veículos longos (trio): comprimento para testar as pontas contra prédios/meio-fio, não só o centro */
  length?: number;
  /** banco do motorista no referencial local [x, z] (cabine longe do centro: carro de som, trio) */
  seat?: [number, number];
}

// Velocidades urbanas: a Pres. Vargas está FECHADA para o evento — nada de pista de corrida.
// carro/moto 25 km/h (Shift 30), bicicleta 20 (25), patinete 17 (20).
export const RIDEABLE_DEFS: Record<RideableKind, RideableDef> = {
  bicycle: { kind: 'bicycle', label: 'Bicicleta', article: 'a', maxSpeed: 5.6, boostSpeed: 6.9, accel: 2.8, brake: 7, turnRate: 1.9, radius: 0.45, pose: 'sit-pedal', seatHeight: 0.92, sidewalk: true, reverse: false },
  scooter: { kind: 'scooter', label: 'Patinete', article: 'o', maxSpeed: 4.7, boostSpeed: 5.5, accel: 3.0, brake: 6, turnRate: 2.3, radius: 0.4, pose: 'stand', seatHeight: 0.18, sidewalk: true, reverse: false },
  moto: { kind: 'moto', label: 'Moto', article: 'a', maxSpeed: 6.9, boostSpeed: 8.3, accel: 4.0, brake: 9, turnRate: 1.6, radius: 0.55, pose: 'ride', seatHeight: 0.78, sidewalk: false, reverse: false },
  car: { kind: 'car', label: 'Carro', article: 'o', maxSpeed: 6.9, boostSpeed: 8.3, accel: 3.2, brake: 9, turnRate: 1.1, radius: 1.15, pose: 'drive', seatHeight: 0.42, sidewalk: false, reverse: true },
  // veículos de EVENTO: passo de cortejo (carro de som 12,6 km/h, Shift 14,4; trio 4,3 km/h, Shift 5,4)
  soundcar: { kind: 'soundcar', label: 'Carro de som', article: 'o', maxSpeed: 3.5, boostSpeed: 4.0, accel: 1.2, brake: 4, turnRate: 0.75, radius: 1.0, pose: 'drive', seatHeight: 0.95, sidewalk: false, reverse: true, length: 5.0, seat: [0.45, 1.0] },
  trio: { kind: 'trio', label: 'Trio elétrico', article: 'o', maxSpeed: 1.2, boostSpeed: 1.5, accel: 0.5, brake: 2, turnRate: 0.3, radius: 1.3, pose: 'drive', seatHeight: 1.75, sidewalk: false, reverse: true, length: TRIO.len, seat: [0.6, 5.1] },
};

/** posição do motorista no mundo (banco da cabine) */
export function seatWorld(def: RideableDef, x: number, z: number, heading: number): { x: number; z: number } {
  return def.seat ? localToWorld({ x, z, heading }, def.seat[0], def.seat[1]) : { x, z };
}

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
  // freio = throttle negativo; só o carro engata ré (lenta) depois de parar
  const target = intent.throttle >= 0 ? intent.throttle * vmax : def.reverse ? intent.throttle * vmax * 0.3 : 0;
  const rate = Math.sign(target - v.speed) === Math.sign(v.speed) || v.speed === 0 ? def.accel : def.brake;
  v.speed += Math.sign(target - v.speed) * Math.min(Math.abs(target - v.speed), rate * dt);
  if (Math.abs(intent.throttle) < 0.05) v.speed *= Math.exp(-0.6 * dt); // rolamento
  // carro fora do asfalto (saindo da vaga na calçada): só manobra lenta
  if (!def.sidewalk && world.groundHeight(v.x, v.z) > 0.1) v.speed = Math.max(-1.5, Math.min(2.5, v.speed));
  const steerScale = Math.min(1, Math.abs(v.speed) / 2.5) * Math.sign(v.speed || 1);
  v.heading += intent.steer * def.turnRate * steerScale * dt;
  const nx = v.x + Math.sin(v.heading) * v.speed * dt;
  const nz = v.z + Math.cos(v.heading) * v.speed * dt;
  const ends = def.length ? [def.length / 2 - 0.3, 0, -def.length / 2 + 0.3] : [0];
  const ok = (x: number, z: number) => {
    for (const e of ends) {
      const px = x + Math.sin(v.heading) * e, pz = z + Math.cos(v.heading) * e;
      if (world.isBlockedSurface(px, pz)) return false;
      const g = world.groundHeight(px, pz);
      // carro não SOBE no meio-fio (pode descer da calçada onde estacionou)
      if (!def.sidewalk && g - v.y > 0.05) return false;
      if (g - v.y > 0.3) return false;
    }
    return true;
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

const modelCache = new Map<string, THREE.Group>();
/** modelo por tipo+cor: as instâncias compartilham geometrias e materiais (clone raso do grupo) */
export function rideableModel(kind: RideableKind, color: number): THREE.Group {
  const key = `${kind}:${color}`;
  let proto = modelCache.get(key);
  if (!proto) { proto = buildRideableModel(kind, color); modelCache.set(key, proto); }
  return proto.clone();
}

type V3 = [number, number, number];
/** cilindro entre dois pontos (tubos de quadro, garfo, guidão) */
function tube(a: V3, b: V3, r: number, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  g.deleteAttribute('uv');
  return g;
}
const noUv = (g: THREE.BufferGeometry) => { g.deleteAttribute('uv'); return g; };

/**
 * rodada 10 — montagem: guidão/garfo/roda dianteira num grupo `steer` que gira em torno do eixo de direção
 * (MountRig.steerPivot/steerAxis); as geometrias são escritas no referencial do veículo e deslocadas para o pivô
 */
function steerGroup(kind: RideableKind, meshes: THREE.Mesh[]): THREE.Group {
  const r = mountProfile(kind).rig;
  const sg = new THREE.Group();
  sg.name = 'steer';
  sg.position.set(...r.steerPivot);
  for (const m of meshes) { m.geometry.translate(-r.steerPivot[0], -r.steerPivot[1], -r.steerPivot[2]); sg.add(m); }
  return sg;
}

function buildRideableModel(kind: RideableKind, color: number): THREE.Group {
  // veículos de evento: modelos com LOD próprio e painéis de design (src/vehicles/eventModels.ts)
  if (kind === 'soundcar') return buildSoundcar();
  if (kind === 'trio') return buildTrio();
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7, metalness: 0.2 });
  if (kind === 'bicycle') {
    // bicicleta urbana compartilhada (rodada 10: guidão recuado/alto, pedivela e garfo que giram — o corpo monta de verdade)
    const rearWheel = part(new THREE.TorusGeometry(0.33, 0.035, 8, 24), 0, 0.35, -0.52, 0, Math.PI / 2);
    const frame = mergeGeometries([
      tube([0, 0.86, -0.22], [0, 0.86, 0.42], 0.025), // tubo superior
      tube([0, 0.82, 0.44], [0, 0.33, 0], 0.028), // tubo inferior
      tube([0, 0.33, 0], [0, 0.9, -0.25], 0.025), // tubo do selim
      tube([0, 0.33, 0], [0, 0.35, -0.52], 0.018), // corrente (baixo)
      tube([0, 0.86, -0.22], [0, 0.35, -0.52], 0.018), // traseiro
      tube([0, 0.9, -0.25], [0, 0.94, -0.28], 0.02), // canote
      tube([-0.07, 0.33, 0], [0.07, 0.33, 0], 0.045, 10), // movimento central
    ])!;
    const seat = part(new THREE.BoxGeometry(0.15, 0.05, 0.26), 0, 0.94, -0.3);
    g.add(new THREE.Mesh(rearWheel, dark), new THREE.Mesh(frame, frameMat), new THREE.Mesh(seat, dark));
    const front = mergeGeometries([
      tube([0, 0.86, 0.44], [0, 0.35, 0.52], 0.022), // garfo
      tube([0, 0.86, 0.44], [0, 1.03, 0.41], 0.02), // mesa
      tube([0.2, 1.04, 0.37], [-0.2, 1.04, 0.37], 0.018), // guidão
      tube([0.2, 1.04, 0.37], [0.27, 1.04, 0.29], 0.018), tube([-0.2, 1.04, 0.37], [-0.27, 1.04, 0.29], 0.018),
      part(new THREE.BoxGeometry(0.4, 0.06, 0.3), 0, 0.84, 0.66), // cesta (padrão de bike compartilhada)
    ])!;
    const frontDark = mergeGeometries([
      part(new THREE.TorusGeometry(0.33, 0.035, 8, 24), 0, 0.35, 0.52, 0, Math.PI / 2),
      tube([0.27, 1.04, 0.29], [0.31, 1.04, 0.24], 0.024), tube([-0.27, 1.04, 0.29], [-0.31, 1.04, 0.24], 0.024), // manoplas
    ])!;
    g.add(steerGroup('bicycle', [new THREE.Mesh(front, frameMat), new THREE.Mesh(frontDark, dark)]));
    // pedivela (gira com a pedalada — RideableSystem.sync)
    const crank = new THREE.Group();
    crank.name = 'crank';
    crank.position.set(0, 0.33, 0);
    crank.add(new THREE.Mesh(mergeGeometries([
      tube([0.085, 0, 0], [0.085, 0, 0.17], 0.012), tube([-0.085, 0, 0], [-0.085, 0, -0.17], 0.012),
      part(new THREE.BoxGeometry(0.09, 0.022, 0.06), 0.13, 0, 0.17), part(new THREE.BoxGeometry(0.09, 0.022, 0.06), -0.13, 0, -0.17),
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 16), -0.06, 0, 0, 0, 0, Math.PI / 2), // coroa
    ])!, dark));
    g.add(crank);
  } else if (kind === 'car') {
    // automóvel dirigível: mesmo sedan do trânsito (4,4 m × 1,8 m), cor de destaque via instanceColor.
    // rodada 10 — montagem: vidros translúcidos (motorista visível) + interior simples (bancos, painel, volante que gira)
    const split = getVehicleSplit('sedan');
    const car = new THREE.InstancedMesh(split?.body ?? getVehicleGeometry('sedan', 0, () => legacyGeometry('sedan')), vehicleMaterial(), 1);
    car.setMatrixAt(0, new THREE.Matrix4());
    car.setColorAt(0, new THREE.Color(color));
    car.name = 'car_body';
    g.add(car);
    if (split) {
      const glass = new THREE.Mesh(split.glass, vehicleGlassMaterial(true));
      glass.name = 'car_glass';
      glass.renderOrder = 2;
      glass.userData.noShadow = true;
      g.add(glass);
    }
    g.add(carInterior());
  } else if (kind === 'moto') {
    // moto urbana genérica (~150 cc), 2,1 m: pneus largos com aro, garfo, tanque, banco, motor, escapamento, farol
    const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.85 });
    const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const tires = part(new THREE.TorusGeometry(0.27, 0.085, 10, 28), 0, 0.33, -0.66, 0, Math.PI / 2);
    const rims = mergeGeometries([
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18), 0, 0.33, -0.66, 0, 0, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.035, 0.045, 0.75, 10), 0.17, 0.42, -0.42, Math.PI / 2 - 0.12), // escapamento
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), 0.06, 0.46, -0.45, Math.PI / 2 + 0.35), // balança
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), -0.06, 0.46, -0.45, Math.PI / 2 + 0.35),
      tube([0.12, 0.43, -0.1], [0.26, 0.43, -0.1], 0.018), tube([-0.12, 0.43, -0.1], [-0.26, 0.43, -0.1], 0.018), // pedaleiras
    ])!;
    const body = mergeGeometries([
      part(new THREE.SphereGeometry(0.2, 16, 10).scale(0.85, 0.62, 1.25), 0, 0.88, 0.2), // tanque
      part(new THREE.BoxGeometry(0.2, 0.08, 0.55), 0, 0.84, -0.28), // rabeta
    ])!;
    const dark2 = mergeGeometries([
      part(new THREE.BoxGeometry(0.24, 0.24, 0.36), 0, 0.5, 0.0), // motor
      part(new THREE.BoxGeometry(0.22, 0.07, 0.62), 0, 0.92, -0.18), // banco
      part(new THREE.BoxGeometry(0.2, 0.12, 0.02), 0, 0.68, -0.98), // placa (genérica, sem caracteres)
    ])!;
    const tail = new THREE.Mesh(part(new THREE.BoxGeometry(0.12, 0.05, 0.03), 0, 0.82, -0.57), new THREE.MeshStandardMaterial({ color: 0x8a0d0d, emissive: 0x500000, emissiveIntensity: 0.4 }));
    g.add(new THREE.Mesh(tires, tire), new THREE.Mesh(rims, metal), new THREE.Mesh(body, paint), new THREE.Mesh(dark2, dark), tail);
    // frente que esterça: pneu/aro dianteiros, garfo, guidão, carenagem do farol, para-lama, farol
    const fTire = part(new THREE.TorusGeometry(0.27, 0.075, 10, 28), 0, 0.33, 0.72, 0, Math.PI / 2);
    const fMetal = mergeGeometries([
      part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 18), 0, 0.33, 0.72, 0, 0, Math.PI / 2),
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8), 0.09, 0.62, 0.62, -0.42), // garfo
      part(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8), -0.09, 0.62, 0.62, -0.42),
      part(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), 0, 1.04, 0.47, 0, 0, Math.PI / 2), // guidão
    ])!;
    const fPaint = mergeGeometries([
      part(new THREE.BoxGeometry(0.14, 0.05, 0.5), 0, 0.37 + 0.36, 0.72 - 0.02), // para-lama dianteiro (alto)
      part(new THREE.BoxGeometry(0.2, 0.16, 0.18), 0, 0.98, 0.55), // carenagem do farol
    ])!;
    const grips = mergeGeometries([tube([0.25, 1.04, 0.47], [0.36, 1.04, 0.47], 0.024), tube([-0.25, 1.04, 0.47], [-0.36, 1.04, 0.47], 0.024)])!;
    const lamp = new THREE.Mesh(part(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 14), 0, 0.98, 0.65, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0cc, emissiveIntensity: 0.25, roughness: 0.2 }));
    g.add(steerGroup('moto', [new THREE.Mesh(fTire, tire), new THREE.Mesh(fMetal, metal), new THREE.Mesh(fPaint, paint), new THREE.Mesh(grips, dark), lamp]));
  } else if (kind === 'scooter') {
    const rear = part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), 0, 0.1, -0.42, 0, 0, Math.PI / 2);
    const deck = part(new THREE.BoxGeometry(0.17, 0.06, 0.82), 0, 0.15, 0); // plataforma
    g.add(new THREE.Mesh(rear, dark), new THREE.Mesh(deck, frameMat));
    const stem = mergeGeometries([
      tube([0, 0.16, 0.37], [0, 1.16, 0.49], 0.025, 8), // haste
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 6), 0, 1.16, 0.49, 0, 0, Math.PI / 2), // guidão
    ])!;
    const fw = mergeGeometries([
      part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), 0, 0.1, 0.42, 0, 0, Math.PI / 2),
      tube([0.2, 1.16, 0.49], [0.26, 1.16, 0.49], 0.024), tube([-0.2, 1.16, 0.49], [-0.26, 1.16, 0.49], 0.024), // manoplas
    ])!;
    g.add(steerGroup('scooter', [new THREE.Mesh(stem, frameMat), new THREE.Mesh(fw, dark)]));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noShadow) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/**
 * rodada 10 — interior simples do carro dirigível (sedan): "banheira" escura vista por dentro (esconde o vazio da
 * carroceria através dos vidros), bancos, painel e volante (grupo `steer`, gira com o esterço). 3 draw calls; só perto
 * (RideableSystem.sync esconde de longe e deixa o vidro opaco).
 */
function carInterior(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'car_interior';
  const tub = new THREE.Mesh(noUv(new THREE.BoxGeometry(1.64, 0.62, 2.5)), new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.9, side: THREE.BackSide }));
  tub.position.set(0, 0.61, -0.25);
  tub.userData.noShadow = true;
  const seats = mergeGeometries([
    part(new THREE.BoxGeometry(0.5, 0.12, 0.5), 0.37, 0.4, -0.2), part(new THREE.BoxGeometry(0.5, 0.68, 0.12), 0.37, 0.76, -0.52, -0.18),
    part(new THREE.BoxGeometry(0.5, 0.12, 0.5), -0.37, 0.4, -0.2), part(new THREE.BoxGeometry(0.5, 0.68, 0.12), -0.37, 0.76, -0.52, -0.18),
    part(new THREE.BoxGeometry(0.22, 0.14, 0.1), 0.37, 1.18, -0.6), part(new THREE.BoxGeometry(0.22, 0.14, 0.1), -0.37, 1.18, -0.6), // encostos de cabeça
    part(new THREE.BoxGeometry(1.42, 0.14, 0.5), 0, 0.42, -1.12), part(new THREE.BoxGeometry(1.42, 0.55, 0.12), 0, 0.72, -1.38, -0.2),
    part(new THREE.BoxGeometry(1.62, 0.2, 0.36), 0, 0.88, 0.94), // painel
    part(new THREE.BoxGeometry(0.2, 0.3, 0.7), 0, 0.45, 0.35), // console central
  ])!;
  const inner = new THREE.Mesh(seats, new THREE.MeshStandardMaterial({ color: 0x34363b, roughness: 0.92 }));
  inner.userData.noShadow = true;
  const r = mountProfile('car').rig;
  const sg = new THREE.Group();
  sg.name = 'steer';
  sg.position.set(...r.steerPivot);
  const wheel = new THREE.Mesh(mergeGeometries([
    noUv(new THREE.TorusGeometry(0.19, 0.022, 8, 28)),
    noUv(new THREE.BoxGeometry(0.36, 0.03, 0.02)),
    noUv(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10).rotateX(Math.PI / 2)),
    noUv(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6).rotateX(Math.PI / 2).translate(0, 0, 0.17)), // coluna
  ])!, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 }));
  // plano do volante perpendicular à coluna: o −z local do volante aponta para o motorista (eixo do perfil)
  wheel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...r.steerAxis).normalize());
  wheel.userData.noShadow = true;
  sg.add(wheel);
  g.add(tub, inner, sg);
  return g;
}

// ------------------------------------------------------------------------------- sistema
export interface RideableInstance {
  state: RideableState; def: RideableDef; model: THREE.Group;
  /** estado no servidor: 0 disponível · 1 ocupado · 2 voltando para a vaga */
  netState: number;
  /** design dos painéis (carro de som/trio; 0 = arte neutra padrão) */
  design: number;
  /** rodada 10 — montagem: dinâmica VISUAL (inclinação, esterço, pedivela, velocidade estimada) — calculada aqui
   * pelo deslocamento, igual para o veículo local e os remotos; nada disso vai para a rede */
  dyn: RideDyn;
  /** esterço do motorista LOCAL (entrada, −1..1) — o guidão gira mesmo parado */
  steerHint?: number;
}

/** cores genéricas (sem marcas): carros com paleta de rua, motos e bicicletas/patinetes compartilhados */
const PALETTE: Record<RideableKind, number[]> = {
  car: [0xb3122e, 0xe8e8e8, 0x1a1a1a, 0x8a8f96, 0x1f3a63, 0x7a1a1a, 0xf4f4f0, 0x3d4a3a],
  moto: [0x111111, 0xb31b1b, 0x1d4aa8, 0xe8e8e8, 0x2b2b2b],
  bicycle: [0xe0731c],
  scooter: [0x2e7d4f],
  soundcar: [0xffffff],
  trio: [0xffffff],
};
/** distância de desenho por tipo (m): o trio, alto e iluminado, aparece de longe */
const DRAW_DIST: Record<RideableKind, number> = { car: 400, moto: 220, bicycle: 140, scooter: 140, soundcar: 450, trio: 700 };
const hashId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };

export class RideableSystem {
  readonly group = new THREE.Group();
  readonly items: RideableInstance[] = [];

  readonly byId = new Map<string, RideableInstance>();

  constructor(spawns: { id: string; kind: RideableKind; x: number; z: number; heading: number }[], heightAt: (x: number, z: number) => number, kinds: RideableKind[] = ['bicycle', 'scooter', 'car', 'moto', 'soundcar', 'trio']) {
    this.group.name = 'rideables';
    this.group.userData.category = 'vehicles/rideables';
    for (const sp of spawns) {
      if (!kinds.includes(sp.kind)) continue;
      const state: RideableState = { id: sp.id, kind: sp.kind, x: sp.x, y: heightAt(sp.x, sp.z), z: sp.z, heading: sp.heading, speed: 0, occupant: null };
      const pal = PALETTE[sp.kind] ?? PALETTE.car;
      const color = pal[hashId(sp.id) % pal.length];
      const model = rideableModel(sp.kind, color);
      model.name = `rideable_${sp.id}`;
      this.group.add(model);
      if (EVENT_VEHICLE_KINDS.has(sp.kind)) applyDesign(model, 0);
      const it: RideableInstance = { state, def: RIDEABLE_DEFS[sp.kind], model, netState: 0, design: 0, dyn: { lean: 0, steer: 0, crank: 0, speed: 0, accel: 0 } };
      this.items.push(it);
      this.byId.set(sp.id, it);
    }
    this.sync();
  }

  /** estado vindo do servidor (veículos não controlados localmente): suavizado */
  applyServer(id: string, x: number, y: number, z: number, heading: number, occupant: string, localId: string, netState = 0, design = 0) {
    const it = this.byId.get(id);
    if (!it) return;
    it.state.occupant = occupant || null;
    it.netState = netState;
    if (design !== it.design && EVENT_VEHICLE_KINDS.has(it.def.kind)) { it.design = design; applyDesign(it.model, design); }
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
      if (it.state.occupant || it.netState === 2) continue; // ocupado ou voltando para a vaga
      // carro/moto: alcance pela lateral da carroceria; trio: pela porta da cabine (a escada é para subir)
      const d = it.def.kind === 'trio'
        ? distToCabDoor(x, z, it.state) + (range - TRIO.driveRange)
        : distToVehicle(x, z, { x: it.state.x, z: it.state.z, heading: it.state.heading, kind: it.def.kind }) - (it.def.kind === 'car' || it.def.kind === 'soundcar' ? 0.2 : it.def.kind === 'moto' ? 0.8 : 0);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** trio cujo pé da escada está ao alcance (subir na plataforma) */
  nearestLadder(x: number, z: number): RideableInstance | null {
    for (const it of this.items) {
      if (it.def.kind !== 'trio' || it.netState === 2) continue;
      const f = localToWorld(it.state, TRIO.ladderFoot[0], TRIO.ladderFoot[1]);
      if (Math.hypot(x - f.x, z - f.z) <= TRIO.boardRange) return it;
    }
    return null;
  }

  /** veículos de evento (sólidos para quem anda e para os outros veículos) */
  eventItems(): RideableInstance[] { return this.items.filter((it) => EVENT_VEHICLE_KINDS.has(it.def.kind)); }

  /** pontos de concentração da multidão (src/social/rally.ts): seguem o trio/carro de som quando andam */
  private rallyAt = new Map<string, { x: number; z: number }>();
  private updateRally() {
    for (const it of this.items) {
      const k = it.def.kind;
      if (k !== 'trio' && k !== 'soundcar') continue;
      const last = this.rallyAt.get(it.state.id);
      if (last && Math.hypot(last.x - it.state.x, last.z - it.state.z) < 0.5) continue;
      this.rallyAt.set(it.state.id, { x: it.state.x, z: it.state.z });
      const sh = RALLY_SHAPE[k];
      rallyPoints.upsert({
        id: `veh_${it.state.id}`, kind: k, x: it.state.x, z: it.state.z,
        inner: sh.inner, radius: sh.radius, strength: sh.strength,
        actionWeights: RALLY_DEFAULT_WEIGHTS[k],
      });
    }
  }

  sync(cam?: THREE.Vector3) {
    // rodada 10 — montagem: dinâmica visual pelo tempo real entre chamadas (duas chamadas no mesmo quadro: dt ≈ 0, pula)
    const now = performance.now();
    const dt = (now - this.lastSync) / 1000;
    this.lastSync = now;
    const stepDyn = dt > 0.002 && dt < 0.5;
    for (const it of this.items) {
      const s = it.state;
      if (stepDyn) this.dynamics(it, dt);
      it.model.position.set(s.x, s.y, s.z);
      it.model.rotation.set(0, s.heading, -it.dyn.lean); // inclinação em torno do eixo longitudinal (contato no chão)
      const d = cam ? Math.hypot(s.x - cam.x, s.z - cam.z) : 0;
      it.model.visible = !cam || d < DRAW_DIST[it.def.kind];
      if (it.model.visible) this.applyParts(it, d);
    }
    this.updateRally();
  }

  private lastSync = performance.now();
  private prev = new Map<RideableInstance, { x: number; z: number; h: number }>();
  private parts = new Map<RideableInstance, { steer: THREE.Object3D | null; crank: THREE.Object3D | null; interior: THREE.Object3D | null; glass: THREE.Mesh | null; axis: THREE.Vector3; max: number; near: boolean }>();

  /** velocidade/aceleração/giro estimados pelo deslocamento → esterço, inclinação (duas rodas) e pedivela */
  private dynamics(it: RideableInstance, dt: number) {
    const s = it.state, d = it.dyn;
    const p = this.prev.get(it);
    if (!p) { this.prev.set(it, { x: s.x, z: s.z, h: s.heading }); return; }
    const dx = s.x - p.x, dz = s.z - p.z, dist = Math.hypot(dx, dz);
    const jump = dist > 6; // volta para a vaga / correção grande: não é velocidade
    const v = jump ? 0 : (dx * Math.sin(s.heading) + dz * Math.cos(s.heading)) / dt;
    const yaw = jump ? 0 : angleDelta(p.h, s.heading) / dt;
    p.x = s.x; p.z = s.z; p.h = s.heading;
    const prevSpeed = d.speed;
    d.speed += (v - d.speed) * (1 - Math.exp(-8 * dt));
    d.accel += ((d.speed - prevSpeed) / dt - d.accel) * (1 - Math.exp(-4 * dt));
    const rig = mountProfile(it.def.kind).rig;
    const sp = Math.abs(d.speed);
    let steerT = sp > 0.25 ? THREE.MathUtils.clamp(yaw / (it.def.turnRate * Math.max(0.2, Math.min(1, sp / 2.5))) * Math.sign(d.speed), -1, 1) : 0;
    if (it.steerHint !== undefined && it.state.occupant) steerT = THREE.MathUtils.clamp(it.steerHint, -1, 1);
    d.steer += (steerT - d.steer) * (1 - Math.exp(-10 * dt));
    const leanT = it.state.occupant ? THREE.MathUtils.clamp(Math.atan((d.speed * yaw) / 9.81), -rig.leanMax, rig.leanMax) : 0;
    d.lean += (leanT - d.lean) * (1 - Math.exp(-6 * dt));
    if (rig.crank && it.state.occupant && sp > 0.3 && d.accel > -0.35) d.crank = (d.crank + (d.speed * dt / rig.crank.mPerRev) * Math.PI * 2) % (Math.PI * 2);
  }

  /** guidão/volante, pedivela; carro: interior e vidro translúcido só de perto (longe: vidro opaco, sem interior) */
  private applyParts(it: RideableInstance, dist: number) {
    let pt = this.parts.get(it);
    if (!pt) {
      const rig = mountProfile(it.def.kind).rig;
      pt = {
        steer: it.model.getObjectByName('steer') ?? null, crank: it.model.getObjectByName('crank') ?? null,
        interior: it.model.getObjectByName('car_interior') ?? null, glass: (it.model.getObjectByName('car_glass') as THREE.Mesh) ?? null,
        axis: new THREE.Vector3(...rig.steerAxis).normalize(), max: rig.steerMax, near: true,
      };
      this.parts.set(it, pt);
    }
    pt.steer?.quaternion.setFromAxisAngle(pt.axis, it.dyn.steer * pt.max);
    if (pt.crank) pt.crank.rotation.x = it.dyn.crank;
    if (pt.interior || pt.glass) {
      const near = dist < 45;
      if (near !== pt.near) {
        pt.near = near;
        if (pt.interior) pt.interior.visible = near;
        if (pt.glass) pt.glass.material = vehicleGlassMaterial(near);
      }
    }
  }
}
