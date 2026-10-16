/**
 * Animação procedural sobre os ossos: idle (respiração), walk, run, ar (pulo/queda).
 * A passada é sincronizada à velocidade real (sem "patinar"). Postura curvada para idosos.
 * Lê apenas (speed, grounded) — funciona igual para jogador local, NPC e jogador remoto.
 */
import * as THREE from 'three';
import type { CharacterRig } from './CharacterMesh';
import { BODY_TYPES } from './bodyTypes';

export class CharacterAnimator {
  private phase = Math.random() * Math.PI * 2;
  private walkW = 0;
  private runW = 0;
  private airW = 0;
  private t = Math.random() * 10;
  private baseHipsY: number;

  constructor(private rig: CharacterRig, private walkSpeed = 1.8, private runSpeed = 5.2) {
    this.baseHipsY = rig.bones.Hips.position.y;
  }

  update(speed: number, grounded: boolean, dt: number) {
    const p = BODY_TYPES[this.rig.body];
    const b = this.rig.bones;
    this.t += dt;
    const k = 1 - Math.exp(-8 * dt);
    const ws = this.walkSpeed * p.speedFactor, rs = this.runSpeed * p.speedFactor;
    const wTarget = grounded ? THREE.MathUtils.clamp(speed / ws, 0, 1) : 0;
    const rTarget = grounded ? THREE.MathUtils.clamp((speed - ws) / Math.max(0.1, rs - ws), 0, 1) : 0;
    this.walkW += (wTarget - this.walkW) * k;
    this.runW += (rTarget - this.runW) * k;
    this.airW += ((grounded ? 0 : 1) - this.airW) * (1 - Math.exp(-10 * dt));
    const W = this.walkW, R = this.runW, A = this.airW;

    const stride = THREE.MathUtils.lerp(1.35, 2.6, R) * p.strideFactor * (p.height / 1.76);
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const ph = this.phase;
    const sin = Math.sin(ph), cos = Math.cos(ph);
    const oldAmp = 1 - p.posture * 0.35;

    // pernas
    const thighAmp = THREE.MathUtils.lerp(0.42, 0.85, R) * W * oldAmp;
    const kneeAmp = THREE.MathUtils.lerp(0.55, 1.45, R) * W * oldAmp;
    for (const [side, off] of [['Left', 0], ['Right', Math.PI]] as const) {
      const s1 = Math.sin(ph + off), c1 = Math.cos(ph + off);
      b[`${side}UpperLeg`].rotation.x = -s1 * thighAmp - A * 0.6 + R * 0.12 + p.posture * 0.08;
      b[`${side}LowerLeg`].rotation.x = Math.max(0, c1) * kneeAmp + 0.05 + A * 1.1 + p.posture * 0.12;
      b[`${side}Foot`].rotation.x = -Math.max(0, -s1) * 0.3 * W - A * 0.2;
    }
    // braços em oposição
    const armAmp = THREE.MathUtils.lerp(0.35, 0.95, R) * W * oldAmp;
    const elbow = THREE.MathUtils.lerp(0.25, 1.45, R);
    for (const [side, off, s] of [['Left', Math.PI, 1], ['Right', 0, -1]] as const) {
      const s1 = Math.sin(ph + off);
      const breathe = Math.sin(this.t * 1.6) * 0.02 * (1 - W);
      b[`${side}UpperArm`].rotation.x = -s1 * armAmp + breathe - A * 0.8 + p.posture * 0.15;
      b[`${side}UpperArm`].rotation.z = s * (0.09 + A * 0.5);
      b[`${side}LowerArm`].rotation.x = -(elbow * (0.6 + 0.4 * W) + Math.max(0, s1) * 0.3 * R) * Math.max(W, 0.25) - p.posture * 0.3;
    }
    // tronco e cabeça
    const bob = (Math.abs(cos) * THREE.MathUtils.lerp(0.035, 0.08, R) - 0.02) * W;
    b.Hips.position.y = this.baseHipsY + bob - R * 0.04 - p.posture * 0.03;
    b.Hips.rotation.y = sin * 0.12 * W;
    b.Spine.rotation.x = R * 0.2 + W * 0.04 + p.posture * 0.28;
    b.Chest.rotation.x = p.posture * 0.12;
    b.Chest.rotation.y = -sin * 0.18 * W;
    const breath = 1 + Math.sin(this.t * 1.6) * 0.012;
    b.Chest.scale.set(1, breath, 1);
    b.Neck.rotation.x = -p.posture * 0.3;
    b.Head.rotation.x = -R * 0.15 + Math.sin(this.t * 0.4) * 0.03 * (1 - W) - p.posture * 0.1;
    b.Head.rotation.y = Math.sin(this.t * 0.31) * 0.15 * (1 - W);
  }
}
