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
import { BODY_GARMENTS, GARMENT_SLOTS, packLook, pieceKind, resolvedStyles, type GarmentSlot } from '../garments';
import { LAYER_INDEX, averageColor, loadClips, loadLod, loadPiece, type Lod } from './HumanAssets';
import { HumanAnimator } from './HumanAnimator';
import { hideCoveredSkin, indexWithout, sleeveCovered, type HideOptions } from './hideCovered';
import { addRestAttributes, patchLookShader, patchShirtShader, shirtDesign, shirtSlot } from './garmentShader';
import { PropAttachment } from '../../social/PropAttachment';
import { EMPTY_SOCIAL, type SocialState } from '../../social/types';
import type { CullJob } from './hideCovered.worker';

/** uma malha do personagem e a de origem (GLB em cache, pose de repouso: recorte da pele e atributos de padrão) */
interface Part {
  mesh: THREE.SkinnedMesh;
  src: THREE.SkinnedMesh;
  /** camada (BODY, SHIRT, …, ACC_bone) */
  layer: string;
  /** estilo da peça (garments.ts) nas camadas com variantes; '' nas demais */
  style: string;
  /** veio no GLB do corpo (roupa base) */
  base: boolean;
}

interface LodInst {
  group: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  /** malha única com cor de vértice */
  single: boolean;
  tints?: { value: THREE.Color[] };
  layerAvg?: THREE.Color[];
  /** malha única: aparência empacotada (variantes aproximadas no shader) e slot do design da camisa */
  look?: { value: THREE.Vector2 };
  /** malhas por camada: roupa base + peças avulsas já carregadas */
  parts: Part[];
  /** peças avulsas em carregamento */
  pieceLoads: Map<string, Promise<Part | null>>;
  /** roupa visível / pedida (estilos por camada) */
  dressed: string;
  dressing: string;
  /** combinações recortadas em uso por este LOD (corpo, calça) — soltas ao trocar de roupa ou descartar */
  cullKeys?: string[];
}

const clipsByBody = new Map<string, Promise<Map<string, THREE.AnimationClip>>>();
/** fator sobre a oscilação da pelve nos ciclos de corrida (1 = original) */
const RUN_BOUNCE: Record<string, number> = { jog: 0.4, sprint: 0.45 };

/** clipes com a translação da pelve convertida para as proporções deste corpo (também usado pela multidão instanciada) */
export function clipsFor(body: BodyType, pelvisRest: THREE.Vector3): Promise<Map<string, THREE.AnimationClip>> {
  const key = `${body}:${pelvisRest.toArray().map((v) => v.toFixed(3)).join(',')}`;
  let p = clipsByBody.get(key);
  if (!p) {
    p = loadClips().then(({ clips, pelvisRest: src }) => {
      const out = new Map<string, THREE.AnimationClip>();
      // escala pelo tamanho do vetor (altura da pelve): a pelve é filha do osso "Root", que é girado −90° em X —
      // no espaço dele o componente .y NÃO é a altura (é ~0) e a razão .y/.y explodia (até 20× nos corpos femininos)
      const k = pelvisRest.length() / Math.max(0.01, src.length());
      for (const [name, c] of clips) {
        const tracks = c.tracks.map((t) => {
          if (t.name !== 'pelvis.position') return t;
          const v = t.values.slice();
          for (let i = 0; i < v.length; i += 3) {
            v[i] = pelvisRest.x + (v[i] - src.x) * k;
            v[i + 1] = pelvisRest.y + (v[i + 1] - src.y) * k;
            v[i + 2] = pelvisRest.z + (v[i + 2] - src.z) * k;
          }
          // trote/sprint da biblioteca são estilizados: a pelve oscila ~25 cm (corrida real: 8–10 cm) → parece quicar
          const damp = RUN_BOUNCE[name];
          if (damp !== undefined && v.length >= 6) {
            const n = v.length / 3, mean = [0, 0, 0];
            for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) mean[a] += v[i + a] / n;
            for (let i = 0; i < v.length; i += 3) for (let a = 0; a < 3; a++) v[i + a] = mean[a] + (v[i + a] - mean[a]) * damp;
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
  /** semente da individualidade da animação (NPCs: fase própria, balanço do parado — HumanAnimator.setVariant) */
  seed?: number;
}

const warmed = new Set<string>();
let lastCull: { hidden: number; pantsHidden: number; mainMs: number; totalMs: number } | null = null;

/** posições/normais de uma malha de origem na pose de REPOUSO do esqueleto (m). Com a quantização do meshopt a
 * escala real está nas matrizes inversas dos ossos (matrixWorld/bindMatrix são identidade): aplica o skinning de
 * repouso. Normais recalculadas da superfície resultante (as quantizadas não servem com escala não uniforme). */
function worldArrays(sm: THREE.SkinnedMesh) {
  const g = sm.geometry, P = g.getAttribute('position');
  const n = P.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(P, i); sm.applyBoneTransform(i, v); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
  const idx = g.index ? (g.index.array as ArrayLike<number>) : null;
  const tri = idx ?? Array.from({ length: n }, (_, i) => i);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const i0 = tri[t], i1 = tri[t + 1], i2 = tri[t + 2];
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3).sub(a); c.fromArray(pos, i2 * 3).sub(a);
    b.cross(c); // área × normal (ponderado)
    for (const k of [i0, i1, i2]) { nor[k * 3] += b.x; nor[k * 3 + 1] += b.y; nor[k * 3 + 2] += b.z; }
  }
  for (let i = 0; i < n; i++) { v.fromArray(nor, i * 3).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z; }
  return { pos, normal: nor, index: idx };
}

/**
 * braços do corpo na pose de repouso (mesmo espaço de worldArrays): lado de cada vértice (peso no úmero ≥ 0,5:
 * 1 = esquerdo, 2 = direito) e ombro/cotovelo de cada lado — entrada de `sleeveCovered`
 */
function armData(sm: THREE.SkinnedMesh) {
  const names = sm.skeleton.bones.map((b) => b.name);
  const si = sm.geometry.getAttribute('skinIndex'), sw = sm.geometry.getAttribute('skinWeight');
  const n = sm.geometry.getAttribute('position').count;
  const upper = ['l', 'r'].map((s) => names.indexOf(`upperarm_${s}`));
  const armOf = new Uint8Array(n);
  if (!si || !sw || upper.some((i) => i < 0)) return null;
  for (let i = 0; i < n; i++) {
    const w = [0, 0];
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k), x = sw.getComponent(i, k);
      if (b === upper[0]) w[0] += x; else if (b === upper[1]) w[1] += x;
    }
    armOf[i] = w[0] >= 0.5 ? 1 : w[1] >= 0.5 ? 2 : 0;
  }
  const inv = sm.bindMatrixInverse, v = new THREE.Vector3();
  const at = (name: string) => sm.skeleton.bones[names.indexOf(name)].getWorldPosition(v).applyMatrix4(inv).toArray();
  return { armOf, arms: ['l', 'r'].map((s) => ({ shoulder: at(`upperarm_${s}`), elbow: at(`lowerarm_${s}`) })) };
}

/** posições/normais de repouso por geometria (recorte da pele e atributos do padrão da camisa) */
const restCache = new WeakMap<THREE.BufferGeometry, ReturnType<typeof worldArrays>>();
function restOf(sm: THREE.SkinnedMesh) {
  let r = restCache.get(sm.geometry);
  if (!r) { r = worldArrays(sm); restCache.set(sm.geometry, r); }
  return r;
}

let worker: Worker | null | undefined;
let jobSeq = 0;
const pending = new Map<number, (out: Uint8Array[]) => void>();
function runCull(jobs: CullJob[]): Promise<Uint8Array[]> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./hideCovered.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { pending.get(e.data.id)?.(e.data.out); pending.delete(e.data.id); };
    } catch { worker = null; }
  }
  if (!worker) return Promise.resolve(jobs.map((j) => hideCoveredSkin(j.pos, j.normal, j.index, j.cloths, j.opts).covered));
  const id = ++jobSeq;
  return new Promise((res) => { pending.set(id, res); worker!.postMessage({ id, jobs }); });
}

/** a calça também atravessava a camisa na cintura (manchas na barra): calça × camisa. O cós e os passadores saem
 * até ~6 cm para fora da camisa solta; o raio já garante camisa por cima, então sem margem de borda */
const PANTS_UNDER_SHIRT: HideOptions = { inside: 0.06, edgeMargin: 0, radial: true };

/** vértices de `target` cobertos por `cloth`: UMA tarefa no Worker por par de geometrias (compartilhada por todos) */
const masks = new Map<string, Promise<Uint8Array>>();
/** peças de cima (camisetas, polos…): o braço dentro da manga também é escondido pelo eixo do braço */
const SLEEVED = new WeakSet<THREE.SkinnedMesh>();
function coveredBy(target: THREE.SkinnedMesh, cloth: THREE.SkinnedMesh, opts?: HideOptions): Promise<Uint8Array> {
  const sleeve = !opts && SLEEVED.has(cloth);
  const key = `${target.geometry.uuid}|${cloth.geometry.uuid}|${opts ? 'r' : ''}${sleeve ? 's' : ''}`;
  let p = masks.get(key);
  if (!p) {
    // braço erguido: a pele atravessava a manga em frestas — máscara pelo eixo úmero→cotovelo (rodada 7, emotes)
    const arms = sleeve ? armData(target) : null;
    const force = arms ? sleeveCovered(restOf(target).pos, arms.armOf, arms.arms, restOf(cloth)) : undefined;
    p = runCull([{ ...restOf(target), cloths: [restOf(cloth)], opts: force ? { ...opts, force } : opts }]).then((o) => o[0]);
    masks.set(key, p);
  }
  return p;
}

/**
 * Geometria de `target` sem os triângulos cobertos pelas peças VESTIDAS — por combinação (uma regata cobre menos
 * pele que uma camiseta: nunca esconder pele que a peça vestida não cobre). Cache por combinação, compartilhada entre
 * personagens; os atributos são os mesmos objetos da original (um upload só na GPU), só o índice muda.
 */
const combos = new Map<string, { p: Promise<{ geo: THREE.BufferGeometry; hidden: number }>; refs: number }>();
/**
 * referência a uma combinação recortada (quem veste chama `releaseCombo` ao trocar de roupa/sumir). Sem ninguém,
 * o ÍNDICE é liberado da GPU (os atributos são os da geometria original, compartilhados — não são liberados):
 * NPCs reciclados trocam de roupa o tempo todo e o cache crescia sem limite (~+4 MB/min no ALTO)
 */
function releaseCombo(key: string) {
  const c = combos.get(key);
  if (!c || --c.refs > 0) return;
  combos.delete(key);
  void c.p.then(({ geo }) => {
    for (const k of Object.keys(geo.attributes)) geo.deleteAttribute(k);
    geo.dispose();
  });
}
function culled(target: THREE.SkinnedMesh, cloths: THREE.SkinnedMesh[], opts?: HideOptions) {
  const key = [target.geometry.uuid, ...cloths.map((c) => c.geometry.uuid).sort(), opts ? 'r' : ''].join('|');
  let c = combos.get(key);
  if (!c) {
    let p: Promise<{ geo: THREE.BufferGeometry; hidden: number }>;
    p = Promise.all(cloths.map((c) => coveredBy(target, c, opts))).then((ms) => {
      const src = target.geometry;
      const { index, hidden } = indexWithout(src.index ? (src.index.array as ArrayLike<number>) : null, src.getAttribute('position').count, ms);
      const geo = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.attributes)) geo.setAttribute(k, a);
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.boundingSphere = src.boundingSphere;
      geo.boundingBox = src.boundingBox;
      return { geo, hidden };
    });
    c = { p, refs: 0 };
    combos.set(key, c);
  }
  c.refs++;
  return c.p.then((r) => ({ ...r, key }));
}

const WHITE = new THREE.Color(1, 1, 1);
/** malhas únicas (LOD2/LOD3, também na multidão instanciada): quanto camisa/calça são afastadas da pele (m) */
export const SINGLE_INFLATE: Record<number, number> = { 2: 0.014, 3: 0.022 };
const kitTextures = new Map<string, Promise<THREE.Texture>>();
/** textura de uniforme licenciado (design com `texture`), no layout de UV da camiseta base */
function kitTexture(url: string): Promise<THREE.Texture> {
  let p = kitTextures.get(url);
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL ?? '/'}${url}`).then((t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; });
    kitTextures.set(url, p);
  }
  return p;
}

export class HumanCharacter {
  /** definido pelo jogo: pré-compila materiais de um objeto (renderer.compileAsync com as luzes da cena) */
  static warmup: ((obj: THREE.Object3D) => Promise<void>) | null = null;
  /** quanto a camiseta é afastada da pele (unidades do modelo = m) */
  static shirtInflate = 0.008;
  /** esconde a pele coberta pela roupa (QA: desligável para comparar) */
  static skinCull = true;
  /** último recorte de pele (QA) */
  static get lastSkinCull() { return lastCull; }
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
  private seed: number | undefined;

  /** troca a semente da individualidade (NPC reciclado / esqueleto do pool emprestado a outra pessoa) */
  setVariant(seed: number) { this.seed = seed; this.animator?.setVariant(seed); }

  constructor(app: CharacterAppearance, opts: HumanOptions = {}) {
    this.app = { ...app };
    this.body = app.body;
    this.want = opts.lod ?? 0;
    this.castShadow = opts.castShadow ?? true;
    this.clipFilter = opts.clips;
    this.seed = opts.seed;
    this.root.name = `human_${app.body}`;
    this.root.userData.pvHuman = this; // QA (tools/qa/char_probe.mjs)
    // o esqueleto vem do LOD pedido (ou do mais barato, se o pedido for detalhado: aparece logo e melhora depois)
    const first: Lod = this.want <= 1 ? 3 : this.want;
    this.ready = this.ensure(first).then(() => {
      if (!this.disposed && this.want !== first) void this.ensure(this.want);
    });
  }

  /** estado social atual (ação/emote + item na mão) */
  social: SocialState = EMPTY_SOCIAL;
  /** itens na mão (criado no primeiro uso) */
  propAttachment: PropAttachment | null = null;
  /**
   * PONTO ÚNICO de ações sociais e itens deste personagem (jogador local, remoto ou NPC): o animador toca a ação
   * (camada com crossfade sobre a locomoção) e os itens vão para a mão.
   */
  setSocial(s: SocialState) {
    this.social = s;
    this.animator?.setSocial(s);
    if (s.prop || this.propAttachment) {
      this.propAttachment ??= new PropAttachment({ root: this.root, bones: this.bones });
      this.propAttachment.set(s.prop, s.design);
    }
  }

  /** itens na mão: chamado logo depois da animação (o quadro dos itens de duas mãos sai da pose deste quadro) */
  updateProps(dt: number) { this.propAttachment?.update(dt, performance.now() / 1000, this.want <= 1); }

  get lod(): Lod { return this.want; }
  /** LOD visível agora (−1 = nenhum) */
  get shownLod(): number { return this.shown; }
  /** já há algum LOD carregado e visível (antes disso o personagem é invisível) */
  get showing(): boolean { return this.shown >= 0; }
  /**
   * rodada 9.1: visível com detalhe compatível com o pedido — o LOD3 (~600 tri) do primeiro carregamento só vale se o
   * pedido for o LOD3. Antes, de perto, o pedestre aparecia facetado enquanto o LOD0 carregava/vestia; agora quem
   * usa o orçamento mantém o instanciado (ou a malha única LOD2) até lá
   */
  get showingDetail(): boolean { return this.shown >= 0 && (this.shown <= 2 || this.want >= 3); }
  /** volta todos os ossos ao repouso (antes do mixer), p.ex. depois do ragdoll */
  resetPose() { for (const [b, r] of this.rest) { b.quaternion.copy(r.q); b.position.copy(r.p); } }
  hasLod(l: Lod) { return !!this.lods[l]; }

  setLod(l: Lod) {
    if (this.animator) this.animator.detail = l <= 1;
    if (l === this.want) return;
    this.want = l;
    if (!this.lods[l]) void this.ensure(l);
    // camadas (LOD0/1) demoram (peças, recorte no Worker, shaders): a malha única LOD2 (já baixada para a multidão,
    // sem vestir) cobre a espera em vez do LOD3
    if (l <= 1 && !this.lods[0] && !this.lods[1] && !this.lods[2]) void this.ensure(2);
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
    const inst = this.bind(gltf.scene, l);
    // peças variantes da aparência + pele/calça coberta pela roupa recortada antes de o LOD aparecer (Worker)
    if (!inst.single) {
      await this.dress(inst, l);
      if (this.disposed) return;
    }
    // pré-compila os shaders deste LOD antes de mostrá-lo (evita engasgo de 100+ ms na primeira aparição)
    if (HumanCharacter.warmup && !warmed.has(`${this.body}:${l}`)) {
      warmed.add(`${this.body}:${l}`);
      inst.group.visible = true;
      try { await HumanCharacter.warmup(inst.group); } catch { /* opcional */ }
      inst.group.visible = false;
      if (this.disposed) return;
    }
    this.lods[l] = inst;
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
    this.animator = new HumanAnimator(this.armature, clips, this.body, BODY_TYPES[this.body].speedFactor, all);
    this.animator.detail = this.want <= 1;
    if (this.seed !== undefined) this.animator.setVariant(this.seed);
    this.animator.strideScale = this.app.scale || 1;
    // estado social recebido antes de o esqueleto carregar
    if (this.social !== EMPTY_SOCIAL) this.animator.setSocial(this.social);
  }

  /** recria as malhas do GLB ligadas ao esqueleto deste personagem */
  private bind(src: THREE.Object3D, l: Lod): LodInst {
    const group = new THREE.Group();
    group.name = `lod${l}`;
    const parts = this.bindMeshes(src, l, group, true);
    group.visible = false;
    this.armature!.add(group);
    const single = parts.some((p) => !!p.src.geometry.getAttribute('_layer'));
    const inst: LodInst = { group, meshes: parts.map((p) => p.mesh), single, parts, pieceLoads: new Map(), dressed: '', dressing: '' };
    if (single) this.prepTints(inst, l);
    return inst;
  }

  /** malhas com esqueleto de um GLB (corpo ou peça avulsa) → malhas deste personagem dentro de `group` */
  private bindMeshes(src: THREE.Object3D, l: Lod, group: THREE.Group, base: boolean): Part[] {
    src.updateMatrixWorld(true);
    const srcArm = (() => { let a: THREE.Object3D | null = null; src.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === 'Root') a = o.parent; }); return a as THREE.Object3D | null; })();
    const armInv = srcArm ? srcArm.matrixWorld.clone().invert() : new THREE.Matrix4();
    const skels = new Map<THREE.Skeleton, THREE.Skeleton>();
    const parts: Part[] = [];
    src.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      const mat = (sm.material as THREE.MeshStandardMaterial).clone();
      const mesh = new THREE.SkinnedMesh(sm.geometry, mat);
      mesh.name = sm.name || sm.parent?.name || '';
      // as camadas vêm com o nome do objeto do Blender (BODY, SHIRT, ACC_bone…; peças avulsas: SHIRT_regata);
      // o glTF às vezes põe no pai
      const layerName = [sm.name, sm.parent?.name].find((n) => n && /^(BODY|HAIR|SHIRT|PANTS|SHOES|EYES|EYEBROWS|EYELASHES|ACC_|LOD)/.test(n)) ?? sm.name;
      const full = layerName.replace(/_\d+$/, '');
      const piece = /^(SHIRT|PANTS|SHOES|HAIR)_([a-z][a-z0-9]*)$/.exec(full);
      const layer = piece ? piece[1] : full;
      const slot = (GARMENT_SLOTS as string[]).includes(layer) ? (layer as GarmentSlot) : null;
      const style = piece ? piece[2] : slot ? BODY_GARMENTS[this.body][slot].base : '';
      mesh.userData.layer = layer;
      mesh.userData.style = style;
      new THREE.Matrix4().multiplyMatrices(armInv, sm.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
      // UM esqueleto por pele de origem (as camadas compartilham): uma textura de ossos e um update por quadro
      // (peças avulsas reaproveitam o esqueleto de uma camada base com os mesmos ossos e inversas: sem textura de
      // ossos nem update extra por peça)
      let skel = skels.get(sm.skeleton) ?? (base ? undefined : this.sameSkeleton(group, sm.skeleton));
      if (!skel) {
        skel = new THREE.Skeleton(sm.skeleton.bones.map((b) => this.bones.get(b.name) ?? b), sm.skeleton.boneInverses);
        skels.set(sm.skeleton, skel);
      }
      mesh.bind(skel, sm.bindMatrix.clone());
      mesh.frustumCulled = false; // a caixa de bind não acompanha a animação; quem usa faz culling por distância
      mesh.castShadow = this.castShadow;
      mesh.receiveShadow = true;
      // padrão da camisa no espaço do corpo em repouso (uma vez por geometria)
      if (layer === 'SHIRT') addRestAttributes(sm, restOf(sm).pos);
      this.prepMaterial(mesh, mat, l);
      // peças avulsas entram ocultas: `dress` decide o que aparece
      if (!base) mesh.visible = false;
      parts.push({ mesh, src: sm, layer, style, base });
      group.add(mesh);
    });
    return parts;
  }

  /** esqueleto já ligado neste LOD equivalente ao de origem (mesmos ossos, mesmas inversas de bind) */
  private sameSkeleton(group: THREE.Group, src: THREE.Skeleton): THREE.Skeleton | undefined {
    for (const o of group.children) {
      const k = (o as THREE.SkinnedMesh).skeleton;
      if (!k || k.bones.length !== src.bones.length) continue;
      if (k.bones.every((b, i) => b.name === src.bones[i].name) && k.boneInverses.every((m, i) => m.equals(src.boneInverses[i]) || m.elements.every((e, j) => Math.abs(e - src.boneInverses[i].elements[j]) < 1e-4))) return k;
    }
    return undefined;
  }

  /** peça avulsa (uma por estilo e LOD, carregada só quando alguém a veste); null se faltar o arquivo */
  private piece(inst: LodInst, l: Lod, slot: GarmentSlot, style: string): Promise<Part | null> {
    const have = inst.parts.find((p) => p.layer === slot && p.style === style);
    if (have) return Promise.resolve(have);
    const k = `${slot}:${style}`;
    let p = inst.pieceLoads.get(k);
    if (!p) {
      p = loadPiece(this.body, slot, style, l === 0 ? 0 : 1).then((g) => {
        if (this.disposed) return null;
        const parts = this.bindMeshes(g.scene, l, inst.group, false);
        inst.parts.push(...parts);
        inst.meshes.push(...parts.map((x) => x.mesh));
        // chegou tarde (a roupa já mudou de novo)? não fica pendurada
        if (resolvedStyles(this.app)[slot] !== style) { for (const x of parts) this.releasePart(inst, x); return null; }
        this.applyAppearance();
        return parts.find((x) => x.layer === slot) ?? null;
      }).catch((e) => { console.warn(`[human] peça ${this.body} ${k} indisponível`, e); return null; });
      inst.pieceLoads.set(k, p);
    }
    return p;
  }

  /**
   * Veste a roupa da aparência num LOD com camadas: carrega as peças avulsas que faltam, recorta a pele (e a calça)
   * coberta por ESTA combinação e só então troca o que está visível (até lá, a roupa anterior continua).
   */
  private releasePart(inst: LodInst, p: Part) {
    p.mesh.removeFromParent();
    (p.mesh.material as THREE.Material).dispose();
    if (!inst.group.children.some((o) => (o as THREE.SkinnedMesh).skeleton === p.mesh.skeleton)) p.mesh.skeleton.dispose();
    inst.parts.splice(inst.parts.indexOf(p), 1);
    inst.meshes.splice(inst.meshes.indexOf(p.mesh), 1);
    inst.pieceLoads.delete(`${p.layer}:${p.style}`);
  }

  /**
   * solta peças avulsas OCULTAS que a roupa atual não pede: um NPC reciclado troca de roupa antes de a troca anterior
   * terminar (o recorte no Worker demora) e as peças da troca abandonada ficavam para sempre (+20 malhas/NPC/min)
   */
  private prune(inst: LodInst) {
    const want = resolvedStyles(this.app);
    for (const p of inst.parts.filter((x) => !x.base && !x.mesh.visible && want[x.layer as GarmentSlot] !== x.style)) this.releasePart(inst, p);
  }

  private async dress(inst: LodInst, l: Lod) {
    const want = resolvedStyles(this.app);
    const key = GARMENT_SLOTS.map((s) => want[s]).join('/');
    if (inst.dressed === key || inst.dressing === key) return;
    this.prune(inst);
    inst.dressing = key;
    const baseOf = (slot: GarmentSlot) => inst.parts.find((p) => p.layer === slot && p.base) ?? null;
    const worn = new Map<GarmentSlot, Part | null>();
    await Promise.all(GARMENT_SLOTS.map(async (slot) => {
      const kind = pieceKind(this.body, slot, want[slot]);
      worn.set(slot, kind === 'bare' ? null : kind === 'base' ? baseOf(slot) : (await this.piece(inst, l, slot, want[slot])) ?? baseOf(slot));
    }));
    if (this.disposed || inst.dressing !== key) return;
    const body = inst.parts.find((p) => p.layer === 'BODY');
    if (HumanCharacter.skinCull && body) {
      const sh = worn.get('SHIRT'), pa = worn.get('PANTS'), so = worn.get('SHOES');
      if (sh) SLEEVED.add(sh.src);
      const t0 = performance.now();
      try {
        const [b, pc] = await Promise.all([
          culled(body.src, [sh, pa, so].filter((x): x is Part => !!x).map((x) => x.src)),
          sh && pa ? culled(pa.src, [sh.src], PANTS_UNDER_SHIRT) : Promise.resolve(null),
        ]);
        if (this.disposed || inst.dressing !== key) { releaseCombo(b.key); if (pc) releaseCombo(pc.key); return; }
        for (const k of inst.cullKeys ?? []) releaseCombo(k);
        inst.cullKeys = pc ? [b.key, pc.key] : [b.key];
        body.mesh.geometry = b.geo;
        body.mesh.userData.cull = { key: b.key.split('|').map((x) => x.slice(0, 8)).join('|'), hidden: b.hidden, of: (body.src.geometry.index?.count ?? 0) / 3 };
        if (pa) pa.mesh.geometry = pc ? pc.geo : pa.src.geometry;
        lastCull = { hidden: b.hidden, pantsHidden: pc?.hidden ?? 0, mainMs: 0, totalMs: +(performance.now() - t0).toFixed(1) };
      } catch (e) { console.warn('[human] recorte da pele falhou', e); }
    }
    for (const p of inst.parts) if ((GARMENT_SLOTS as string[]).includes(p.layer)) p.mesh.visible = worn.get(p.layer as GarmentSlot) === p;
    // peças avulsas que saíram do corpo são soltas (NPCs reciclados trocam de roupa: não acumular malhas/materiais;
    // geometria e texturas ficam no cache do GLB, compartilhadas)
    const wornSet = new Set(worn.values());
    for (const p of inst.parts.filter((x) => !x.base && !wornSet.has(x))) this.releasePart(inst, p);
    inst.dressed = key;
    inst.dressing = '';
    this.applyAppearance();
  }

  private prepMaterial(mesh: THREE.SkinnedMesh, mat: THREE.MeshStandardMaterial, l: Lod) {
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
    // camiseta: o corpo (mais musculoso) atravessava o tecido nos ombros/costas — "roupa rasgada". Empurra a malha
    // da camiseta alguns milímetros para fora pela normal (antes do skinning), sempre por cima da pele
    if (layer === 'SHIRT') {
      // LOD1 tem menos polígonos (folgas maiores); de longe a espessura extra não aparece
      const k = HumanCharacter.shirtInflate * (l >= 1 ? 1.75 : 1);
      const prev = mat.onBeforeCompile;
      // camisa de futebol: padrão da paleta do design no shader (slot 0 = lisa)
      const slot = { value: 0 };
      mat.userData.pvShirt = slot;
      mat.onBeforeCompile = (sh, r) => {
        prev?.call(mat, sh, r);
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(objectNormal) * ${k.toFixed(4)};`);
        patchShirtShader(sh, slot);
      };
      mat.customProgramCacheKey = () => `shirt${k}`;
    }
    // calça/bermuda no LOD1: a decimação deixa a coxa atravessar o tecido ao correr — mesma folga da camiseta
    if (layer === 'PANTS' && l >= 1) {
      const k = HumanCharacter.shirtInflate * 1.75;
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        prev?.call(mat, sh, r);
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed += normalize(objectNormal) * ${k.toFixed(4)};`);
      };
      mat.customProgramCacheKey = () => `pants${k}`;
    }
    // cor média da textura: calculada no build (Blender) e gravada em extras; o cálculo no navegador é só reserva
    const avg = mat.userData.pv_avg as number[] | undefined;
    mesh.userData.baseColor = avg ? new THREE.Color().setRGB(avg[0], avg[1], avg[2], THREE.SRGBColorSpace) : averageColor(mat.map, ['HAIR', 'EYEBROWS', 'EYELASHES'].includes(layer));
  }

  /** malha única: tinta por camada no shader (cor de vértice × tinta[_layer]) */
  private prepTints(inst: LodInst, l: Lod) {
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
    // variantes de roupa e padrão da camisa aproximados por zona do corpo (garmentShader)
    const src = inst.parts[0].src;
    addRestAttributes(src, restOf(src).pos, LAYER_INDEX.SHIRT);
    const look = { value: new THREE.Vector2() };
    const layerAvg = { value: inst.layerAvg };
    inst.look = look;
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
        patchLookShader(sh, { instanced: false, layerAvg, look, inflate: SINGLE_INFLATE[l] });
      };
      mat.customProgramCacheKey = () => `pv-human-lod-look${l}`;
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
    // NPC reciclado com outra roupa: níveis detalhados (camadas + peças) que não estão em uso saem — voltam do cache
    // de GLB quando o LOD for pedido de novo. Sem isso cada NPC acumulava LOD0 + LOD1 com as peças de cada roupa
    this.lods.forEach((inst, l) => { if (inst && !inst.single && l !== this.want && l !== this.shown) this.dropLod(l as Lod); });
    this.applyAppearance();
    this.lods.forEach((inst, l) => { if (inst && !inst.single) void this.dress(inst, l as Lod); });
  }

  private dropLod(l: Lod) {
    const inst = this.lods[l];
    if (!inst) return;
    const skels = new Set<THREE.Skeleton>();
    for (const m of inst.meshes) { (m.material as THREE.Material).dispose(); skels.add(m.skeleton); }
    skels.forEach((k) => k.dispose());
    for (const k of inst.cullKeys ?? []) releaseCombo(k);
    inst.group.removeFromParent();
    this.lods[l] = null;
  }

  private applyAppearance() {
    const a = this.app;
    const want: Record<string, number> = { BODY: a.skin, HAIR: a.hair, SHIRT: a.top, PANTS: a.bottom, SHOES: a.shoes };
    const target = new THREE.Color();
    const slot = shirtSlot(a.shirtDesign), kit = shirtDesign(a.shirtDesign)?.texture;
    for (const inst of this.lods) {
      if (!inst) continue;
      inst.look?.value.set(packLook(a), slot);
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
        if (layer === 'SHIRT') {
          // camisa com design: padrão (slot) ou textura de uniforme licenciado (só na camiseta base) sobre o branco
          const k = kit && m.userData.style === BODY_GARMENTS[this.body].SHIRT.base ? kit : null;
          (mat.userData.pvShirt as { value: number }).value = k ? 0 : slot;
          if (k) void kitTexture(k).then((t) => { mat.userData.pvMap ??= mat.map; mat.map = t; });
          else if (mat.userData.pvMap) { mat.map = mat.userData.pvMap; mat.userData.pvMap = undefined; }
          if (slot || k) { mat.color.setRGB(...tint(WHITE, m.userData.baseColor, layer)); continue; }
        }
        target.setHex(want[layer]);
        mat.color.setRGB(...tint(target, m.userData.baseColor, layer));
      }
    }
    this.root.scale.setScalar(a.scale || 1);
    if (this.animator) this.animator.strideScale = a.scale || 1;
  }

  dispose() {
    this.disposed = true;
    this.animator?.dispose();
    this.propAttachment?.dispose();
    const skels = new Set<THREE.Skeleton>();
    for (const inst of this.lods) {
      inst?.meshes.forEach((m) => { (m.material as THREE.Material).dispose(); skels.add(m.skeleton); });
      for (const k of inst?.cullKeys ?? []) releaseCombo(k);
    }
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
