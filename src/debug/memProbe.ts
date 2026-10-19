/**
 * Sondas de memória de baixo nível (sem three.js — importado no início de main.ts).
 *
 * 1. WASM: registra a `WebAssembly.Memory` de cada módulo instanciado (Rapier, decodificador meshopt…)
 *    para o relatório (`__pv.memoryReport()`) — a memória linear de um módulo WASM só cresce.
 * 2. Livro-razão da GPU (só com `?mem=1`): intercepta as chamadas de ALOCAÇÃO do WebGL2
 *    (texImage/texStorage, bufferData, renderbufferStorage) e mantém o tamanho vivo de cada textura,
 *    buffer e renderbuffer — inclui o que não está na cena (alvos de renderização, PMREM, sombra, composer).
 *    Desligado por padrão: os binds são interceptados e isso tem custo de CPU.
 */

export interface WasmMem { label: string; memory: WebAssembly.Memory }
export const wasmMemories: WasmMem[] = [];

function recordInstance(inst: WebAssembly.Instance, hint: string) {
  for (const [k, v] of Object.entries(inst.exports)) {
    if (v instanceof WebAssembly.Memory && !wasmMemories.some((m) => m.memory === v)) {
      const names = Object.keys(inst.exports);
      const label = names.some((n) => n.startsWith('raw')) ? 'rapier' : names.includes('meshopt_decodeVertexBuffer') || names.includes('sbrk') ? 'meshopt' : `${hint}:${k}`;
      wasmMemories.push({ label, memory: v });
    }
  }
}

if (typeof WebAssembly !== 'undefined' && !(WebAssembly as unknown as { __pvMem?: boolean }).__pvMem) {
  (WebAssembly as unknown as { __pvMem?: boolean }).__pvMem = true;
  const inst = WebAssembly.instantiate.bind(WebAssembly);
  (WebAssembly as { instantiate: unknown }).instantiate = async (src: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
    const r = await (inst as (s: unknown, i?: unknown) => Promise<WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance>)(src, imports);
    recordInstance((r as WebAssembly.WebAssemblyInstantiatedSource).instance ?? (r as WebAssembly.Instance), 'wasm');
    return r;
  };
  if (WebAssembly.instantiateStreaming) {
    const st = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = async (src, imports) => {
      const r = await st(src, imports);
      recordInstance(r.instance, 'wasm-stream');
      return r;
    };
  }
}

// ------------------------------------------------------------------------------------------------ GPU
export interface GpuObj { kind: 'texture' | 'buffer' | 'renderbuffer'; bytes: number; w: number; h: number; d: number; levels: Map<number, number>; mip: boolean; fmt: number;
  /** contexto dono (rodada 11): objetos de contexto PERDIDO (prévia 3D descartada com forceContextLoss) já foram liberados pelo navegador */
  gl?: { isContextLost(): boolean } }
export interface GpuLedger { textures: Map<WebGLTexture, GpuObj>; buffers: Map<WebGLBuffer, GpuObj>; renderbuffers: Map<WebGLRenderbuffer, GpuObj> }
export let gpuLedger: GpuLedger | null = null;
/** tira do livro-razão o que pertence a contextos PERDIDOS (o navegador já liberou; nunca haverá deleteTexture). Devolve
 * quantos objetos/bytes saíram — chamado antes de cada relatório. */
export function purgeLostContexts(): { objects: number; bytes: number } {
  let objects = 0, bytes = 0;
  if (!gpuLedger) return { objects, bytes };
  for (const m of [gpuLedger.textures, gpuLedger.buffers, gpuLedger.renderbuffers] as Map<object, GpuObj>[]) {
    for (const [k, o] of m) { let lost = false; try { lost = !!o.gl?.isContextLost(); } catch { /* */ } if (lost) { m.delete(k); objects++; bytes += o.bytes; } }
  }
  purgedTotal.objects += objects; purgedTotal.bytes += bytes;
  return { objects, bytes };
}
export const purgedTotal = { objects: 0, bytes: 0 };

const GL = (typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext : {}) as typeof WebGL2RenderingContext;
/** bytes por texel por formato interno (os não listados contam 4) */
const BPP: Record<number, number> = {
  [GL.R8]: 1, [GL.RG8]: 2, [GL.RGB8]: 4, [GL.RGBA8]: 4, [GL.SRGB8]: 4, [GL.SRGB8_ALPHA8]: 4, [GL.RGBA]: 4, [GL.RGB]: 4,
  [GL.LUMINANCE]: 1, [GL.ALPHA]: 1, [GL.LUMINANCE_ALPHA]: 2, [GL.RED]: 1,
  [GL.R16F]: 2, [GL.RG16F]: 4, [GL.RGB16F]: 8, [GL.RGBA16F]: 8, [GL.R32F]: 4, [GL.RG32F]: 8, [GL.RGB32F]: 16, [GL.RGBA32F]: 16,
  [GL.R11F_G11F_B10F]: 4, [GL.RGB10_A2]: 4,
  [GL.DEPTH_COMPONENT16]: 2, [GL.DEPTH_COMPONENT24]: 4, [GL.DEPTH_COMPONENT32F]: 4, [GL.DEPTH24_STENCIL8]: 4, [GL.DEPTH32F_STENCIL8]: 8,
  [GL.DEPTH_COMPONENT]: 4, [GL.DEPTH_STENCIL]: 4,
};
const bppOf = (internal: number, type?: number) => {
  if (internal === GL.RGBA && type === GL.FLOAT) return 16;
  if (internal === GL.RGBA && type === GL.HALF_FLOAT) return 8;
  return BPP[internal] ?? 4;
};

function installLedger() {
  if (gpuLedger) return;
  const L: GpuLedger = { textures: new Map(), buffers: new Map(), renderbuffers: new Map() };
  gpuLedger = L;
  (globalThis as unknown as { __pvGpuLedger?: GpuLedger }).__pvGpuLedger = L; // QA: histograma por tamanho/formato (soak)
  const P = GL.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const ctxState = new WeakMap<object, { unit: number; tex: Map<string, WebGLTexture | null>; buf: Map<number, WebGLBuffer | null>; rb: WebGLRenderbuffer | null }>();
  const st = (gl: object) => {
    let s = ctxState.get(gl);
    if (!s) { s = { unit: GL.TEXTURE0, tex: new Map(), buf: new Map(), rb: null }; ctxState.set(gl, s); }
    return s;
  };
  const wrap = (name: string, after: (gl: object, args: unknown[], ret: unknown) => void) => {
    const orig = P[name];
    if (!orig) return;
    P[name] = function (this: object, ...args: unknown[]) {
      const ret = orig.apply(this, args);
      try { after(this, args, ret); } catch { /* só medição */ }
      return ret;
    };
  };
  const faceTarget = (t: number) => (t >= GL.TEXTURE_CUBE_MAP_POSITIVE_X && t <= GL.TEXTURE_CUBE_MAP_NEGATIVE_Z ? GL.TEXTURE_CUBE_MAP : t);
  const bound = (gl: object, target: number) => st(gl).tex.get(`${st(gl).unit}:${faceTarget(target)}`) ?? null;
  const texObj = (tex: WebGLTexture, gl?: object): GpuObj => {
    let o = L.textures.get(tex);
    if (!o) { o = { kind: 'texture', bytes: 0, w: 0, h: 0, d: 1, levels: new Map(), mip: false, fmt: 0, gl: gl as GpuObj['gl'] }; L.textures.set(tex, o); }
    return o;
  };
  const recompute = (o: GpuObj) => { let s = 0; for (const v of o.levels.values()) s += v; o.bytes = o.mip ? Math.round(s * 4 / 3) : s; };

  wrap('activeTexture', (gl, a) => { st(gl).unit = a[0] as number; });
  wrap('bindTexture', (gl, a) => { st(gl).tex.set(`${st(gl).unit}:${a[0]}`, a[1] as WebGLTexture | null); });
  wrap('deleteTexture', (_gl, a) => { L.textures.delete(a[0] as WebGLTexture); });
  wrap('texStorage2D', (gl, a) => {
    const [target, levels, internal, w, h] = a as number[];
    const t = bound(gl, target); if (!t) return;
    const o = texObj(t, gl);
    const faces = target === GL.TEXTURE_CUBE_MAP ? 6 : 1;
    o.levels.clear(); o.mip = false; o.w = w; o.h = h; o.fmt = internal;
    for (let l = 0; l < levels; l++) o.levels.set(l, Math.max(1, w >> l) * Math.max(1, h >> l) * bppOf(internal) * faces);
    recompute(o);
  });
  wrap('texStorage3D', (gl, a) => {
    const [target, levels, internal, w, h, d] = a as number[];
    const t = bound(gl, target); if (!t) return;
    const o = texObj(t, gl);
    o.levels.clear(); o.mip = false; o.w = w; o.h = h; o.d = d; o.fmt = internal;
    for (let l = 0; l < levels; l++) o.levels.set(l, Math.max(1, w >> l) * Math.max(1, h >> l) * (target === GL.TEXTURE_3D ? Math.max(1, d >> l) : d) * bppOf(internal));
    recompute(o);
  });
  wrap('texImage2D', (gl, a) => {
    const target = a[0] as number, level = a[1] as number, internal = a[2] as number;
    let w: number, h: number, type: number | undefined;
    if (a.length >= 8 && typeof a[3] === 'number' && typeof a[4] === 'number') { w = a[3] as number; h = a[4] as number; type = a[7] as number; }
    else { const src = a[5] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number }; w = src?.videoWidth || src?.width || 0; h = src?.videoHeight || src?.height || 0; type = a[4] as number; }
    const t = bound(gl, target); if (!t) return;
    const o = texObj(t, gl);
    if (level === 0) { o.w = w; o.h = h; o.fmt = internal; }
    const face = target - GL.TEXTURE_CUBE_MAP_POSITIVE_X;
    const key = target === faceTarget(target) ? level : level * 8 + face + 1000;
    o.levels.set(key, w * h * bppOf(internal, type));
    recompute(o);
  });
  wrap('texImage3D', (gl, a) => {
    const [target, level, internal, w, h, d] = a as number[];
    const t = bound(gl, target); if (!t) return;
    const o = texObj(t, gl);
    if (level === 0) { o.w = w; o.h = h; o.d = d; o.fmt = internal; }
    o.levels.set(level, w * h * d * bppOf(internal, a[8] as number));
    recompute(o);
  });
  wrap('compressedTexImage2D', (gl, a) => {
    const [target, level, internal, w, h] = a as number[];
    const t = bound(gl, target); if (!t) return;
    const o = texObj(t, gl);
    if (level === 0) { o.w = w; o.h = h; o.fmt = internal; }
    o.levels.set(level, (a[6] as ArrayBufferView)?.byteLength ?? 0);
    recompute(o);
  });
  wrap('generateMipmap', (gl, a) => {
    const t = bound(gl, a[0] as number); if (!t) return;
    const o = texObj(t, gl);
    if (o.levels.size <= 1 || [...o.levels.keys()].every((k) => k === 0 || k >= 1000)) { o.mip = true; recompute(o); }
  });

  wrap('bindBuffer', (gl, a) => { st(gl).buf.set(a[0] as number, a[1] as WebGLBuffer | null); });
  wrap('deleteBuffer', (_gl, a) => { L.buffers.delete(a[0] as WebGLBuffer); });
  wrap('bufferData', (gl, a) => {
    const b = st(gl).buf.get(a[0] as number); if (!b) return;
    const src = a[1];
    let bytes = typeof src === 'number' ? src : (src as ArrayBufferView | ArrayBuffer | null)?.byteLength ?? 0;
    if (a.length >= 5 && typeof a[4] === 'number' && a[4] > 0) bytes = (a[4] as number) * ((src as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1);
    L.buffers.set(b, { kind: 'buffer', bytes, w: 0, h: 0, d: 1, levels: new Map(), mip: false, fmt: a[0] as number, gl: gl as GpuObj['gl'] });
  });

  wrap('bindRenderbuffer', (gl, a) => { st(gl).rb = a[1] as WebGLRenderbuffer | null; });
  wrap('deleteRenderbuffer', (_gl, a) => { L.renderbuffers.delete(a[0] as WebGLRenderbuffer); });
  wrap('renderbufferStorage', (gl, a) => {
    const rb = st(gl).rb; if (!rb) return;
    const [, internal, w, h] = a as number[];
    L.renderbuffers.set(rb, { kind: 'renderbuffer', bytes: w * h * bppOf(internal), w, h, d: 1, levels: new Map(), mip: false, fmt: internal, gl: gl as GpuObj['gl'] });
  });
  wrap('renderbufferStorageMultisample', (gl, a) => {
    const rb = st(gl).rb; if (!rb) return;
    const [, samples, internal, w, h] = a as number[];
    L.renderbuffers.set(rb, { kind: 'renderbuffer', bytes: w * h * bppOf(internal) * Math.max(1, samples), w, h, d: samples, levels: new Map(), mip: false, fmt: internal, gl: gl as GpuObj['gl'] });
  });
}

if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('mem') === '1' && typeof WebGL2RenderingContext !== 'undefined') installLedger();
