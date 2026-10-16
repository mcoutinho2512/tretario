/**
 * Personagem humano modular: UM esqueleto por personagem e camadas de malha independentes
 * (BODY, HAIR, SHIRT, PANTS, SHOES, EYES, EYEBROWS, EYELASHES, ACC_<acessório>), em 4 níveis de detalhe:
 *   LOD0 camadas completas (~35–40 k triângulos, texturas PBR) · LOD1 camadas decimadas (~13 k)
 *   LOD2 malha única com cor de vértice (~2,5 k, 1 draw call) · LOD3 malha única (~600)
 * Todas as malhas de todos os LODs são ligadas ao MESMO esqueleto: trocar de LOD não reinicia a animação.
 * Cores do jogador (pele, cabelo, roupas, acessório) são multiplicadores sobre a textura (ou sobre a cor de vértice
 * da camada, via atributo _layer, nas malhas únicas).
 */
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BODY_TYPES, type BodyType, type CharacterAppearance } from '../bodyTypes';
import { LAYER_INDEX, averageColor, loadClips, loadLod, type Lod } from './HumanAssets';
import { HumanAnimator } from './HumanAnimator';

interface LodInst {
  group: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  /** malha única com cor de vértice */
  single: boolean;
  tints?: { value: THREE.Color[] };
  layerAvg?: THREE.Color[];
}

const clipsByBody = new Map<string, Promise<Map<string, THREE.AnimationClip>>>();

/** clipes com a translação da pelve convertida para as proporções deste corpo (também usado pela multidão instanciada) */
export function clipsFor(body: BodyType, pelvisRest: THREE.Vector3): Promise<Map<string, THREE.AnimationClip>> {
  const key = `${body}:${pelvisRest.toArray().map((v) => v.toFixed(3)).join(',')}`;
  let p = clipsByBody.get(key);
  if (!p) {
    p = loadClips().then(({ clips, pelvisRest: src }) => {
      const out = new Map<string, THREE.AnimationClip>();
      const k = pelvisRest.y / Math.max(0.01, src.y);
      for (const [name, c] of clips) {
        const tracks = c.tracks.map((t) => {
          if (t.name !== 'pelvis.position') return t;
          const v = t.values.slice();
          for (let i = 0; i < v.length; i += 3) {
            v[i] = pelvisRest.x + (v[i] - src.x) * k;
            v[i + 1] = pelvisRest.y + (v[i + 1] - src.y) * k;
            v[i + 2] = pelvisRest.z + (v[i + 2] - src.z) * k;
          }
          return new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(v));
        });
        out.set(name, new THREE.AnimationClip(name, c.duration, tracks));
      }
      return out;
    });
    clipsByBody.set(key, p);
  }
  return p;
}

export interface HumanOptions {
  lod?: Lod;
  castShadow?: boolean;
  /** subconjunto de clipes (NPCs só precisam de locomoção: menos memória e CPU no mixer) */
  clips?: string[];
}

export class HumanCharacter {
  readonly root = new THREE.Group();
  /** contêiner do esqueleto (pai do osso "Root") */
  armature: THREE.Object3D | null = null;
  readonly bones = new Map<string, THREE.Bone>();
  /** pose de repouso (ossos sem trilha nos clipes não são escritos pelo mixer: o exportador remove canais constantes) */
  private rest = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  animator: HumanAnimator | null = null;
  readonly ready: Promise<void>;
  readonly body: BodyType;
  private app: CharacterAppearance;
  private lods: (LodInst | null)[] = [null, null, null, null];
  private loading = new Set<Lod>();
  private want: Lod;
  private shown = -1;
  private castShadow: boolean;
  private clipFilter: string[] | undefined;
  private disposed = false;

  constructor(app: CharacterAppearance, opts: HumanOptions = {}) {
    this.app = { ...app };
    this.body = app.body;
    this.want = opts.lod ?? 0;
    this.castShadow = opts.castShadow ?? true;
    this.clipFilter = opts.clips;
    this.root.name = `human_${app.body}`;
    // o esqueleto vem do LOD pedido (ou do mais barato, se o pedido for detalhado: aparece logo e melhora depois)
    const first: Lod = this.want <= 1 ? 3 : this.want;
    this.ready = this.ensure(first).then(() => {
      if (!this.disposed && this.want !== first) void this.ensure(this.want);
    });
  }

  get lod(): Lod { return this.want; }
  /** já há algum LOD carregado e visível (antes disso o personagem é invisível) */
  get showing(): boolean { return this.shown >= 0; }
  /** volta todos os ossos ao repouso (antes do mixer), p.ex. depois do ragdoll */
  resetPose() { for (const [b, r] of this.rest) { b.quaternion.copy(r.q); b.position.copy(r.p); } }
  hasLod(l: Lod) { return !!this.lods[l]; }

  setLod(l: Lod) {
    if (this.animator) this.animator.detail = l <= 1;
    if (l === this.want) return;
    this.want = l;
    if (!this.lods[l]) void this.ensure(l);
    this.show();
  }

  setShadow(on: boolean) {
    if (on === this.castShadow) return;
    this.castShadow = on;
    for (const inst of this.lods) inst?.meshes.forEach((m) => { m.castShadow = on; });
  }

  private async ensure(l: Lod) {
    if (this.disposed || this.lods[l] || this.loading.has(l)) return;
    this.loading.add(l);
    const gltf = await loadLod(this.body, l);
    if (this.disposed) return;
    if (!this.armature) await this.buildRig(gltf.scene);
    this.lods[l] = this.bind(gltf.scene, l);
    this.loading.delete(l);
    this.applyAppearance();
    this.show();
  }

  private async buildRig(src: THREE.Object3D) {
    const c = cloneSkeleton(src);
    let arm: THREE.Object3D | null = null;
    c.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === 'Root') arm = o.parent; });
    const meshes: THREE.Object3D[] = [];
    c.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
    meshes.forEach((m) => m.removeFromParent());
    this.armature = arm ?? c;
    this.root.add(c);
    c.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      this.bones.set(o.name, o as THREE.Bone);
      this.rest.set(o as THREE.Bone, { q: o.quaternion.clone(), p: o.position.clone() });
    });
    const pelvis = this.bones.get('pelvis');
    const all = await clipsFor(this.body, pelvis ? pelvis.position.clone() : new THREE.Vector3(0, 1, 0));
    if (this.disposed) return;
    const clips = this.clipFilter ? new Map([...all].filter(([k]) => this.clipFilter!.includes(k))) : all;
    this.animator = new HumanAnimator(this.armature, clips, this.body, BODY_TYPES[this.body].speedFactor);
    this.animator.detail = this.want <= 1;
  }

  /** recria as malhas do GLB ligadas ao esqueleto deste personagem */
  private bind(src: THREE.Object3D, l: Lod): LodInst {
    src.updateMatrixWorld(true);
    const group = new THREE.Group();
    group.name = `lod${l}`;
    const meshes: THREE.SkinnedMesh[] = [];
    let single = false;
    const srcArm = (() => { let a: THREE.Object3D | null = null; src.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === 'Root') a = o.parent; }); return a as THREE.Object3D | null; })();
    const armInv = srcArm ? srcArm.matrixWorld.clone().invert() : new THREE.Matrix4();
    const skels = new Map<THREE.Skeleton, THREE.Skeleton>();
    src.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const mat = (sm.material as THREE.MeshStandardMaterial).clone();
      const mesh = new THREE.SkinnedMesh(sm.geometry, mat);
      mesh.name = sm.name || sm.parent?.name || '';
      // as camadas vêm com o nome do objeto do Blender (BODY, SHIRT, ACC_bone…); o glTF às vezes põe no pai
      const layerName = [sm.name, sm.parent?.name].find((n) => n && /^(BODY|HAIR|SHIRT|PANTS|SHOES|EYES|EYEBROWS|EYELASHES|ACC_|LOD)/.test(n)) ?? sm.name;
      mesh.userData.layer = layerName.replace(/_\d+$/, '');
      new THREE.Matrix4().multiplyMatrices(armInv, sm.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
      // UM esqueleto por pele de origem (as camadas compartilham): uma textura de ossos e um update por quadro
      let skel = skels.get(sm.skeleton);
      if (!skel) {
        skel = new THREE.Skeleton(sm.skeleton.bones.map((b) => this.bones.get(b.name) ?? b), sm.skeleton.boneInverses);
        skels.set(sm.skeleton, skel);
      }
      mesh.bind(skel, sm.bindMatrix.clone());
      mesh.frustumCulled = false; // a caixa de bind não acompanha a animação; quem usa faz culling por distância
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = true;
      if (sm.geometry.getAttribute('_layer')) single = true;
      this.prepMaterial(mesh, mat);
      meshes.push(mesh);
      group.add(mesh);
    });
    group.visible = false;
    this.armature!.add(group);
    const inst: LodInst = { group, meshes, single };
    if (single) this.prepTints(inst);
    return inst;
  }

  private prepMaterial(mesh: THREE.SkinnedMesh, mat: THREE.MeshStandardMaterial) {
    const layer = mesh.userData.layer as string;
    if (['HAIR', 'EYEBROWS', 'EYELASHES', 'ACC_oculos'].includes(layer)) {
      mat.transparent = false;
      mat.alphaTest = layer === 'HAIR' ? 0.45 : 0.3;
      mat.depthWrite = true;
      mat.side = THREE.DoubleSide;
      mesh.castShadow = layer === 'HAIR' && this.castShadow;
    }
    if (layer === 'EYES' || layer === 'EYEBROWS' || layer === 'EYELASHES') mesh.castShadow = false;
    // pele: um pouco de brilho especular e menos "plástico"
    if (layer === 'BODY') { mat.roughness = 0.55; mat.envMapIntensity = 0.6; }
    // cor média da textura: calculada no build (Blender) e gravada em extras; o cálculo no navegador é só reserva
    const avg = mat.userData.pv_avg as number[] | undefined;
    mesh.userData.baseColor = avg ? new THREE.Color().setRGB(avg[0], avg[1], avg[2], THREE.SRGBColorSpace) : averageColor(mat.map, ['HAIR', 'EYEBROWS', 'EYELASHES'].includes(layer));
  }

  /** malha única: tinta por camada no shader (cor de vértice × tinta[_layer]) */
  private prepTints(inst: LodInst) {
    const tints = { value: [0, 1, 2, 3, 4].map(() => new THREE.Color(1, 1, 1)) };
    inst.tints = tints;
    const mesh = inst.meshes[0];
    const g = mesh.geometry;
    const col = g.getAttribute('color'), lay = g.getAttribute('_layer');
    const sum = [0, 1, 2, 3, 4].map(() => [0, 0, 0, 0]);
    if (col && lay) {
      for (let i = 0; i < col.count; i++) {
        const li = Math.round(lay.getX(i));
        if (li < 0 || li > 4) continue;
        const s = sum[li];
        s[0] += col.getX(i); s[1] += col.getY(i); s[2] += col.getZ(i); s[3]++;
      }
    }
    inst.layerAvg = sum.map((s) => (s[3] ? new THREE.Color(s[0] / s[3], s[1] / s[3], s[2] / s[3]) : new THREE.Color(1, 1, 1)));
    for (const m of inst.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.vertexColors = true;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTints = tints;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float _layer;\nuniform vec3 uTints[5];\nvarying vec3 vTint;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = uTints[int(clamp(_layer + 0.5, 0.0, 4.0))];');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTint;');
      };
      mat.customProgramCacheKey = () => 'pv-human-lod-tint';
      mat.needsUpdate = true;
    }
  }

  private show() {
    // mostra o LOD pedido; enquanto não carrega, o carregado mais próximo dele
    let pick = -1;
    for (let d = 0; d < 4 && pick < 0; d++) {
      for (const c of [this.want + d, this.want - d]) if (c >= 0 && c < 4 && this.lods[c] && pick < 0) pick = c;
    }
    if (pick === this.shown) return;
    this.lods.forEach((inst, i) => { if (inst) inst.group.visible = i === pick; });
    this.shown = pick;
  }

  setAppearance(app: CharacterAppearance) {
    this.app = { ...app };
    this.applyAppearance();
  }

  private applyAppearance() {
    const a = this.app;
    const want: Record<string, number> = { BODY: a.skin, HAIR: a.hair, SHIRT: a.top, PANTS: a.bottom, SHOES: a.shoes };
    const target = new THREE.Color();
    for (const inst of this.lods) {
      if (!inst) continue;
      if (inst.single && inst.tints && inst.layerAvg) {
        for (const [layer, i] of Object.entries(LAYER_INDEX)) {
          if (want[layer] === undefined) continue;
          target.setHex(want[layer]);
          inst.tints.value[i].setRGB(...tint(target, inst.layerAvg[i], layer));
        }
        continue;
      }
      for (const m of inst.meshes) {
        const layer = m.userData.layer as string;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (layer.startsWith('ACC_')) {
          m.visible = layer === `ACC_${a.accessory ?? 'nenhum'}`;
          if (m.visible && a.acc !== undefined && layer !== 'ACC_oculos') { target.setHex(a.acc); mat.color.setRGB(...tint(target, m.userData.baseColor, layer)); }
          continue;
        }
        if (want[layer] === undefined) continue;
        target.setHex(want[layer]);
        mat.color.setRGB(...tint(target, m.userData.baseColor, layer));
      }
    }
    this.root.scale.setScalar(a.scale || 1);
  }

  dispose() {
    this.disposed = true;
    this.animator?.dispose();
    const skels = new Set<THREE.Skeleton>();
    for (const inst of this.lods) inst?.meshes.forEach((m) => { (m.material as THREE.Material).dispose(); skels.add(m.skeleton); });
    skels.forEach((k) => k.dispose());
    this.root.removeFromParent();
  }
}

/**
 * multiplicador que leva a cor média da textura à cor desejada. Pele e cabelo preservam o detalhe
 * (o multiplicador é limitado); roupas aceitam mudança forte de cor.
 */
export function tint(target: THREE.Color, base: THREE.Color | undefined, layer: string): [number, number, number] {
  const b = base ?? new THREE.Color(1, 1, 1);
  const max = layer === 'BODY' ? 1.5 : 2.4;
  const f = (t: number, s: number) => Math.min(max, t / Math.max(0.04, s));
  return [f(target.r, b.r), f(target.g, b.g), f(target.b, b.b)];
}
