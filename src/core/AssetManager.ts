/**
 * Gerenciador central de assets (rodada 6 — memória; ver docs/MEMORY.md).
 *
 * - Texturas por URL: uma única `THREE.Texture` por (URL + opções), com contagem de referências.
 * - GLTF por URL: um carregamento por URL (meshopt), com contagem de referências; as IMAGENS embutidas são
 *   deduplicadas por conteúdo (hash dos bytes do bufferView) entre TODOS os GLBs — p.ex. os acessórios,
 *   olhos e sobrancelhas idênticos em homem/mulher/idoso/idosa e em LOD0/LOD1 viram uma só imagem
 *   decodificada e uma só textura na GPU (o three.js compartilha a textura WebGL entre texturas com a mesma
 *   `Source` e os mesmos parâmetros).
 * - Materiais compartilhados por chave (`material(key, factory)`).
 * - Liberação da cópia na CPU após o upload (`releaseCpuAfterUpload`): pixels de DataTexture/canvas e arrays
 *   de geometrias estáticas que nunca são relidos. Só depois de o jogo assumir o renderer (`cpuRelease = true`):
 *   a prévia do avatar usa outro contexto WebGL e precisa dos mesmos dados.
 * - Registro para o relatório de memória (`__pv.memoryReport()`): o que vive fora da cena também é contado.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

interface Entry<T> { value: Promise<T>; refs: number; category: string; resolved?: T }
export interface ReportEntry { category: string; object?: THREE.Object3D; texture?: THREE.Texture; geometry?: THREE.BufferGeometry; material?: THREE.Material }

export interface TextureOptions {
  srgb?: boolean;
  anisotropy?: number;
  wrap?: THREE.Wrapping;
  /** libera a imagem decodificada da CPU depois do upload (padrão: true) */
  releaseCpu?: boolean;
}

/** hash FNV-1a (32 bits) de bytes — chave de conteúdo das imagens embutidas */
export function hashBytes(buf: ArrayBuffer | ArrayBufferView): string {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ u8.length;
  const n4 = u8.length & ~3;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0; i < n4; i += 4) {
    const w = dv.getUint32(i, true);
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ (w >>> 7 | w << 25), 0x5bd1e995);
  }
  for (let i = n4; i < u8.length; i++) h1 = Math.imul(h1 ^ u8[i], 0x01000193);
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${u8.length}`;
}

export class AssetManager {
  private textures = new Map<string, Entry<THREE.Texture>>();
  private gltfs = new Map<string, Entry<GLTF>>();
  private materials = new Map<string, { mat: THREE.Material; refs: number; category: string }>();
  /** imagens embutidas em GLBs, por hash do conteúdo → textura-fonte (a Source é compartilhada) */
  private imageSources = new Map<string, Promise<THREE.Texture>>();
  private registered = new Set<ReportEntry>();
  private clips = new Map<string, THREE.AnimationClip[]>();
  private texLoader = new THREE.TextureLoader();
  private gltfLoader: GLTFLoader | null = null;
  stats = { textureHits: 0, textureLoads: 0, gltfHits: 0, gltfLoads: 0, imagesDeduped: 0, imagesDecoded: 0, cpuReleasedMB: 0, materialHits: 0 };
  /** liberação de cópias na CPU após upload: ligada pelo jogo (a prévia do avatar usa outro contexto) */
  cpuRelease = false;

  // ------------------------------------------------------------------ texturas por URL
  loadTexture(url: string, category: string, opts: TextureOptions = {}): Promise<THREE.Texture> {
    const key = `${url}|${opts.srgb ? 's' : 'l'}|${opts.anisotropy ?? 1}|${opts.wrap ?? 0}`;
    const e = this.textures.get(key);
    if (e) { e.refs++; this.stats.textureHits++; return e.value; }
    this.stats.textureLoads++;
    const value = this.texLoader.loadAsync(url).then((t) => {
      t.name = url.split('/').pop() ?? url;
      t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (opts.anisotropy) t.anisotropy = opts.anisotropy;
      if (opts.wrap !== undefined) t.wrapS = t.wrapT = opts.wrap;
      t.userData.category = category;
      if (opts.releaseCpu !== false) this.releaseCpuAfterUpload(t);
      entry.resolved = t;
      return t;
    });
    const entry: Entry<THREE.Texture> = { value, refs: 1, category };
    this.textures.set(key, entry);
    value.catch(() => this.textures.delete(key));
    return value;
  }

  /** devolve uma referência; com 0 referências a textura é descartada (GPU) e sai do cache */
  releaseTexture(t: THREE.Texture) {
    for (const [k, e] of this.textures) if (e.resolved === t) {
      if (--e.refs <= 0) { t.dispose(); this.textures.delete(k); }
      return;
    }
  }

  // ------------------------------------------------------------------ GLTF
  private loader(): GLTFLoader {
    if (this.gltfLoader) return this.gltfLoader;
    const l = new GLTFLoader();
    l.setMeshoptDecoder(MeshoptDecoder);
    // plugin "falso": só intercepta o carregamento de imagens do parser para deduplicar por conteúdo
    l.register((parser) => { this.patchParser(parser); return { name: 'PV_dedupe_images' }; });
    this.gltfLoader = l;
    return l;
  }

  private patchParser(parser: GLTFParser) {
    const p = parser as unknown as {
      json: { images?: { bufferView?: number; uri?: string; mimeType?: string }[] };
      loadImageSource(sourceIndex: number, loader: THREE.Loader): Promise<THREE.Texture>;
      getDependency(type: string, index: number): Promise<ArrayBuffer>;
    };
    const orig = p.loadImageSource.bind(parser);
    const local = new Map<number, Promise<THREE.Texture>>();
    p.loadImageSource = (sourceIndex, loader) => {
      const hit = local.get(sourceIndex);
      if (hit) return hit;
      const def = p.json.images?.[sourceIndex];
      let out: Promise<THREE.Texture>;
      if (def?.bufferView === undefined) out = orig(sourceIndex, loader);
      else {
        out = p.getDependency('bufferView', def.bufferView).then((bytes) => {
          const key = `${def.mimeType ?? ''}:${hashBytes(bytes)}`;
          let src = this.imageSources.get(key);
          if (src) this.stats.imagesDeduped++;
          else {
            this.stats.imagesDecoded++;
            src = orig(sourceIndex, loader);
            this.imageSources.set(key, src);
            src.catch(() => this.imageSources.delete(key));
          }
          return src;
        });
      }
      local.set(sourceIndex, out);
      return out;
    };
  }

  /** carrega um GLTF uma vez por URL (referência contada). Texturas embutidas deduplicadas entre arquivos. */
  loadGLTF(url: string, category: string): Promise<GLTF> {
    const e = this.gltfs.get(url);
    if (e) { e.refs++; this.stats.gltfHits++; return e.value; }
    this.stats.gltfLoads++;
    const entry: Entry<GLTF> = { value: null as unknown as Promise<GLTF>, refs: 1, category };
    entry.value = this.loader().loadAsync(url).then((g) => {
      g.scene.userData.category = category;
      g.scene.name ||= url.split('/').pop() ?? url;
      entry.resolved = g;
      return g;
    });
    this.gltfs.set(url, entry);
    entry.value.catch(() => this.gltfs.delete(url));
    return entry.value;
  }

  /** devolve uma referência do GLTF; com 0 referências descarta geometrias/materiais/texturas dele */
  releaseGLTF(url: string) {
    const e = this.gltfs.get(url);
    if (!e || --e.refs > 0) return;
    this.gltfs.delete(url);
    const g = e.resolved;
    if (!g) return;
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      for (const mat of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) {
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    });
  }

  // ------------------------------------------------------------------ materiais compartilhados
  /** material compartilhado por chave (mesmos parâmetros ⇒ mesma instância ⇒ mesmo programa e menos estado) */
  material<T extends THREE.Material>(key: string, category: string, factory: () => T): T {
    const e = this.materials.get(key);
    if (e) { e.refs++; this.stats.materialHits++; return e.mat as T; }
    const mat = factory();
    this.materials.set(key, { mat, refs: 1, category });
    return mat;
  }

  releaseMaterial(key: string) {
    const e = this.materials.get(key);
    if (!e || --e.refs > 0) return;
    e.mat.dispose();
    this.materials.delete(key);
  }

  // ------------------------------------------------------------------ cópias na CPU
  /**
   * Depois do primeiro upload (no renderer do jogo), solta os pixels mantidos na CPU:
   * DataTexture → data = null; canvas → substituído por {width,height}; ImageBitmap → close().
   * Só para texturas que nunca são reenviadas (sem needsUpdate posterior).
   */
  releaseCpuAfterUpload(t: THREE.Texture) {
    const tt = t as unknown as { onUpdate: ((tex: THREE.Texture) => void) | null };
    const prev = tt.onUpdate;
    tt.onUpdate = (tex: THREE.Texture) => {
      prev?.call(tex, tex);
      if (!this.cpuRelease) return;
      const im = tex.image as { width?: number; height?: number; data?: ArrayBufferView | null; close?: () => void } | null;
      if (!im) return;
      const w = im.width ?? 0, h = im.height ?? 0;
      tex.userData.gpuW = w; tex.userData.gpuH = h;
      let freed = 0;
      if (im.data) { freed = im.data.byteLength; im.data = null; }
      else if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) { freed = w * h * 4; tex.source.data = { width: w, height: h }; im.width = im.height = 0; }
      else if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) { freed = w * h * 4; tex.source.data = { width: w, height: h }; im.close(); }
      this.stats.cpuReleasedMB += freed / 1048576;
      tt.onUpdate = prev;
    };
  }

  /**
   * Geometria estática (nunca relida na CPU: sem raycast/colisão por malha): solta os arrays depois do upload.
   * Bounding box/sphere são calculados antes. O tamanho fica em userData.gpuBytes para o relatório.
   */
  releaseGeometryCpu(g: THREE.BufferGeometry) {
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingBox) g.computeBoundingBox();
    let bytes = 0;
    const attrs: THREE.BufferAttribute[] = [...Object.values(g.attributes) as THREE.BufferAttribute[]];
    if (g.index) attrs.push(g.index);
    for (const a of attrs) {
      if ((a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
      bytes += a.array.byteLength;
      a.onUpload(function (this: THREE.BufferAttribute) {
        if (!assetManager.cpuRelease) return;
        assetManager.stats.cpuReleasedMB += this.array.byteLength / 1048576;
        // o three.js só relê o array se a versão mudar (needsUpdate) — geometria estática não muda
        (this as unknown as { array: ArrayLike<number> | null }).array = null;
      });
    }
    g.userData.gpuBytes = bytes;
  }

  // ------------------------------------------------------------------ relatório
  /** registra algo que vive fora da cena para o relatório de memória; devolve função para cancelar */
  register(e: ReportEntry): () => void {
    this.registered.add(e);
    return () => this.registered.delete(e);
  }

  registerClips(owner: string, clips: THREE.AnimationClip[]) { this.clips.set(owner, clips); }

  reportEntries(): ReportEntry[] {
    const out = [...this.registered];
    for (const e of this.gltfs.values()) if (e.resolved) out.push({ category: e.category, object: e.resolved.scene });
    for (const e of this.textures.values()) if (e.resolved) out.push({ category: e.category, texture: e.resolved });
    for (const e of this.materials.values()) out.push({ category: e.category, material: e.mat });
    return out;
  }

  clipStats() {
    const seen = new Set<ArrayLike<number>>();
    let clips = 0, tracks = 0, bytes = 0;
    for (const list of this.clips.values()) for (const c of list) {
      clips++;
      for (const t of c.tracks) {
        tracks++;
        for (const a of [t.times, t.values]) if (!seen.has(a)) { seen.add(a); bytes += (a as Float32Array).byteLength ?? a.length * 4; }
      }
    }
    return { clips, tracks, MB: Math.round(bytes / 104857.6) / 10 };
  }

  summary() {
    return {
      ...this.stats, cpuReleasedMB: Math.round(this.stats.cpuReleasedMB * 10) / 10,
      textures: [...this.textures.entries()].map(([k, e]) => ({ key: k.split('|')[0].split('/').pop(), refs: e.refs })),
      gltfs: [...this.gltfs.entries()].map(([k, e]) => ({ url: k.split('/').pop(), refs: e.refs })),
      materials: this.materials.size, imageSources: this.imageSources.size,
    };
  }
}

export const assetManager = new AssetManager();
