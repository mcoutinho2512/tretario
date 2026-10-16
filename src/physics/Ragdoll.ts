/**
 * Ragdoll com Rapier (Apache-2.0, WASM) sobre o esqueleto de 17 ossos (ADR-005/012).
 * Puramente VISUAL/local: o resultado autoritativo (posição de repouso, tempo no chão) vem do servidor.
 * O módulo do Rapier é carregado sob demanda (chunk separado) — `preloadRagdoll()` no multiplayer.
 *
 * Mapeamento: cada osso com corpo vira um corpo rígido cujo referencial = referencial do osso no início;
 * colisor em cápsula alinhado ao segmento osso→filho; juntas esféricas na origem do osso filho.
 * A cada passo, a rotação de mundo do corpo é convertida em rotação LOCAL do osso.
 */
import * as THREE from 'three';
import type { CharacterRig, BoneName } from '../characters/CharacterMesh';
import type { Seg } from './walls';

type R = typeof import('@dimforge/rapier3d-compat');
let RAPIER: R | null = null;
let loading: Promise<R> | null = null;

export function preloadRagdoll(): Promise<R> {
  if (RAPIER) return Promise.resolve(RAPIER);
  loading ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    const mod = (m as unknown as { default?: R }).default ?? (m as unknown as R);
    await mod.init();
    RAPIER = mod;
    return mod;
  });
  return loading;
}
export const ragdollReady = () => !!RAPIER;

/** corpos: osso → osso "filho" que define o comprimento do segmento */
const BODIES: [BoneName, BoneName | null, number][] = [
  ['Hips', 'Spine', 0.13],
  ['Spine', 'Chest', 0.13],
  ['Chest', 'Neck', 0.15],
  ['Head', null, 0.11],
  ['LeftUpperArm', 'LeftLowerArm', 0.05],
  ['LeftLowerArm', 'LeftHand', 0.045],
  ['RightUpperArm', 'RightLowerArm', 0.05],
  ['RightLowerArm', 'RightHand', 0.045],
  ['LeftUpperLeg', 'LeftLowerLeg', 0.075],
  ['LeftLowerLeg', 'LeftFoot', 0.06],
  ['RightUpperLeg', 'RightLowerLeg', 0.075],
  ['RightLowerLeg', 'RightFoot', 0.06],
];
const PARENT: Partial<Record<BoneName, BoneName>> = {
  Spine: 'Hips', Chest: 'Spine', Head: 'Chest',
  LeftUpperArm: 'Chest', LeftLowerArm: 'LeftUpperArm', RightUpperArm: 'Chest', RightLowerArm: 'RightUpperArm',
  LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg',
};

export interface RagdollParams {
  /** direção (mundo) e força do impulso */
  dirX: number; dirZ: number; strength: number;
  groundY: number;
  walls: Seg[];
}

export class Ragdoll {
  private world: InstanceType<R['World']>;
  private bodies = new Map<BoneName, InstanceType<R['RigidBody']>>();
  private acc = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();

  private constructor(private rig: CharacterRig, p: RagdollParams) {
    const RP = RAPIER!;
    this.world = new RP.World({ x: 0, y: -9.81, z: 0 });
    // ambiente: chão + paredes próximas (grupo 1); corpos do boneco (grupo 2) só colidem com o ambiente
    const ENV = (0x0001 << 16) | 0xffff, BODY = (0x0002 << 16) | 0x0001;
    const mesh = rig.mesh;
    mesh.updateMatrixWorld(true);
    const hips = rig.bones.Hips.getWorldPosition(new THREE.Vector3());
    this.world.createCollider(RP.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(hips.x, p.groundY - 0.5, hips.z).setFriction(0.9).setCollisionGroups(ENV));
    for (const s of p.walls) {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      if (len < 0.05) continue;
      const h = Math.min(s.top, 6) - s.bottom;
      if (h <= 0.1) continue;
      const ang = Math.atan2(s.bz - s.az, s.bx - s.ax);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      this.world.createCollider(RP.ColliderDesc.cuboid(len / 2, h / 2, 0.08)
        .setTranslation((s.ax + s.bx) / 2, s.bottom + h / 2 + p.groundY * 0, (s.az + s.bz) / 2)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(ENV));
    }
    const b = rig.bones;
    const posOf = (n: BoneName) => b[n].getWorldPosition(new THREE.Vector3());
    for (const [name, child, radius] of BODIES) {
      const P = posOf(name);
      const Q = b[name].getWorldQuaternion(new THREE.Quaternion());
      const body = this.world.createRigidBody(RP.RigidBodyDesc.dynamic()
        .setTranslation(P.x, P.y, P.z).setRotation({ x: Q.x, y: Q.y, z: Q.z, w: Q.w })
        .setLinearDamping(0.4).setAngularDamping(2.2).setCcdEnabled(true));
      // segmento até o filho, no referencial local do corpo
      const end = child ? posOf(child) : P.clone().add(new THREE.Vector3(0, 0.2, 0).applyQuaternion(Q));
      const d = end.clone().sub(P).applyQuaternion(Q.clone().invert());
      const len = Math.max(0.05, d.length());
      const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      const cd = name === 'Head'
        ? RP.ColliderDesc.ball(radius).setTranslation(d.x / 2, d.y / 2, d.z / 2)
        : RP.ColliderDesc.capsule(Math.max(0.01, len / 2 - radius * 0.6), radius).setTranslation(d.x / 2, d.y / 2, d.z / 2).setRotation({ x: align.x, y: align.y, z: align.z, w: align.w });
      this.world.createCollider(cd.setDensity(name === 'Hips' || name === 'Chest' ? 1100 : 900).setFriction(0.8).setCollisionGroups(BODY), body);
      this.bodies.set(name, body);
    }
    // juntas esféricas na origem do osso filho
    for (const [name] of BODIES) {
      const parent = PARENT[name];
      if (!parent) continue;
      const pb = this.bodies.get(parent)!, cb = this.bodies.get(name)!;
      const Pp = posOf(parent), Qp = b[parent].getWorldQuaternion(new THREE.Quaternion());
      const anchor = posOf(name).sub(Pp).applyQuaternion(Qp.invert());
      const j = this.world.createImpulseJoint(RP.JointData.spherical({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 }), pb, cb, true);
      j.setContactsEnabled(false);
    }
    // impulso: corpo inteiro na direção, com componente vertical; tronco recebe mais (tropeça para trás)
    const s = p.strength;
    for (const [name, body] of this.bodies) {
      const k = name === 'Chest' || name === 'Spine' || name === 'Head' ? 1.35 : name.includes('Leg') ? 0.55 : 1;
      body.setLinvel({ x: p.dirX * s * 1.9 * k, y: 1.2 + s * 0.35, z: p.dirZ * s * 1.9 * k }, true);
    }
  }

  static async create(rig: CharacterRig, p: RagdollParams): Promise<Ragdoll> {
    await preloadRagdoll();
    return new Ragdoll(rig, p);
  }

  /** avança a física e escreve a pose nos ossos */
  update(dt: number) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= 1 / 60) {
      this.world.timestep = 1 / 60;
      this.world.step();
      this.acc -= 1 / 60;
    }
    const b = this.rig.bones;
    const mesh = this.rig.mesh;
    mesh.updateMatrixWorld(true);
    // quadril: posição + rotação relativas ao mesh
    const hb = this.bodies.get('Hips')!;
    const t = hb.translation(), r = hb.rotation();
    this.tmpM.copy(mesh.matrixWorld).invert();
    this.tmpV.set(t.x, t.y, t.z).applyMatrix4(this.tmpM);
    b.Hips.position.copy(this.tmpV);
    mesh.getWorldQuaternion(this.tmpQ2);
    b.Hips.quaternion.copy(this.tmpQ2.invert().multiply(this.tmpQ.set(r.x, r.y, r.z, r.w)));
    b.Hips.updateMatrixWorld(true);
    for (const [name] of BODIES) {
      if (name === 'Hips') continue;
      const bone = b[name];
      const rr = this.bodies.get(name)!.rotation();
      bone.parent!.getWorldQuaternion(this.tmpQ2);
      bone.quaternion.copy(this.tmpQ2.invert().multiply(this.tmpQ.set(rr.x, rr.y, rr.z, rr.w)));
      bone.updateMatrixWorld(true);
    }
  }

  /** posição de mundo do quadril (para reposicionar o personagem ao levantar) */
  hipsWorld(): THREE.Vector3 {
    const t = this.bodies.get('Hips')!.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  dispose() {
    this.world.free();
  }
}
