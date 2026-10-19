/**
 * Rodada 10 — primitivas de SÍNTESE (puras, sem WebAudio): todos os sons do jogo são gerados por código a partir de
 * ruído, osciladores, filtros e envelopes (nenhuma gravação, nenhuma amostra externa). Rodam uma vez (num Worker,
 * ou no thread principal em fatias) e viram AudioBuffers reaproveitados.
 */

/** gerador determinístico (mulberry32) — o mesmo som sai igual em todo aparelho */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = ReturnType<typeof rng>;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** filtro biquad (RBJ) processado no lugar */
export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peak';
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private rate: number, private type: BiquadType, f: number, q = 0.707, gainDb = 0) { this.set(f, q, gainDb); }
  set(f: number, q = 0.707, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, this.rate * 0.45)) / this.rate;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (this.type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === 'bandpass') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { const A = Math.pow(10, gainDb / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
  run(buf: Float32Array, from = 0, to = buf.length) { for (let i = from; i < to; i++) buf[i] = this.tick(buf[i]); return buf; }
}

export const lp = (b: Float32Array, rate: number, f: number, q = 0.707) => new Biquad(rate, 'lowpass', f, q).run(b);
export const hp = (b: Float32Array, rate: number, f: number, q = 0.707) => new Biquad(rate, 'highpass', f, q).run(b);
export const bp = (b: Float32Array, rate: number, f: number, q = 1) => new Biquad(rate, 'bandpass', f, q).run(b);

/** ruído rosa (aprox. Paul Kellet) */
export function pinkNoise(n: number, r: Rng): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}
export function whiteNoise(n: number, r: Rng): Float32Array { const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = r() * 2 - 1; return o; }
export function brownNoise(n: number, r: Rng): Float32Array {
  const o = new Float32Array(n); let v = 0;
  for (let i = 0; i < n; i++) { v = (v + (r() * 2 - 1) * 0.02) * 0.998; o[i] = v * 3.5; }
  return o;
}

export type Wave = 'sine' | 'saw' | 'square' | 'tri';
const wave = (w: Wave, ph: number) => {
  const p = ph - Math.floor(ph);
  if (w === 'sine') return Math.sin(2 * Math.PI * p);
  if (w === 'saw') return 2 * p - 1;
  if (w === 'square') return p < 0.5 ? 1 : -1;
  return 1 - 4 * Math.abs(p - 0.5);
};

/**
 * soma em `out` um tom de `start` (s) por `dur` (s), frequência deslizando exponencialmente f0→f1, com ataque
 * linear `att` e decaimento exponencial `tau` (s; Infinity = sem decaimento) — o tijolo de quase todo som
 */
export function tone(out: Float32Array, rate: number, o: { start?: number; dur: number; f0: number; f1?: number; wave?: Wave; gain?: number; att?: number; tau?: number; vib?: [number, number] }) {
  const s0 = Math.floor((o.start ?? 0) * rate), n = Math.floor(o.dur * rate);
  const f1 = o.f1 ?? o.f0, w = o.wave ?? 'sine', g = o.gain ?? 1, att = Math.max(1, (o.att ?? 0.002) * rate), tau = o.tau ?? Infinity;
  let ph = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / rate, k = i / Math.max(1, n);
    let f = o.f0 * Math.pow(f1 / o.f0, k);
    if (o.vib) f += Math.sin(2 * Math.PI * o.vib[0] * t) * o.vib[1];
    ph += f / rate;
    const env = Math.min(1, i / att) * (tau === Infinity ? 1 : Math.exp(-t / tau)) * Math.min(1, (n - i) / (0.004 * rate));
    out[s0 + i] += wave(w, ph) * env * g;
  }
}

/** soma ruído filtrado com envelope (ataque, decaimento) — cliques, estalos, sopros */
export function burst(out: Float32Array, rate: number, r: Rng, o: { start?: number; dur: number; gain?: number; att?: number; tau?: number; lp?: number; hp?: number; bp?: [number, number]; sweep?: [number, number] }) {
  const s0 = Math.floor((o.start ?? 0) * rate), n = Math.floor(o.dur * rate);
  const fl = o.lp ? new Biquad(rate, 'lowpass', o.lp) : null, fh = o.hp ? new Biquad(rate, 'highpass', o.hp) : null;
  const fb = o.bp || o.sweep ? new Biquad(rate, 'bandpass', o.bp?.[0] ?? o.sweep![0], o.bp?.[1] ?? 2.5) : null;
  const g = o.gain ?? 1, att = Math.max(1, (o.att ?? 0.001) * rate), tau = o.tau ?? Infinity;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / rate;
    if (o.sweep && fb && i % 32 === 0) fb.set(o.sweep[0] * Math.pow(o.sweep[1] / o.sweep[0], i / n), 2.2);
    let x = r() * 2 - 1;
    if (fl) x = fl.tick(x);
    if (fh) x = fh.tick(x);
    if (fb) x = fb.tick(x) * 2;
    const env = Math.min(1, i / att) * (tau === Infinity ? 1 : Math.exp(-t / tau)) * Math.min(1, (n - i) / (0.003 * rate));
    out[s0 + i] += x * env * g;
  }
}

/** formantes de vogais genéricas (F1, F2, F3 em Hz) — "fala" sintética ininteligível, sem idioma nem frase */
export const VOWELS: [number, number, number][] = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240], [660, 1720, 2410]];

/**
 * voz sintética (pulso glotal filtrado por 3 formantes) com contorno de altura e "sílabas" de vogais aleatórias —
 * usada em murmúrio de multidão, gritos genéricos e megafone. Nunca forma palavras.
 */
export function voice(out: Float32Array, rate: number, r: Rng, o: { start?: number; dur: number; f0: number; gain?: number; syl?: number; vowel?: number; glide?: number; att?: number; rel?: number; breath?: number }) {
  const s0 = Math.floor((o.start ?? 0) * rate), n = Math.floor(o.dur * rate);
  const F = [new Biquad(rate, 'bandpass', 700, 6), new Biquad(rate, 'bandpass', 1200, 8), new Biquad(rate, 'bandpass', 2500, 10)];
  const sylLen = o.syl ? Math.floor(rate / o.syl) : n + 1;
  let ph = 0, v = o.vowel ?? Math.floor(r() * VOWELS.length), sylEnv = 1;
  const att = Math.max(1, (o.att ?? 0.03) * rate), rel = Math.max(1, (o.rel ?? 0.08) * rate), g = o.gain ?? 1, br = o.breath ?? 0.15;
  const setV = () => { const vv = VOWELS[v]; F[0].set(vv[0], 6); F[1].set(vv[1], 8); F[2].set(vv[2], 10); };
  setV();
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    if (o.syl && i % sylLen === 0 && i > 0) { v = Math.floor(r() * VOWELS.length); setV(); }
    if (o.syl) { const k = (i % sylLen) / sylLen; sylEnv = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6; }
    const t = i / rate;
    const f = o.f0 * (1 + (o.glide ?? 0) * (i / n)) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.2 * t));
    ph += f / rate;
    const p = ph - Math.floor(ph);
    const glott = (p < 0.4 ? Math.sin((Math.PI * p) / 0.4) : 0) - 0.25 + (r() * 2 - 1) * br;
    const y = F[0].tick(glott) * 1.0 + F[1].tick(glott) * 0.6 + F[2].tick(glott) * 0.25;
    const env = Math.min(1, i / att) * Math.min(1, (n - i) / rel) * sylEnv;
    out[s0 + i] += y * env * g;
  }
}

export function softclip(b: Float32Array, drive = 1.5) { const k = Math.tanh(drive); for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / k; return b; }
export function normalize(b: Float32Array, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  if (m > 1e-6) { const k = peak / m; for (let i = 0; i < b.length; i++) b[i] *= k; }
  return b;
}
/** amplitude RMS (QA dos sons gerados) */
export function rms(b: Float32Array) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i] * b[i]; return Math.sqrt(s / Math.max(1, b.length)); }

/**
 * laço sem emenda: renderize `len + xf` amostras; o final é misturado no começo (cross-fade de potência igual) e
 * cortado — a volta do laço não estala
 */
export function seamless(b: Float32Array, xf: number): Float32Array {
  const len = b.length - xf;
  const out = b.slice(0, len);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    out[i] = out[i] * Math.sin((Math.PI / 2) * k) + b[len + i] * Math.cos((Math.PI / 2) * k);
  }
  return out;
}

/** cauda/edges: rampa curta no começo e no fim (one-shots nunca começam/terminam com degrau) */
export function fadeEdges(b: Float32Array, rate: number, inS = 0.002, outS = 0.01) {
  const a = Math.floor(inS * rate), z = Math.floor(outS * rate);
  for (let i = 0; i < a && i < b.length; i++) b[i] *= i / a;
  for (let i = 0; i < z && i < b.length; i++) b[b.length - 1 - i] *= i / z;
  return b;
}
