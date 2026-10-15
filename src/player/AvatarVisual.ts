/**
 * Avatar humano TEMPORÁRIO (placeholder original, procedural — sem assets externos).
 * Hierarquia articulada (quadril → coluna → peito → braços/cabeça; quadril → pernas) animada
 * proceduralmente: idle (respiração), walk e run com ciclo de passada sincronizado à velocidade.
 * Substituir futuramente por personagem rigado (GLB + animações) — ver docs/ASSET_LICENSES.md.
 */
import * as THREE from 'three';
import type { PlayerState } from './PlayerState';
import { PLAYER_CONSTANTS } from './PlayerState';

const SKIN = 0xb98a68;
const SHIRT = 0x2f6f8f;
const JEANS = 0x2c3a52;
const SHOE = 0xe8e8e2;
const HAIR = 0x1d1714;

function mat(color: number, rough = 0.8) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

function capsule(r: number, len: number, m: THREE.Material, yOffset = -len / 2 - r) {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.translate(0, yOffset, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

interface Limb { upper: THREE.Object3D; lower: THREE.Object3D; end: THREE.Object3D }

export class AvatarVisual {
  readonly root = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private chest = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private armL!: Limb;
  private armR!: Limb;
  private legL!: Limb;
  private legR!: Limb;
  private phase = 0;
  private walkW = 0;
  private runW = 0;
  private airW = 0;
  private t = 0;
  private smoothY = 0;
  private initialized = false;

  constructor() {
    const skin = mat(SKIN, 0.7), shirt = mat(SHIRT, 0.85), jeans = mat(JEANS, 0.9), shoe = mat(SHOE, 0.6), hair = mat(HAIR, 0.9);
    this.root.name = 'avatar_placeholder';
    this.hips.position.y = 0.96;
    this.root.add(this.hips);
    // pelve
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 10).rotateZ(Math.PI / 2), jeans);
    pelvis.scale.set(1, 1, 0.75);
    pelvis.castShadow = true;
    this.hips.add(pelvis);
    // coluna/tronco
    this.spine.position.y = 0.06;
    this.hips.add(this.spine);
    const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.155, 0.22, 12), shirt);
    abdomen.position.y = 0.12;
    abdomen.scale.z = 0.72;
    abdomen.castShadow = true;
    this.spine.add(abdomen);
    this.chest.position.y = 0.22;
    this.spine.add(this.chest);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.14, 4, 12), shirt);
    torso.position.y = 0.12;
    torso.scale.set(1.08, 1, 0.68);
    torso.castShadow = true;
    this.chest.add(torso);
    // pescoço e cabeça
    this.neck.position.y = 0.33;
    this.chest.add(this.neck);
    const neckM = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
    neckM.position.y = 0.04;
    this.neck.add(neckM);
    this.head.position.y = 0.1;
    this.neck.add(this.head);
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin);
    headM.scale.set(0.92, 1.12, 1.0);
    headM.position.y = 0.1;
    headM.castShadow = true;
    this.head.add(headM);
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairM.scale.set(0.95, 1.1, 1.05);
    hairM.position.set(0, 0.115, -0.008);
    this.head.add(hairM);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 6).rotateX(Math.PI / 2), skin);
    nose.position.set(0, 0.09, 0.105);
    this.head.add(nose);

    const makeArm = (side: number): Limb => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.2, 0.25, 0);
      this.chest.add(upper);
      upper.add(capsule(0.052, 0.18, shirt));
      const lower = new THREE.Group();
      lower.position.y = -0.29;
      upper.add(lower);
      lower.add(capsule(0.042, 0.19, skin));
      const end = new THREE.Group();
      end.position.y = -0.28;
      lower.add(end);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin);
      hand.scale.set(0.8, 1.2, 0.6);
      hand.position.y = -0.04;
      hand.castShadow = true;
      end.add(hand);
      return { upper, lower, end };
    };
    const makeLeg = (side: number): Limb => {
      const upper = new THREE.Group();
      upper.position.set(side * 0.095, -0.02, 0);
      this.hips.add(upper);
      upper.add(capsule(0.075, 0.3, jeans));
      const lower = new THREE.Group();
      lower.position.y = -0.45;
      upper.add(lower);
      lower.add(capsule(0.06, 0.32, jeans));
      const end = new THREE.Group();
      end.position.y = -0.46;
      lower.add(end);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe);
      foot.geometry.translate(0, -0.015, 0.05);
      foot.castShadow = true;
      end.add(foot);
      return { upper, lower, end };
    };
    this.armL = makeArm(1);
    this.armR = makeArm(-1);
    this.legL = makeLeg(1);
    this.legR = makeLeg(-1);
  }

  update(s: PlayerState, dt: number) {
    this.t += dt;
    const C = PLAYER_CONSTANTS;
    if (!this.initialized) { this.smoothY = s.y; this.initialized = true; }
    // suaviza degraus (meio-fio) visualmente
    this.smoothY += (s.y - this.smoothY) * (1 - Math.exp(-18 * dt));
    if (Math.abs(s.y - this.smoothY) > 0.6) this.smoothY = s.y;
    this.root.position.set(s.x, this.smoothY, s.z);
    this.root.rotation.y = s.heading;

    const speed = s.speed;
    const k = 1 - Math.exp(-8 * dt);
    const wTarget = s.grounded ? THREE.MathUtils.clamp(speed / C.walkSpeed, 0, 1) : 0;
    const rTarget = s.grounded ? THREE.MathUtils.clamp((speed - C.walkSpeed) / (C.runSpeed - C.walkSpeed), 0, 1) : 0;
    this.walkW += (wTarget - this.walkW) * k;
    this.runW += (rTarget - this.runW) * k;
    this.airW += ((s.grounded ? 0 : 1) - this.airW) * (1 - Math.exp(-10 * dt));

    // passada: comprimento cresce com a velocidade → fase sincronizada (sem patinar)
    const stride = THREE.MathUtils.lerp(1.35, 2.6, this.runW);
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const ph = this.phase;
    const sin = Math.sin(ph), cos = Math.cos(ph);
    const W = this.walkW, R = this.runW;

    // pernas
    const thighAmp = THREE.MathUtils.lerp(0.42, 0.85, R) * W;
    const kneeAmp = THREE.MathUtils.lerp(0.55, 1.45, R) * W;
    const legs: [Limb, number][] = [[this.legL, 0], [this.legR, Math.PI]];
    for (const [leg, off] of legs) {
      const s1 = Math.sin(ph + off);
      const c1 = Math.cos(ph + off);
      leg.upper.rotation.x = -s1 * thighAmp - this.airW * 0.6 + R * 0.12;
      leg.lower.rotation.x = Math.max(0, c1) * kneeAmp + 0.05 + this.airW * 1.1;
      leg.end.rotation.x = -Math.max(0, -s1) * 0.3 * W - this.airW * 0.2;
    }
    // braços (oposição às pernas)
    const armAmp = THREE.MathUtils.lerp(0.35, 0.95, R) * W;
    const elbow = THREE.MathUtils.lerp(0.25, 1.45, R);
    const arms: [Limb, number, number][] = [[this.armL, Math.PI, 1], [this.armR, 0, -1]];
    for (const [arm, off, side] of arms) {
      const s1 = Math.sin(ph + off);
      const breathe = Math.sin(this.t * 1.6) * 0.02 * (1 - W);
      arm.upper.rotation.x = -s1 * armAmp + breathe - this.airW * 0.8;
      arm.upper.rotation.z = side * (0.09 + this.airW * 0.5);
      arm.lower.rotation.x = -(elbow * (0.6 + 0.4 * W) + Math.max(0, s1) * 0.3 * R) * Math.max(W, 0.25);
    }
    // tronco
    const bob = (Math.abs(cos) * THREE.MathUtils.lerp(0.035, 0.08, R) - 0.02) * W;
    this.hips.position.y = 0.96 + bob - R * 0.04;
    this.hips.rotation.y = sin * 0.12 * W;
    this.spine.rotation.x = R * 0.2 + W * 0.04;
    this.chest.rotation.y = -sin * 0.18 * W;
    const breath = 1 + Math.sin(this.t * 1.6) * 0.012;
    this.chest.scale.set(1, breath, 1);
    this.head.rotation.x = -R * 0.15 + Math.sin(this.t * 0.4) * 0.03 * (1 - W);
    this.head.rotation.y = Math.sin(this.t * 0.31) * 0.15 * (1 - W);
  }
}
