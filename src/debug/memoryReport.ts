/**
 * Relatório de memória (QA): `__pv.memoryReport()` — ver docs/MEMORY.md.
 *
 * Percorre a cena (e os caches de assets fora da cena) e estima, por categoria de dono:
 *  - texturas: largura × altura × bytes/texel (× 4/3 com mipmaps, × 6 em cubos) e a cópia que fica na CPU
 *    (DataTexture/canvas/ImageBitmap); com `?mem=1` usa o tamanho REAL alocado na GPU (livro-razão de memProbe.ts)
 *  - geometrias: bytes dos atributos/índices (a mesma cópia existe na CPU — o three.js mantém os arrays)
 *  - esqueletos (bone textures), clipes de animação, memória WASM (Rapier, meshopt) e heap JS (Chrome)
 * Detecta duplicatas: texturas com o mesmo conteúdo (hash), materiais com parâmetros idênticos e
 * geometrias com os mesmos dados.
 *
 * A categoria vem de `userData.category` (marcado onde o objeto é criado) no próprio objeto ou num ancestral;
 * na falta dela, do nome dos grupos-raiz conhecidos.
 */
import * as THREE from 'three';
import { gpuLedger, wasmMemories } from './memProbe';
import { assetManager } from '../core/AssetManager';

const MB = 1 / (1024 * 1024);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** nomes de grupos-raiz → categoria (fallback quando não há userData.category) */
const NAME_CATEGORY: [RegExp, string][] = [
  [/^buildings(Far)?_/, 'chunks/buildings'],
  [/^(ground|markings)_/, 'chunks/ground'],
  [/^world_chunks$/, 'chunks/ground'],
  [/^vegetation$/, 'vegetation'],
  [/^props$/, 'props'],
  [/^LANDMARK_|^landmark_|^model_/, 'landmarks'],
  [/^pedestrians$/, 'characters/npc'],
  [/^remote_players$/, 'characters/remote'],
  [/^avatar$/, 'characters/player'],
  [/^traffic$/, 'vehicles/traffic'],
  [/^rideables$/, 'vehicles/rideables'],
  [/^(monuments|street_signs)$/, 'monuments'],
  [/^(billboards|event_decorations)$/, 'events'],
  [/^(sky|clouds|sun)$/, 'environment'],
];

export function categoryOf(o: THREE.Object3D | null): string {
  for (let p = o; p; p = p.parent) {
    const c = p.userData?.category as string | undefined;
    if (c) return c;
    for (const [re, cat] of NAME_CATEGORY) if (re.test(p.name)) return cat;
  }
  return 'other';
}

interface Bucket { textures: number; texGpuMB: number; texCpuMB: number; geometries: number; geoMB: number; materials: number; skeletons: number; boneTexMB: number; objects: number }
const bucket = (): Bucket => ({ textures: 0, texGpuMB: 0, texCpuMB: 0, geometries: 0, geoMB: 0, materials: 0, skeletons: 0, boneTexMB: 0, objects: 0 });

function bppOf(t: THREE.Texture): number {
  const type = t.type;
  const comp = t.format === THREE.RedFormat || t.format === THREE.AlphaFormat ? 1 : t.format === THREE.RGFormat ? 2 : 4;
  const bytes = type === THREE.FloatType ? 4 : type === THREE.HalfFloatType ? 2 : type === THREE.UnsignedShortType ? 2 : type === THREE.UnsignedIntType || type === THREE.UnsignedInt248Type ? 4 : 1;
  return comp * bytes;
}

function texDims(t: THREE.Texture): { w: number; h: number; d: number } {
  const im = t.image as { width?: number; height?: number; depth?: number; videoWidth?: number; videoHeight?: number } | undefined;
  if (Array.isArray(t.image)) {
    const f = t.image[0] as { width?: number; height?: number; image?: { width: number; height: number } } | undefined;
    return { w: f?.width ?? f?.image?.width ?? 0, h: f?.height ?? f?.image?.height ?? 0, d: t.image.length };
  }
  return { w: im?.videoWidth || im?.width || 0, h: im?.videoHeight || im?.height || 0, d: im?.depth || 1 };
}

const usesMips = (t: THREE.Texture) => t.generateMipmaps && t.minFilter !== THREE.NearestFilter && t.minFilter !== THREE.LinearFilter;

/** estimativa da textura na GPU (bytes) */
function texGpuBytes(t: THREE.Texture, renderer?: THREE.WebGLRenderer): number {
  if (gpuLedger && renderer) {
    const wt = (renderer.properties.get(t) as { __webglTexture?: WebGLTexture }).__webglTexture;
    const o = wt ? gpuLedger.textures.get(wt) : undefined;
    if (o) return o.bytes;
    if (!wt) return 0; // ainda não enviada
  }
  const { w, h, d } = texDims(t);
  let b = w * h * d * bppOf(t);
  if ((t as THREE.CubeTexture).isCubeTexture) b *= 6;
  if (usesMips(t)) b = (b * 4) / 3;
  return b;
}

/** cópia mantida na CPU (pixels decodificados) */
function texCpuBytes(t: THREE.Texture): number {
  const im = t.image as { data?: ArrayBufferView; width?: number; height?: number; close?: () => void } | undefined;
  if (!im) return 0;
  if (im.data && (im.data as ArrayBufferView).byteLength !== undefined) return (im.data as ArrayBufferView).byteLength;
  if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) return im.width * im.height * 4;
  if (typeof HTMLCanvasElement !== 'undefined' && im instanceof HTMLCanvasElement) return im.width * im.height * 4;
  if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) return im.naturalWidth * im.naturalHeight * 4;
  return 0;
}

// ------------------------------------------------------------------------------ hashes (duplicatas)
function hashArray(a: ArrayLike<number> & { byteLength?: number }, h = 2166136261): number {
  const n = a.length;
  const step = Math.max(1, Math.floor(n / 4096));
  for (let i = 0; i < n; i += step) { h ^= (a[i] * 1000) | 0; h = Math.imul(h, 16777619); }
  h ^= n; return Math.imul(h, 16777619) >>> 0;
}

let hashCanvas: CanvasRenderingContext2D | null = null;
function texContentHash(t: THREE.Texture): string {
  const { w, h } = texDims(t);
  const im = t.image as { data?: ArrayLike<number> } | undefined;
  if (im?.data) return `d${w}x${h}:${hashArray(im.data)}`;
  try {
    hashCanvas ??= (() => { const c = document.createElement('canvas'); c.width = c.height = 24; return c.getContext('2d', { willReadFrequently: true }); })();
    if (!hashCanvas || !t.image) return `u${t.source.uuid}`;
    hashCanvas.clearRect(0, 0, 24, 24);
    hashCanvas.drawImage(t.image as CanvasImageSource, 0, 0, 24, 24);
    return `i${w}x${h}:${hashArray(hashCanvas.getImageData(0, 0, 24, 24).data)}`;
  } catch { return `u${t.source.uuid}`; }
}

function geoBytes(g: THREE.BufferGeometry, seen: Set<unknown>): number {
  let b = 0;
  const add = (arr: { byteLength: number } | null | undefined, key: unknown) => { if (arr && !seen.has(key)) { seen.add(key); b += arr.byteLength; } };
  for (const a of Object.values(g.attributes)) {
    const ia = a as THREE.InterleavedBufferAttribute;
    if (ia.isInterleavedBufferAttribute) add(ia.data.array as unknown as { byteLength: number }, ia.data);
    else add((a as THREE.BufferAttribute).array as unknown as { byteLength: number }, a);
  }
  for (const list of Object.values(g.morphAttributes)) for (const a of list) add((a as THREE.BufferAttribute).array as unknown as { byteLength: number }, a);
  if (g.index) add(g.index.array as unknown as { byteLength: number }, g.index);
  return b;
}
/** contagem de bytes "fantasma": geometrias cujo array da CPU foi liberado após o upload (AssetManager.releaseCpu) */
function geoGpuOnly(g: THREE.BufferGeometry): number { return (g.userData?.gpuBytes as number | undefined) ?? 0; }

function geoHash(g: THREE.BufferGeometry): string {
  let h = 2166136261;
  for (const [k, a] of Object.entries(g.attributes)) {
    const arr = (a as THREE.BufferAttribute).array;
    if (!arr) return `free:${g.uuid}`;
    h = hashArray(arr, h ^ k.length);
  }
  if (g.index?.array) h = hashArray(g.index.array, h);
  return `${Object.keys(g.attributes).join(',')}:${g.attributes.position?.count ?? 0}:${h}`;
}

const MAT_SKIP = new Set(['uuid', 'id', 'name', 'version', 'userData', '_listeners', 'needsUpdate', 'uniformsNeedUpdate']);
function matKey(m: THREE.Material): string {
  const parts: string[] = [m.type];
  for (const [k, v] of Object.entries(m)) {
    if (MAT_SKIP.has(k) || typeof v === 'function') continue;
    if (v && (v as THREE.Texture).isTexture) parts.push(`${k}=T${(v as THREE.Texture).source.uuid}`);
    else if (v && (v as THREE.Color).isColor) parts.push(`${k}=${(v as THREE.Color).getHexString()}`);
    else if (v && typeof v === 'object' && 'toArray' in (v as object)) parts.push(`${k}=${(v as { toArray(): number[] }).toArray().join(',')}`);
    else if (v === null || typeof v !== 'object') parts.push(`${k}=${String(v)}`);
  }
  parts.push(`obc=${m.onBeforeCompile.toString().length}:${m.customProgramCacheKey()}`);
  return parts.join('|');
}

function materialTextures(m: THREE.Material, renderer?: THREE.WebGLRenderer): THREE.Texture[] {
  const out = new Set<THREE.Texture>();
  for (const v of Object.values(m)) if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
  const uni = (m as THREE.ShaderMaterial).uniforms;
  // uniforms injetados por onBeforeCompile ficam nas propriedades internas do renderer
  const internal = renderer ? (renderer.properties.get(m) as { uniforms?: Record<string, THREE.IUniform> }).uniforms : undefined;
  for (const u of [uni, internal]) if (u) for (const x of Object.values(u)) {
    const v = x?.value;
    if (v && (v as THREE.Texture).isTexture) out.add(v as THREE.Texture);
    if (Array.isArray(v)) for (const e of v) if (e && (e as THREE.Texture).isTexture) out.add(e as THREE.Texture);
  }
  return [...out];
}

export interface MemoryReportOptions {
  /** inclui hashes de conteúdo (duplicatas). Mais lento (~100 ms). */
  duplicates?: boolean;
  /** raízes fora da cena a incluir (ex.: caches) */
  extra?: { category: string; object: THREE.Object3D }[];
}

export function memoryReport(renderer: THREE.WebGLRenderer, scene: THREE.Scene, opts: MemoryReportOptions = {}) {
  const dup = opts.duplicates !== false;
  const cats = new Map<string, Bucket>();
  const B = (c: string) => { let b = cats.get(c); if (!b) { b = bucket(); cats.set(c, b); } return b; };
  const seenTex = new Map<THREE.Texture, string>();
  const seenGeo = new Set<THREE.BufferGeometry>();
  const seenArr = new Set<unknown>();
  const seenMat = new Set<THREE.Material>();
  const seenSkel = new Set<THREE.Skeleton>();
  const texList: { t: THREE.Texture; cat: string; gpu: number; cpu: number }[] = [];
  const geoList: { g: THREE.BufferGeometry; cat: string; bytes: number }[] = [];
  const matList: { m: THREE.Material; cat: string }[] = [];

  const addTex = (t: THREE.Texture, cat: string) => {
    if (seenTex.has(t)) return;
    seenTex.set(t, cat);
    const gpu = texGpuBytes(t, renderer), cpu = texCpuBytes(t);
    const b = B(cat); b.textures++; b.texGpuMB += gpu * MB; b.texCpuMB += cpu * MB;
    texList.push({ t, cat, gpu, cpu });
  };
  const addGeo = (g: THREE.BufferGeometry, cat: string) => {
    if (seenGeo.has(g)) return;
    seenGeo.add(g);
    const bytes = geoBytes(g, seenArr) + geoGpuOnly(g);
    const b = B(cat); b.geometries++; b.geoMB += bytes * MB;
    geoList.push({ g, cat, bytes });
  };
  const addMat = (m: THREE.Material, cat: string) => {
    if (seenMat.has(m)) return;
    seenMat.add(m);
    B(cat).materials++;
    matList.push({ m, cat });
    for (const t of materialTextures(m, renderer)) addTex(t, cat);
  };
  const visit = (o: THREE.Object3D, forced?: string) => {
    const cat = forced ?? categoryOf(o);
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) addGeo(mesh.geometry, cat);
    if (mesh.material) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) addMat(m, cat);
    if (mesh.geometry || mesh.material) B(cat).objects++;
    // texturas internas (BatchedMesh: matrizes/cores/indireto; InstancedMesh: atributos de instância)
    for (const v of Object.values(o)) if (v && (v as THREE.Texture).isTexture) addTex(v as THREE.Texture, cat);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      const b = B(cat);
      for (const a of [im.instanceMatrix, im.instanceColor, (im as unknown as { morphTexture?: unknown }).morphTexture]) {
        const arr = (a as THREE.BufferAttribute | null)?.array as unknown as { byteLength: number } | undefined;
        if (arr && !seenArr.has(a)) { seenArr.add(a); b.geoMB += arr.byteLength * MB; }
      }
    }
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk && !seenSkel.has(sk)) {
      seenSkel.add(sk);
      const b = B(cat); b.skeletons++;
      b.boneTexMB += ((sk.boneTexture ? texGpuBytes(sk.boneTexture, renderer) : 0) + (sk.boneMatrices?.byteLength ?? 0)) * MB;
    }
  };
  scene.traverse((o) => visit(o));
  if (scene.environment) addTex(scene.environment, 'environment');
  if (scene.background && (scene.background as THREE.Texture).isTexture) addTex(scene.background as THREE.Texture, 'environment');
  // mapas de sombra
  scene.traverse((o) => { const l = o as THREE.DirectionalLight; if (l.isLight && l.shadow?.map) addTex(l.shadow.map.texture, 'shadows'); });
  for (const e of opts.extra ?? []) e.object.traverse((o) => visit(o, e.category));
  // caches do AssetManager fora da cena (GLTFs de personagem/veículo, texturas e geometrias registradas)
  for (const e of assetManager.reportEntries()) {
    if (e.object) e.object.traverse((o) => visit(o, e.category));
    if (e.texture) addTex(e.texture, e.category);
    if (e.geometry) addGeo(e.geometry, e.category);
    if (e.material) addMat(e.material, e.category);
  }

  // animação: clipes registrados
  const anim = assetManager.clipStats();

  // GPU real (livro-razão)
  let ledger: Record<string, number> | null = null;
  if (gpuLedger) {
    const sum = (m: Map<unknown, { bytes: number }>) => { let s = 0; for (const v of m.values()) s += v.bytes; return s; };
    const texTotal = sum(gpuLedger.textures), bufTotal = sum(gpuLedger.buffers), rbTotal = sum(gpuLedger.renderbuffers);
    const attributedTex = texList.reduce((s, x) => s + x.gpu, 0);
    ledger = {
      texturesMB: r1(texTotal * MB), textureCount: gpuLedger.textures.size,
      buffersMB: r1(bufTotal * MB), bufferCount: gpuLedger.buffers.size,
      renderbuffersMB: r1(rbTotal * MB), renderbufferCount: gpuLedger.renderbuffers.size,
      /** texturas na GPU que não pertencem a nenhum material da cena (alvos de render internos: composer, PMREM, prévia…) */
      unattributedTexMB: r1((texTotal - attributedTex) * MB),
      totalMB: r1((texTotal + bufTotal + rbTotal) * MB),
    };
  }

  // duplicatas
  const duplicates = { textures: [] as { key: string; count: number; wastedMB: number; names: string[]; cats: string[] }[], materials: [] as { key: string; count: number; cats: string[]; names: string[] }[], geometries: [] as { count: number; wastedMB: number; cats: string[]; names: string[] }[] };
  if (dup) {
    const tg = new Map<string, typeof texList>();
    for (const x of texList) {
      if ((x.t as THREE.DataTexture).isDataTexture && x.t.image && (x.t.image as { data?: unknown }).data === null) continue;
      if (x.t.isRenderTargetTexture || (x.t as unknown as { isVideoTexture?: boolean }).isVideoTexture) continue;
      const k = texContentHash(x.t);
      let a = tg.get(k); if (!a) { a = []; tg.set(k, a); } a.push(x);
    }
    for (const [key, a] of tg) if (a.length > 1 && new Set(a.map((x) => x.t.source)).size > 1) {
      const bySource = new Map<THREE.Source, (typeof a)[number]>();
      for (const x of a) if (!bySource.has(x.t.source)) bySource.set(x.t.source, x);
      const uniq = [...bySource.values()];
      duplicates.textures.push({ key, count: uniq.length, wastedMB: r1(uniq.slice(1).reduce((s, x) => s + x.gpu, 0) * MB), names: [...new Set(uniq.map((x) => x.t.name || '?'))].slice(0, 6), cats: [...new Set(uniq.map((x) => x.cat))] });
    }
    duplicates.textures.sort((a, b) => b.wastedMB - a.wastedMB);
    const mg = new Map<string, typeof matList>();
    for (const x of matList) { const k = matKey(x.m); let a = mg.get(k); if (!a) { a = []; mg.set(k, a); } a.push(x); }
    for (const [key, a] of mg) if (a.length > 1) duplicates.materials.push({ key: key.slice(0, 120), count: a.length, cats: [...new Set(a.map((x) => x.cat))], names: [...new Set(a.map((x) => x.m.name || x.m.type))].slice(0, 6) });
    duplicates.materials.sort((a, b) => b.count - a.count);
    const gg = new Map<string, typeof geoList>();
    for (const x of geoList) { const k = geoHash(x.g); if (k.startsWith('free:')) continue; let a = gg.get(k); if (!a) { a = []; gg.set(k, a); } a.push(x); }
    for (const a of gg.values()) if (a.length > 1 && a[0].bytes > 0) duplicates.geometries.push({ count: a.length, wastedMB: r1(a.slice(1).reduce((s, x) => s + x.bytes, 0) * MB), cats: [...new Set(a.map((x) => x.cat))], names: [...new Set(a.map((x) => x.g.name || x.g.type))].slice(0, 4) });
    duplicates.geometries.sort((a, b) => b.wastedMB - a.wastedMB);
  }

  const categories: Record<string, Record<string, number>> = {};
  for (const [k, b] of [...cats].sort((a, b2) => (b2[1].texGpuMB + b2[1].geoMB) - (a[1].texGpuMB + a[1].geoMB))) {
    categories[k] = { textures: b.textures, texGpuMB: r1(b.texGpuMB), texCpuMB: r1(b.texCpuMB), geometries: b.geometries, geoMB: r1(b.geoMB), materials: b.materials, skeletons: b.skeletons, boneTexMB: r1(b.boneTexMB), objects: b.objects };
  }
  const tot = [...cats.values()].reduce((s, b) => ({ texGpu: s.texGpu + b.texGpuMB, texCpu: s.texCpu + b.texCpuMB, geo: s.geo + b.geoMB, bone: s.bone + b.boneTexMB }), { texGpu: 0, texCpu: 0, geo: 0, bone: 0 });
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  const wasm = wasmMemories.map((w) => ({ label: w.label, MB: r1(w.memory.buffer.byteLength * MB) }));
  const topTextures = texList.slice().sort((a, b) => b.gpu - a.gpu).slice(0, 25).map((x) => {
    const d = texDims(x.t);
    return { name: x.t.name || x.t.constructor.name, cat: x.cat, size: `${d.w}x${d.h}${d.d > 1 ? `x${d.d}` : ''}`, gpuMB: r1(x.gpu * MB), cpuMB: r1(x.cpu * MB), mip: usesMips(x.t) };
  });
  const topGeometries = geoList.slice().sort((a, b) => b.bytes - a.bytes).slice(0, 15).map((x) => ({ name: x.g.name || x.g.type, cat: x.cat, MB: r1(x.bytes * MB), verts: x.g.attributes.position?.count ?? 0 }));
  return {
    t: Math.round(performance.now()),
    heap: mem ? { usedMB: r1(mem.usedJSHeapSize * MB), totalMB: r1(mem.totalJSHeapSize * MB) } : null,
    renderer: { textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length ?? 0 },
    totals: {
      textures: texList.length, texGpuMB: r1(tot.texGpu), texCpuMB: r1(tot.texCpu), geometries: geoList.length, geoMB: r1(tot.geo), materials: matList.length, skeletons: seenSkel.size, boneTexMB: r1(tot.bone),
      /** estimativa GPU = texturas + buffers de geometria (+ bone textures) */
      gpuEstMB: r1(tot.texGpu + tot.geo + tot.bone),
    },
    categories, ledger, wasm, animation: anim, assets: assetManager.summary(),
    duplicates: dup ? { textures: duplicates.textures.slice(0, 30), materials: duplicates.materials.slice(0, 30), geometries: duplicates.geometries.slice(0, 30), counts: { textures: duplicates.textures.length, texWastedMB: r1(duplicates.textures.reduce((s, x) => s + x.wastedMB, 0)), materials: duplicates.materials.reduce((s, x) => s + x.count - 1, 0), geometries: duplicates.geometries.reduce((s, x) => s + x.count - 1, 0), geoWastedMB: r1(duplicates.geometries.reduce((s, x) => s + x.wastedMB, 0)) } } : null,
    topTextures, topGeometries,
  };
}
