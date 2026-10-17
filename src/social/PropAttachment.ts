/**
 * Itens na mão de UM personagem com esqueleto (bandeira, cartaz, megafone…). Esqueleto distante/instanciado usa
 * o instanciador de itens da multidão (`props/PropInstancer`), não esta classe.
 *
 * Geometria e materiais são COMPARTILHADOS (props/propGeometry, props/propMaterials): por personagem só existem
 * alguns `Mesh`/`Group` leves. Pegadas em props/grips.ts:
 *  - `bone`: o item é filho do osso da mão (segue o punho; balançar a bandeira vem da animação)
 *  - `two_hand` / `upright` / `waist`: o quadro do item é recalculado em `update` a partir das posições das mãos
 *    (cadeia de matrizes locais até o `root`, sem atualizar o esqueleto inteiro), então serve para qualquer pose
 *    de carregar sem depender da orientação exata de cada punho
 * O tecido gira em torno do mastro para ficar a favor do vento relativo (vento global − velocidade do portador).
 */
import * as THREE from 'three';
import { PROP_BY_ID, type PropKind } from './props';
import { DESIGN_BY_ID } from './designs';
import { HAND_GRIP, PROP_GRIPS, type Hand } from './props/grips';
import { BANNER, DRUM, clothGeometry, faceGeometry, malletGeometry, propModel, strapGeometry, type DesignPart, type GeoQuality } from './props/propGeometry';
import {
  acquireDesignMaterial, acquireSolidMaterial, propBodyMaterial, propWind, releaseDesignMaterial, releaseSolidMaterial, tickPropClock,
} from './props/propMaterials';

export interface PropHost {
  root: THREE.Object3D;
  bones: Map<string, THREE.Object3D>;
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1), LEFT = new THREE.Vector3(1, 0, 0);

/** matriz do objeto relativa ao `root` (produto das matrizes locais; não toca nas matrizes de mundo) */
function relToRoot(o: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
    p.updateMatrix();
    out.premultiply(p.matrix);
  }
  return out;
}

/** quadro da pegada no referencial do osso da mão: +Y = cabo (sai pelo polegar), +Z = direção dos dedos */
const gripMatrix: Record<Hand, THREE.Matrix4> = { hand_r: new THREE.Matrix4(), hand_l: new THREE.Matrix4() };
for (const h of ['hand_r', 'hand_l'] as Hand[]) {
  const g = HAND_GRIP[h];
  const y = new THREE.Vector3(...g.axis).normalize();
  const z = new THREE.Vector3(0, 1, 0).addScaledVector(y, -y.y).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  gripMatrix[h].makeBasis(x, y, z).setPosition(...g.center);
}

/** coloca `o` com a base (x, y, z) e a posição p (todas no referencial do pai) */
function place(o: THREE.Object3D, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, p: THREE.Vector3, sx = 1) {
  _m2.makeBasis(x, y, z);
  o.quaternion.setFromRotationMatrix(_m2);
  o.position.copy(p);
  o.scale.set(sx, 1, 1);
}

interface ClothSlot {
  part: DesignPart;
  /** gira em torno do mastro (bandeiras) */
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  yaw: number;
}

export class PropAttachment {
  prop = 0;
  design = 0;
  /** grupo do item (filho do osso ou do root) */
  private frame: THREE.Group | null = null;
  private kind: PropKind | null = null;
  private quality: GeoQuality = 'near';
  private detail = true;
  private rigid: THREE.Mesh | null = null;
  private cloth: ClothSlot[] = [];
  private faces: THREE.Mesh[] = [];
  private extras: THREE.Object3D[] = [];
  private bannerPoleL: THREE.Mesh | null = null;
  private strap: THREE.Mesh[] = [];
  private canopyMat: THREE.Material | null = null;
  private lastPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private hasLast = false;

  constructor(readonly host: PropHost) {}

  /** troca o item/design (0 = nenhum) */
  set(prop: number, design: number) {
    if (prop === this.prop && design === this.design && (this.frame || !prop)) return;
    this.prop = prop;
    this.design = design;
    this.clear();
    this.build();
    if (this.hidden) this.applyVisible();
  }

  /** rodada 9 — esconde o item durante a queda (com o ragdoll ele atravessaria o chão); volta ao levantar */
  private hidden = false;
  setVisible(v: boolean) { if (this.hidden === !v) return; this.hidden = !v; this.applyVisible(); }
  private applyVisible() {
    const v = !this.hidden;
    if (this.frame) this.frame.visible = v;
    for (const x of this.extras) x.visible = v;
    for (const m of this.strap) m.visible = v;
    for (const c of this.cloth) c.pivot.visible = v;
  }

  /** animação do tecido etc. (t em segundos); `detail` = perto da câmera */
  update(dt: number, _t: number, detail: boolean) {
    if (!this.frame && this.prop) { this.build(); if (this.hidden) this.applyVisible(); } // esqueleto ainda carregando no `set`
    if (!this.frame || !this.kind) return;
    if (detail !== this.detail) this.setDetail(detail);
    const g = PROP_GRIPS[this.kind];
    const root = this.host.root;
    if (g.mode !== 'bone') this.placeFrame();
    if (this.kind === 'drum') this.placeStrap();
    // vento relativo: vento global (≈ 4 m/s × força) menos a velocidade do portador (bandeira corre "atrás")
    if (this.cloth.length && this.kind !== 'banner') {
      root.updateWorldMatrix(true, false);
      _a.setFromMatrixPosition(root.matrixWorld);
      if (this.hasLast && dt > 0) this.vel.lerp(_b.subVectors(_a, this.lastPos).divideScalar(dt), Math.min(1, dt * 4));
      this.lastPos.copy(_a);
      this.hasLast = true;
      const ws = 1.5 + propWind.strength * 4;
      _d.set(propWind.dirX * ws - this.vel.x, 0, propWind.dirZ * ws - this.vel.z);
      for (const c of this.cloth) this.aimCloth(c, _d, dt);
    }
  }

  dispose() {
    this.clear();
    this.prop = 0;
    this.design = 0;
  }

  // ------------------------------------------------------------------ construção
  private build() {
    const def = PROP_BY_ID.get(this.prop);
    if (!def) return;
    const hand = this.host.bones.get('hand_r');
    if (!hand || !this.host.bones.get('hand_l')) return; // tenta de novo no próximo update
    const kind = def.kind;
    const g = PROP_GRIPS[kind];
    this.kind = kind;
    this.quality = this.detail ? 'near' : 'far';
    const frame = new THREE.Group();
    frame.name = `prop_${kind}`;
    if (g.mode === 'bone') {
      const bone = this.host.bones.get(g.hand)!;
      gripMatrix[g.hand].decompose(frame.position, frame.quaternion, frame.scale);
      frame.position.addScaledVector(_a.set(...HAND_GRIP[g.hand].axis).normalize(), g.slide);
      bone.add(frame);
    } else this.host.root.add(frame);
    this.frame = frame;
    const model = propModel(kind, this.quality);
    const body = propBodyMaterial();
    if (kind === 'drum') {
      // surdo na cintura (quadro próprio), alça esticada até o ombro e baqueta na mão direita
      this.rigid = this.mesh(model.rigid, body, frame);
      for (let i = 0; i < 2; i++) this.strap.push(this.mesh(strapGeometry(), body, this.host.root));
      const mallet = new THREE.Group();
      gripMatrix.hand_r.decompose(mallet.position, mallet.quaternion, mallet.scale);
      this.host.bones.get('hand_r')!.add(mallet);
      this.mesh(malletGeometry(this.quality), body, mallet).name = 'prop_mallet';
      this.extras.push(mallet);
    } else if (kind === 'banner') {
      // um mastro curto em cada mão; o pano vai do topo de um ao topo do outro
      this.rigid = this.mesh(model.rigid, body, frame);
      const left = new THREE.Group();
      this.host.root.add(left);
      this.extras.push(left);
      this.bannerPoleL = this.mesh(model.rigid, body, left);
      this.addCloth(model.parts[0], this.host.root);
    } else {
      this.rigid = this.mesh(model.rigid, body, frame);
      for (const p of model.parts) {
        if (p.part === 'face') {
          const f = this.mesh(faceGeometry(p.w, p.h), acquireDesignMaterial('face', this.design, [p.w, p.h]), frame);
          p.m.decompose(f.position, f.quaternion, f.scale);
          this.faces.push(f);
        } else this.addCloth(p, frame);
      }
      if (model.canopy) {
        // lona do guarda-chuva: cor de fundo do design (ou preta)
        const d = DESIGN_BY_ID.get(this.design);
        this.canopyMat = acquireSolidMaterial(d ? new THREE.Color(d.palette.bg).getHex() : 0x1b1d22);
        this.mesh(model.canopy, this.canopyMat, frame);
      }
    }
    if (g.mode !== 'bone') this.placeFrame();
    if (kind === 'drum') this.placeStrap();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = this.detail; // de longe (NPC distante) a sombra do item não compensa o draw call extra
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  private addCloth(p: DesignPart, parent: THREE.Object3D) {
    const pivot = new THREE.Group();
    p.m.decompose(pivot.position, pivot.quaternion, pivot.scale);
    parent.add(pivot);
    const lod = this.detail ? 0 : 1;
    const part = p.part as 'flag_small' | 'flag_large' | 'banner';
    const mesh = new THREE.Mesh(clothGeometry(part, lod, p.w, p.h), acquireDesignMaterial(part, this.design, [p.w, p.h], lod > 0));
    mesh.castShadow = false; // o deslocamento é no vertex shader: sombra plana destoaria mais que nenhuma
    mesh.receiveShadow = true;
    mesh.onBeforeRender = tickPropClock;
    pivot.add(mesh);
    this.cloth.push({ part: p, pivot, mesh, yaw: Math.PI * 0.5 });
  }

  /** perto ↔ longe: troca malhas (rígida e tecido) pelas versões baratas; materiais de design idem */
  private setDetail(detail: boolean) {
    this.detail = detail;
    if (!this.kind) return;
    const q: GeoQuality = detail ? 'near' : 'far';
    if (q !== this.quality) {
      this.quality = q;
      const model = propModel(this.kind, q);
      if (this.rigid) this.rigid.geometry = model.rigid;
      if (this.bannerPoleL) this.bannerPoleL.geometry = model.rigid;
    }
    for (const o of [this.frame, ...this.extras, ...this.strap]) o?.traverse((m) => { if ((m as THREE.Mesh).isMesh && !this.cloth.some((c) => c.mesh === m)) m.castShadow = detail; });
    const lod = detail ? 0 : 1;
    for (const c of this.cloth) {
      const part = c.part.part as 'flag_small' | 'flag_large' | 'banner';
      const old = c.mesh.material as THREE.Material;
      c.mesh.geometry = clothGeometry(part, lod, c.part.w, c.part.h);
      c.mesh.material = acquireDesignMaterial(part, this.design, [c.part.w, c.part.h], lod > 0);
      releaseDesignMaterial(old);
    }
  }

  // ------------------------------------------------------------------ quadro por mãos
  /** centro do punho (referencial do root) */
  private gripPos(hand: Hand, out: THREE.Vector3): THREE.Vector3 {
    relToRoot(this.host.bones.get(hand)!, this.host.root, _m);
    return out.set(...HAND_GRIP[hand].center).applyMatrix4(_m);
  }

  private placeFrame() {
    const kind = this.kind!, frame = this.frame!;
    const g = PROP_GRIPS[kind];
    if (g.mode === 'upright') {
      // guarda-chuva: na mão, mas quase na vertical (puxa um pouco para o eixo do punho)
      relToRoot(this.host.bones.get(g.hand)!, this.host.root, _m);
      const p = _a.set(...HAND_GRIP[g.hand].center).applyMatrix4(_m);
      _y.set(...HAND_GRIP[g.hand].axis).transformDirection(_m).multiplyScalar(0.3).add(UP).normalize();
      _z.copy(FWD).addScaledVector(_y, -_y.dot(FWD)).normalize();
      _x.crossVectors(_y, _z);
      place(frame, _x, _y, _z, p);
      return;
    }
    if (g.mode === 'waist') {
      relToRoot(this.host.bones.get('pelvis') ?? this.host.bones.get('hand_r')!, this.host.root, _m);
      const p = _a.setFromMatrixPosition(_m).add(_b.set(0.07, -0.1, 0.27));
      // cabeça de cima levemente voltada para quem toca
      _y.set(0, 1, -0.3).normalize();
      _x.copy(LEFT);
      _z.crossVectors(_x, _y);
      place(frame, _x, _y, _z, p);
      return;
    }
    const hr = this.gripPos('hand_r', _a), hl = this.gripPos('hand_l', _b);
    const mid = _c.addVectors(hr, hl).multiplyScalar(0.5);
    const lat = _d.subVectors(hl, hr);
    switch (g.twoHand) {
      case 'pole': {
        // mastro passando pelas duas mãos (puxado para cima); mãos lado a lado → quase vertical
        const len = lat.length();
        if (lat.y < 0) lat.negate();
        _y.copy(UP);
        if (len > 0.12) _y.addScaledVector(lat, 1.2 / len).normalize();
        _y.addScaledVector(FWD, 0.08).normalize();
        _z.copy(FWD).addScaledVector(_y, -_y.dot(FWD)).normalize();
        _x.crossVectors(_y, _z);
        place(frame, _x, _y, _z, mid);
        break;
      }
      case 'banner': {
        const top = BANNER.poleLen - BANNER.poleBelow - 0.04;
        _x.set(lat.x, 0, lat.z);
        if (_x.lengthSq() < 1e-4) _x.copy(LEFT); else _x.normalize();
        _z.crossVectors(_x, UP);
        place(frame, _x, UP, _z, hr);
        place(this.extras[0], _x, UP, _z, hl);
        // pano do topo do mastro direito ao topo do esquerdo (largura = distância entre as mãos)
        const c = this.cloth[0];
        if (c) {
          const pr = hr.clone().addScaledVector(UP, top), pl = hl.clone().addScaledVector(UP, top);
          const span = Math.max(0.3, pr.distanceTo(pl) - BANNER.poleR * 2);
          const dx = _x.subVectors(pl, pr).normalize();
          _y.copy(UP).addScaledVector(dx, -dx.y).normalize();
          _z.crossVectors(dx, _y);
          place(c.pivot, dx, _y, _z, pr.addScaledVector(dx, BANNER.poleR), span / c.part.w);
        }
        break;
      }
      case 'edge':
      case 'stick':
      default: {
        // cartaz de frente, na vertical; a largura das mãos só define o giro em Y
        _x.set(lat.x, 0, lat.z);
        if (_x.lengthSq() < 0.01) _x.copy(LEFT); else _x.normalize();
        _z.crossVectors(_x, UP);
        place(frame, _x, UP, _z, mid);
      }
    }
  }

  /** alça do surdo: das argolas até o ombro direito (V por cima do ombro) */
  private placeStrap() {
    if (!this.frame || this.strap.length < 2) return;
    const sh = this.host.bones.get('clavicle_r') ?? this.host.bones.get('spine_03');
    if (!sh) return;
    relToRoot(sh, this.host.root, _m);
    const top = _a.setFromMatrixPosition(_m).add(_b.set(-0.1, 0.06, 0.03));
    this.frame.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const ring = _c.set(s * (DRUM.r + 0.02), DRUM.h * 0.32, 0).applyMatrix4(this.frame.matrix);
      const dir = _d.subVectors(top, ring);
      const len = dir.length();
      dir.divideScalar(len);
      _z.copy(FWD).addScaledVector(dir, -dir.dot(FWD)).normalize();
      _x.crossVectors(dir, _z);
      const m = this.strap[i];
      place(m, _x, dir, _z, ring);
      m.scale.set(1, len, 1);
    }
  }

  /** gira o pano em torno do mastro para apontar a favor do vento relativo (suavizado) */
  private aimCloth(c: ClothSlot, windWorld: THREE.Vector3, dt: number) {
    c.pivot.updateWorldMatrix(true, false);
    const e = c.pivot.matrixWorld.elements;
    _x.set(e[0], e[1], e[2]).normalize();
    _y.set(e[4], e[5], e[6]).normalize();
    _z.set(e[8], e[9], e[10]).normalize();
    // componente do vento perpendicular ao mastro, em coordenadas do pivô
    const dx = windWorld.dot(_x), dz = windWorld.dot(_z);
    if (dx * dx + dz * dz < 0.04) return;
    const target = Math.atan2(-dz, dx);
    let diff = target - c.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.yaw += diff * Math.min(1, dt * 3);
    c.mesh.rotation.y = c.yaw;
  }

  private clear() {
    for (const c of this.cloth) { releaseDesignMaterial(c.mesh.material as THREE.Material); c.pivot.removeFromParent(); }
    for (const f of this.faces) releaseDesignMaterial(f.material as THREE.Material);
    if (this.canopyMat) releaseSolidMaterial(this.canopyMat);
    for (const s of this.strap) s.removeFromParent();
    for (const x of this.extras) x.removeFromParent();
    this.frame?.removeFromParent();
    this.frame = null;
    this.kind = null;
    this.rigid = null;
    this.bannerPoleL = null;
    this.cloth = [];
    this.faces = [];
    this.extras = [];
    this.strap = [];
    this.canopyMat = null;
    this.hasLast = false;
  }
}
