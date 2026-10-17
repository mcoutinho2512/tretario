/**
 * Boneco de treino (rodada 9) — visual PROCEDURAL e estilizado (poste de madeira, corpo de lona acolchoada, braços em
 * T, cabeça lisa sem rosto): claramente um objeto, não uma pessoa. O estado vem do servidor (`cbt_dummy`/`cbt_hit`):
 * cambaleia (mola amortecida na direção do golpe), tomba sobre a base quando cai e volta a ficar de pé.
 */
import * as THREE from 'three';
import { PHYS } from './types';

let shared: { geo: Record<string, THREE.BufferGeometry>; mat: Record<string, THREE.Material> } | null = null;
function parts() {
  if (shared) return shared;
  const geo = {
    base: new THREE.CylinderGeometry(0.42, 0.48, 0.12, 20),
    post: new THREE.CylinderGeometry(0.06, 0.07, 1.0, 10),
    body: new THREE.CylinderGeometry(0.24, 0.27, 0.72, 16),
    band: new THREE.CylinderGeometry(0.255, 0.255, 0.08, 16),
    arm: new THREE.CylinderGeometry(0.06, 0.06, 0.95, 8),
    head: new THREE.SphereGeometry(0.16, 16, 12),
  };
  const mat = {
    base: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.8 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.95 }),
    band: new THREE.MeshStandardMaterial({ color: 0x9b3b2e, roughness: 0.9 }),
  };
  shared = { geo, mat };
  return shared;
}

export class DummyVisual {
  readonly root = new THREE.Group();
  /** pivô na base: tomba/oscila em torno dele */
  private pivot = new THREE.Group();
  st: number = PHYS.NORMAL;
  cond = 100;
  /** inclinação atual (rad) e velocidade, eixo horizontal do tombo */
  private tilt = 0;
  private vel = 0;
  private axis = new THREE.Vector3(1, 0, 0);
  private target = 0;

  constructor(readonly id: number, x: number, y: number, z: number, heading: number) {
    const { geo, mat } = parts();
    const m = (g: THREE.BufferGeometry, mm: THREE.Material, py: number, rz = 0) => { const o = new THREE.Mesh(g, mm); o.position.y = py; o.rotation.z = rz; o.castShadow = true; o.receiveShadow = true; return o; };
    this.root.name = 'training_dummy';
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.root.add(m(geo.base, mat.base, 0.06));
    this.pivot.position.y = 0.12;
    this.root.add(this.pivot);
    this.pivot.add(m(geo.post, mat.wood, 0.5), m(geo.body, mat.canvas, 1.05), m(geo.band, mat.band, 1.12), m(geo.arm, mat.wood, 1.25, Math.PI / 2), m(geo.head, mat.canvas, 1.6));
  }

  /** estado autoritativo (servidor) */
  setState(st: number, cond: number) {
    this.cond = cond;
    if (st === this.st) return;
    this.st = st;
    this.target = st === PHYS.KNOCKED_DOWN ? 1.45 : 0;
  }

  /** golpe decidido pelo servidor: direção (mundo) e novo estado */
  hit(dx: number, dz: number, st: number) {
    // eixo do tombo: horizontal, perpendicular à direção do golpe, no espaço do boneco
    const inv = -this.root.rotation.y;
    const lx = dx * Math.cos(inv) + dz * Math.sin(inv), lz = -dx * Math.sin(inv) + dz * Math.cos(inv);
    this.axis.set(lz, 0, -lx).normalize();
    if (this.axis.lengthSq() < 0.5) this.axis.set(1, 0, 0);
    this.vel += st === PHYS.KNOCKED_DOWN ? 4.5 : 3.2;
    this.setState(st, this.cond);
  }

  update(dt: number) {
    // mola amortecida em direção ao alvo (de pé = 0, caído = ~83°); levantar é mais lento
    const k = this.target > 0 ? 40 : this.st === PHYS.GETTING_UP ? 9 : 55, c = this.target > 0 ? 9 : 7;
    this.vel += ((this.target - this.tilt) * k - this.vel * c) * dt;
    this.tilt = Math.max(-0.4, Math.min(1.5, this.tilt + this.vel * dt));
    this.pivot.quaternion.setFromAxisAngle(this.axis, this.tilt);
  }

  dispose() { this.root.removeFromParent(); }
}
