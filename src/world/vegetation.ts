/**
 * Vegetação semi-realista do Centro (rodada 5).
 *
 * - Geometria gerada no carregamento com o ez-tree (vegetationGen.ts — nada de malha para baixar):
 *   10 variantes (oiti ×3, amendoeira ×2, cássia, ficus, munguba, ipê-amarelo, palmeira-imperial),
 *   cada uma com LOD 0 (perto) e LOD 1 (médio).
 * - Desenho: BatchedMesh (WEBGL_multi_draw) — 1 chamada por material e por faixa de LOD, todas as variantes juntas.
 * - LOD 2 (longe): impostor — atlas 8 vistas × variante, renderizado no carregamento (cor + normal),
 *   em quads virados para a câmera (eixo Y) num único draw instanciado. Iluminado pela cena via normal do atlas.
 * - Espécie por posição (determinística): trechos de ~36 m tendem a ter a mesma espécie, como no plantio viário.
 */
import * as THREE from 'three';
import { generateVegetation, type VegVariant } from './vegetationGen';

export type { VegVariant } from './vegetationGen';

export interface VegetationAssets { variants: VegVariant[]; leafMap: THREE.Texture; barkMap: THREE.Texture; barkNormal: THREE.Texture }

export interface TreeInstance { x: number; y: number; z: number; rot: number; scale: number; variant: number }

/** participação aproximada das espécies na arborização viária do Centro (ver docs/VEGETATION.md) */
export const SPECIES_WEIGHTS: [string, number][] = [
  ['oiti', 0.44], ['amendoeira', 0.17], ['cassia', 0.11], ['ficus', 0.09], ['munguba', 0.08], ['ipe', 0.06], ['palmeira', 0.05],
];

const hash2 = (x: number, z: number, s: number) => {
  const h = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453;
  return h - Math.floor(h);
};

function pickWeighted(u: number): string {
  let acc = 0;
  for (const [k, w] of SPECIES_WEIGHTS) { acc += w; if (u < acc) return k; }
  return SPECIES_WEIGHTS[0][0];
}

/** espécie determinística por posição: trecho de 36 m define a espécie dominante; 22% das árvores fogem dela */
export function speciesAt(x: number, z: number): string {
  const cx = Math.floor(x / 36), cz = Math.floor(z / 36);
  const own = hash2(x, z, 1);
  if (own < 0.22) return pickWeighted(hash2(x, z, 2));
  const dom = pickWeighted(hash2(cx, cz, 3));
  // palmeiras e ipês raramente formam trechos inteiros
  return dom === 'palmeira' || dom === 'ipe' ? (hash2(cx, cz, 4) < 0.5 ? dom : 'oiti') : dom;
}

// ------------------------------------------------------------------------------------------
// carregamento: texturas (public/vegetation/) + geração procedural das variantes
// ------------------------------------------------------------------------------------------
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

export async function loadVegetation(baseUrl: string, onProgress?: (f: number) => void): Promise<VegetationAssets> {
  const loader = new THREE.TextureLoader();
  const tex = async (f: string, srgb: boolean) => {
    const t = await loader.loadAsync(`${baseUrl}${f}`);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const texP = Promise.all([tex('leaves.webp', true), tex('bark.jpg', true), tex('bark_n.jpg', false)]);
  // gera as variantes cedendo o thread entre elas (tela de carregamento continua respondendo)
  const variants = await generateVegetation(async (i, n) => { onProgress?.(i / n); await nextFrame(); });
  const [leafMap, barkMap, barkNormal] = await texP;
  barkMap.wrapT = barkNormal.wrapT = THREE.RepeatWrapping;
  return { variants, leafMap, barkMap, barkNormal };
}

// ------------------------------------------------------------------------------------------
// materiais
// ------------------------------------------------------------------------------------------
/** vento nas folhas (por altura acima da base da copa; fase pela posição da instância) */
function addWind(mat: THREE.MeshStandardMaterial, wind: { value: number }, key: string, strength: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_BATCHING
          vec3 ip = batchingMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.37 + ip.z * 0.21;
        float sway = max(0.0, transformed.y - 2.5) * ${strength.toFixed(4)};
        transformed.x += sin(uTime * 1.3 + ph) * sway + sin(uTime * 3.7 + ph * 2.0 + transformed.y * 0.7) * sway * 0.3;
        transformed.z += cos(uTime * 1.1 + ph) * sway * 0.7 + cos(uTime * 4.3 + transformed.x) * sway * 0.25;`);
    // folhas dupla-face: mantém a normal "volumétrica" da copa nas duas faces (sem inverter no verso)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      normal = normalize( vNormal );`);
  };
  mat.customProgramCacheKey = () => key;
}

export interface VegMaterials { bark: THREE.MeshStandardMaterial; leaves: THREE.MeshStandardMaterial; impostor: THREE.MeshStandardMaterial }

function createMaterials(a: VegetationAssets, wind: { value: number }): Omit<VegMaterials, 'impostor'> {
  const bark = new THREE.MeshStandardMaterial({ map: a.barkMap, normalMap: a.barkNormal, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 0.92, metalness: 0 });
  const leaves = new THREE.MeshStandardMaterial({ map: a.leafMap, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.78, metalness: 0 });
  addWind(leaves, wind, 'pv-veg-leaves', 0.010);
  return { bark, leaves };
}

// ------------------------------------------------------------------------------------------
// impostores (atlas renderizado no carregamento)
// ------------------------------------------------------------------------------------------
const VIEWS = 8;

function bakeImpostors(renderer: THREE.WebGLRenderer, a: VegetationAssets, cell: number) {
  const rows = a.variants.length;
  const W = VIEWS * cell, H = rows * cell;
  const mk = (srgb: boolean) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return rt;
  };
  const albedoRT = mk(true), normalRT = mk(false);
  const vs = /* glsl */`
    attribute vec4 color;
    varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
    uniform float uYaw;
    void main() {
      vUv = uv; vCol = color.rgb;
      float c = cos(uYaw), s = sin(uYaw);
      vN = normalize(normal.xyz); // normal local da árvore (antes da rotação de vista)
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const fsAlbedo = /* glsl */`
    uniform sampler2D map; uniform float uAlphaTest;
    varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
    void main() {
      vec4 t = texture2D(map, vUv);
      if (t.a < uAlphaTest) discard;
      gl_FragColor = vec4(t.rgb * vCol, 1.0);
    }`;
  const fsNormal = /* glsl */`
    uniform sampler2D map; uniform float uAlphaTest;
    varying vec2 vUv; varying vec3 vCol; varying vec3 vN;
    void main() {
      vec4 t = texture2D(map, vUv);
      if (t.a < uAlphaTest) discard;
      gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
    }`;
  const mat = (fs: string, map: THREE.Texture, alphaTest: number) => new THREE.ShaderMaterial({
    vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide,
    uniforms: { map: { value: map }, uAlphaTest: { value: alphaTest }, uYaw: { value: 0 } },
  });
  const passes = [
    { rt: albedoRT, bark: mat(fsAlbedo, a.barkMap, 0), leaves: mat(fsAlbedo, a.leafMap, 0.45), clear: new THREE.Color(0.06, 0.09, 0.04) },
    { rt: normalRT, bark: mat(fsNormal, a.barkMap, 0), leaves: mat(fsNormal, a.leafMap, 0.45), clear: new THREE.Color(0.5, 1.0, 0.5) },
  ];
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  scene.add(holder);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const sizes: number[] = [];
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  const prevVp = new THREE.Vector4();
  renderer.getViewport(prevVp);
  const prevScissor = renderer.getScissorTest();
  renderer.autoClear = false;
  for (const p of passes) {
    renderer.setRenderTarget(p.rt);
    renderer.setScissorTest(false);
    renderer.setClearColor(p.clear, 0);
    renderer.clear(true, true, false);
  }
  a.variants.forEach((v, row) => {
    const g = v.lods[0];
    const bb = g.leaves.boundingBox!.clone().union(g.bark.boundingBox!);
    const half = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z), bb.max.y / 2) * 1.04;
    sizes.push(half);
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.position.set(0, half, 100); cam.lookAt(0, half, 0);
    cam.updateProjectionMatrix();
    for (const p of passes) {
      holder.clear();
      holder.add(new THREE.Mesh(g.bark, p.bark), new THREE.Mesh(g.leaves, p.leaves));
      renderer.setRenderTarget(p.rt);
      for (let k = 0; k < VIEWS; k++) {
        holder.rotation.y = -(k / VIEWS) * Math.PI * 2;
        holder.updateMatrixWorld(true);
        p.rt.viewport.set(k * cell, row * cell, cell, cell);
        renderer.setRenderTarget(p.rt);
        renderer.clear(false, true, false);
        // normal precisa ser expressa no espaço local da árvore — o shader usa a normal sem rotação
        renderer.render(scene, cam);
      }
    }
  });
  renderer.setRenderTarget(prevRT);
  renderer.setViewport(prevVp);
  renderer.setScissorTest(prevScissor);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;
  for (const p of passes) { p.bark.dispose(); p.leaves.dispose(); p.rt.viewport.set(0, 0, W, H); }
  return { albedo: albedoRT, normal: normalRT, sizes, rows };
}

function createImpostorMaterial(albedo: THREE.Texture, normal: THREE.Texture, rows: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: albedo, alphaTest: 0.5, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNormalAtlas = { value: normal };
    shader.uniforms.uRows = { value: rows };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPos;   // xyz base da árvore, w escala
        attribute vec3 aImp;   // linha do atlas, yaw da instância, meia-largura do quadro
        uniform float uRows;
        varying float vYaw;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 toCam = cameraPosition - aPos.xyz;
        float ang = atan(toCam.x, toCam.z) - aImp.y;
        float fk = mod(floor(ang / (6.2831853 / ${VIEWS}.0) + 0.5), ${VIEWS}.0);
        vYaw = aImp.y;
        #ifdef USE_MAP
          vec2 uq = 0.012 + uv * 0.976; // margem contra sangramento entre células do atlas
          vMapUv = vec2((fk + uq.x) / ${VIEWS}.0, (aImp.x + uq.y) / uRows);
        #endif`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(vec3(toCam.x, 0.0, toCam.z));`)
      .replace('#include <begin_vertex>', `
        vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z) + 1e-5);
        vec3 right = vec3(fwd.z, 0.0, -fwd.x);
        float hs = aImp.z * aPos.w;
        vec3 transformed = aPos.xyz + right * (position.x * hs) + vec3(0.0, (position.y + 1.0) * hs, 0.0) + fwd * (hs * 0.25);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNormalAtlas;
        varying float vYaw;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          vec3 nl = texture2D(uNormalAtlas, vMapUv).xyz * 2.0 - 1.0;
          float c = cos(vYaw), s = sin(vYaw);
          vec3 nw = vec3(c * nl.x + s * nl.z, nl.y, -s * nl.x + c * nl.z);
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'pv-veg-impostor';
  return mat;
}

/**
 * Passes com `scene.overrideMaterial` (ex.: normal/profundidade do GTAO) desenhariam os cartões de folha e os
 * impostores como quadrados opacos (sem alphaTest nem billboard) → manchas escuras de AO na copa.
 * Esses objetos ficam de fora desses passes (continuam projetando sombra pelo caminho normal).
 */
function skipOverridePasses(obj: THREE.Mesh | THREE.BatchedMesh) {
  if ((obj as THREE.BatchedMesh).isBatchedMesh) {
    const bm = obj as THREE.BatchedMesh & { _multiDrawCount: number };
    const orig = bm.onBeforeRender.bind(bm);
    bm.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      orig(renderer, scene, camera, geometry, material, group);
      if ((scene as THREE.Scene | null)?.overrideMaterial) bm._multiDrawCount = 0;
    };
  } else {
    const g = obj.geometry as THREE.InstancedBufferGeometry;
    let saved = -1;
    obj.onBeforeRender = (_r, scene) => {
      if ((scene as THREE.Scene | null)?.overrideMaterial) { saved = g.instanceCount; g.instanceCount = 0; }
    };
    obj.onAfterRender = () => {
      if (saved >= 0) { g.instanceCount = saved; saved = -1; }
    };
  }
}

// ------------------------------------------------------------------------------------------
// sistema
// ------------------------------------------------------------------------------------------
export interface VegetationOptions {
  /** distância (m) de troca LOD0→LOD1 */
  nearDist: number;
  /** distância (m) de troca LOD1→impostor */
  midDist: number;
  /** sombras projetadas: só LOD0 (e LOD1 se midShadows) */
  shadows: boolean;
  midShadows: boolean;
  impostorCell: number;
  /** depuração: força um LOD para todas as árvores */
  forceLod?: 0 | 1 | 2;
}

export function vegetationOptionsFor(density: number): VegetationOptions {
  const d = Math.min(1, Math.max(0, density));
  return {
    nearDist: d >= 0.95 ? 62 : d >= 0.7 ? 45 : 24,
    midDist: d >= 0.95 ? 175 : d >= 0.7 ? 130 : 75,
    shadows: true,
    midShadows: d >= 0.95,
    impostorCell: d >= 0.7 ? 128 : 96,
  };
}

export class VegetationSystem {
  readonly group = new THREE.Group();
  readonly mats: VegMaterials;
  private batches: { bark: THREE.BatchedMesh; leaves: THREE.BatchedMesh }[] = [];
  private geoIds: { bark: number; leaves: number }[][] = []; // [lod][variant]
  private impostor: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  private impSizes: number[];
  private trees: TreeInstance[] = [];
  private lod: Int8Array = new Int8Array(0);
  private ids: { b: number; l: number }[][] = [[], []]; // instância em cada batch (por LOD)
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  readonly variantsBySpecies = new Map<string, number[]>();
  stats = { near: 0, mid: 0, far: 0 };

  constructor(renderer: THREE.WebGLRenderer, readonly assets: VegetationAssets, wind: { value: number }, public opts: VegetationOptions) {
    this.group.name = 'vegetation';
    const m = createMaterials(assets, wind);
    const imp = bakeImpostors(renderer, assets, opts.impostorCell);
    this.impSizes = imp.sizes;
    this.mats = { ...m, impostor: createImpostorMaterial(imp.albedo.texture, imp.normal.texture, imp.rows) };
    assets.variants.forEach((v, i) => {
      const arr = this.variantsBySpecies.get(v.species) ?? [];
      arr.push(i);
      this.variantsBySpecies.set(v.species, arr);
    });
    for (let lod = 0; lod < 2; lod++) {
      let bv = 0, bi = 0, lv = 0, li = 0;
      for (const v of assets.variants) {
        bv += v.lods[lod].bark.attributes.position.count; bi += v.lods[lod].bark.index!.count;
        lv += v.lods[lod].leaves.attributes.position.count; li += v.lods[lod].leaves.index!.count;
      }
      const bark = new THREE.BatchedMesh(64, bv, bi, m.bark);
      const leaves = new THREE.BatchedMesh(64, lv, li, m.leaves);
      const ids = assets.variants.map((v) => ({ bark: bark.addGeometry(v.lods[lod].bark), leaves: leaves.addGeometry(v.lods[lod].leaves) }));
      this.geoIds.push(ids);
      for (const b of [bark, leaves]) {
        b.name = `veg_lod${lod}_${b === bark ? 'bark' : 'leaves'}`;
        b.castShadow = opts.shadows && (lod === 0 || opts.midShadows);
        b.receiveShadow = true;
        b.sortObjects = lod === 0 && b === leaves; // frente→trás reduz overdraw das folhas próximas
        this.group.add(b);
      }
      skipOverridePasses(leaves);
      this.batches.push({ bark, leaves });
    }
    const quad = new THREE.PlaneGeometry(2, 2);
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = quad.index;
    ig.setAttribute('position', quad.attributes.position);
    ig.setAttribute('uv', quad.attributes.uv);
    ig.setAttribute('normal', quad.attributes.normal);
    ig.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(4 * 16), 4));
    ig.setAttribute('aImp', new THREE.InstancedBufferAttribute(new Float32Array(3 * 16), 3));
    ig.instanceCount = 0;
    this.impostor = new THREE.Mesh(ig, this.mats.impostor);
    this.impostor.name = 'veg_impostors';
    this.impostor.frustumCulled = false;
    this.impostor.castShadow = false;
    this.impostor.receiveShadow = false;
    skipOverridePasses(this.impostor);
    this.group.add(this.impostor);
    // gancho de depuração/medição (tools/qa/veg_budget.mjs)
    (globalThis as unknown as { __pvVeg?: VegetationSystem }).__pvVeg = this;
  }

  /** triângulos (passe principal, antes do frustum culling) por faixa de LOD — para medição de orçamento */
  budget() {
    const out = { trisNear: 0, trisMid: 0, trisImpostor: 0, trees: this.trees.length, nNear: this.stats.near, nMid: this.stats.mid, nFar: this.stats.far };
    const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (let i = 0; i < this.trees.length; i++) {
      const v = this.assets.variants[this.trees[i].variant];
      const l = this.lod[i];
      if (l === 0) out.trisNear += tri(v.lods[0].bark) + tri(v.lods[0].leaves);
      else if (l === 1) out.trisMid += tri(v.lods[1].bark) + tri(v.lods[1].leaves);
      else out.trisImpostor += 2;
    }
    return out;
  }

  /** escolhe uma variante para a espécie (determinística por posição) */
  variantFor(species: string, x: number, z: number): number {
    const list = this.variantsBySpecies.get(species) ?? this.variantsBySpecies.get('oiti')!;
    return list[Math.floor(hash2(x, z, 9) * list.length) % list.length];
  }

  setTrees(trees: TreeInstance[]) {
    this.trees = trees;
    this.lod = new Int8Array(trees.length).fill(-1);
    for (let lod = 0; lod < 2; lod++) {
      const { bark, leaves } = this.batches[lod];
      for (const id of this.ids[lod]) { bark.deleteInstance(id.b); leaves.deleteInstance(id.l); }
      this.ids[lod] = [];
      const need = trees.length;
      if (bark.maxInstanceCount < need) { bark.setInstanceCount(Math.ceil(need * 1.25)); leaves.setInstanceCount(Math.ceil(need * 1.25)); }
      for (const t of trees) {
        const g = this.geoIds[lod][t.variant];
        const b = bark.addInstance(g.bark), l = leaves.addInstance(g.leaves);
        this.dummy.position.set(t.x, t.y, t.z);
        this.dummy.rotation.set(0, t.rot, 0);
        this.dummy.scale.setScalar(t.scale);
        this.dummy.updateMatrix();
        bark.setMatrixAt(b, this.dummy.matrix);
        leaves.setMatrixAt(l, this.dummy.matrix);
        // variação sutil de tom por árvore (folhas) e de casca
        const h = hash2(t.x, t.z, 5);
        this.color.setRGB(0.9 + h * 0.2, 0.92 + hash2(t.x, t.z, 6) * 0.16, 0.9 + h * 0.15);
        leaves.setColorAt(l, this.color);
        this.color.setScalar(0.92 + hash2(t.x, t.z, 7) * 0.16);
        bark.setColorAt(b, this.color);
        bark.setVisibleAt(b, false);
        leaves.setVisibleAt(l, false);
        this.ids[lod].push({ b, l });
      }
    }
    // impostores
    const ig = this.impostor.geometry;
    if (ig.getAttribute('aPos').count < trees.length) {
      // atributos novos (o WebGL não redimensiona buffers): libera os antigos
      const cap = Math.ceil(trees.length * 1.25);
      ig.dispose();
      ig.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      ig.setAttribute('aImp', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    }
    this.lastCam.set(1e9, 0, 0);
  }

  /** reavalia o LOD de cada árvore (barato: só quando a câmera anda alguns metros) */
  update(cam: THREE.Vector3) {
    if (cam.distanceToSquared(this.lastCam) < 9 || !this.trees.length) return;
    this.lastCam.copy(cam);
    const n2 = this.opts.nearDist ** 2, m2 = this.opts.midDist ** 2;
    const ig = this.impostor.geometry;
    const aPos = ig.getAttribute('aPos') as THREE.InstancedBufferAttribute;
    const aImp = ig.getAttribute('aImp') as THREE.InstancedBufferAttribute;
    let imp = 0;
    const st = { near: 0, mid: 0, far: 0 };
    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const d2 = (t.x - cam.x) ** 2 + (t.z - cam.z) ** 2;
      const want = this.opts.forceLod ?? (d2 < n2 ? 0 : d2 < m2 ? 1 : 2);
      if (want === 0) st.near++; else if (want === 1) st.mid++; else st.far++;
      if (want === 2) {
        aPos.setXYZW(imp, t.x, t.y, t.z, t.scale);
        aImp.setXYZ(imp, t.variant, t.rot, this.impSizes[t.variant]);
        imp++;
      }
      const cur = this.lod[i];
      if (cur === want) continue;
      for (let lod = 0; lod < 2; lod++) {
        const vis = lod === want;
        const id = this.ids[lod][i];
        this.batches[lod].bark.setVisibleAt(id.b, vis);
        this.batches[lod].leaves.setVisibleAt(id.l, vis);
      }
      this.lod[i] = want;
    }
    aPos.needsUpdate = true;
    aImp.needsUpdate = true;
    ig.instanceCount = imp;
    this.impostor.visible = imp > 0;
    this.stats = st;
  }
}
