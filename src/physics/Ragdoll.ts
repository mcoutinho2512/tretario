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

/**
 * rodada 10 — limites (rad) das dobradiças das pernas em torno do eixo lateral (+ = esquerda do corpo): quadril
 * flexiona para a frente (−) até ~100° e estende 30°; joelho só dobra para trás (+) até ~130°
 */
const HINGE: Partial<Record<BoneName, [number, number]>> = {
  LeftUpperLeg: [-1.75, 0.5], RightUpperLeg: [-1.75, 0.5], LeftLowerLeg: [0, 2.3], RightLowerLeg: [0, 2.3],
};

export interface RagdollParams {
  /** direção (mundo) e força do impulso */
  dirX: number; dirZ: number; strength: number;
  groundY: number;
  walls: Seg[];
}

export class Ragdoll {
  /** mundos Rapier vivos (QA de vazamento: volta a 0 quando ninguém está caído) */
  static live = 0;
  private freed = false;
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
    Ragdoll.live++;
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
    // juntas na origem do osso filho (esféricas; coluna rígida e pernas em dobradiça — rodada 10)
    const lateral = posOf('LeftUpperLeg').sub(posOf('RightUpperLeg')).normalize();
    const hingeZero = new Map<BoneName, number>();
    for (const [name] of BODIES) {
      const parent = PARENT[name];
      if (!parent) continue;
      const pb = this.bodies.get(parent)!, cb = this.bodies.get(name)!;
      const Pp = posOf(parent), Qp = b[parent].getWorldQuaternion(new THREE.Quaternion());
      const anchor = posOf(name).sub(Pp).applyQuaternion(Qp.clone().invert());
      // rodada 10: a coluna (quadril–lombar–peito) é RÍGIDA. Com juntas esféricas sem limite o quadril girava até
      // ~180° em relação ao peito (peito para cima, quadril de lado/para baixo) e o levantar misturava essa torção:
      // pernas a 0,4–1,2 m do chão. As demais juntas continuam esféricas (queda solta de braços, pernas e cabeça).
      let jd;
      if (name === 'Spine' || name === 'Chest') {
        const Qc = b[name].getWorldQuaternion(new THREE.Quaternion());
        const f1 = Qp.clone().invert(), f2 = Qc.invert();
        jd = RP.JointData.fixed({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: f1.x, y: f1.y, z: f1.z, w: f1.w }, { x: 0, y: 0, z: 0 }, { x: f2.x, y: f2.y, z: f2.z, w: f2.w });
      } else if (HINGE[name]) {
        // quadril e joelho: dobradiça no eixo lateral do corpo, com limites (as pernas dobravam para o lado da
        // cabeça e cruzavam — "pernas para o ar" no levantar). Ângulo 0 = pose do início da queda.
        const Qc = b[name].getWorldQuaternion(new THREE.Quaternion());
        const a1 = lateral.clone().applyQuaternion(Qp.clone().invert()), a2 = lateral.clone().applyQuaternion(Qc.invert());
        jd = RP.JointData.revoluteWithAxes({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 }, { x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z });
        // o ângulo 0 do Rapier é o dos referenciais mínimos x→eixo de cada corpo, não a pose atual: compensa
        const X = new THREE.Vector3(1, 0, 0);
        const f1 = Qp.clone().multiply(new THREE.Quaternion().setFromUnitVectors(X, a1.clone().normalize()));
        const f2 = Qc.clone().multiply(new THREE.Quaternion().setFromUnitVectors(X, a2.clone().normalize()));
        const rel = f1.invert().multiply(f2);
        hingeZero.set(name, 2 * Math.atan2(rel.x, rel.w));
      } else jd = RP.JointData.spherical({ x: anchor.x, y: anchor.y, z: anchor.z }, { x: 0, y: 0, z: 0 });
      const j = this.world.createImpulseJoint(jd, pb, cb, true);
      const lim = HINGE[name], z0 = hingeZero.get(name) ?? 0;
      if (lim && 'setLimits' in j) (j as unknown as { setLimits(a: number, b: number): void }).setLimits(z0 + lim[0], z0 + lim[1]);
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
    // referencial do PAI do quadril (no rig antigo é a malha; no humano é o osso "Root")
    const hipsParent = b.Hips.parent ?? mesh;
    hipsParent.updateMatrixWorld(true);
    this.tmpM.copy(hipsParent.matrixWorld).invert();
    this.tmpV.set(t.x, t.y, t.z).applyMatrix4(this.tmpM);
    b.Hips.position.copy(this.tmpV);
    hipsParent.getWorldQuaternion(this.tmpQ2);
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

  /** libera o mundo WASM (idempotente) */
  dispose() {
    if (this.freed) return;
    this.freed = true;
    Ragdoll.live--;
    this.world.free();
  }
}
