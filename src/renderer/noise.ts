/** Ruído determinístico (value noise + fBm) para texturas e variações procedurais. */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** value noise periódico (tileável) com período `period` células */
export function tileNoise(x: number, y: number, period: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const p = (n: number) => ((n % period) + period) % period;
  const a = hash2(p(xi), p(yi), seed), b = hash2(p(xi + 1), p(yi), seed);
  const c = hash2(p(xi), p(yi + 1), seed), d = hash2(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** fBm tileável: (x,y) em [0,1) da textura */
export function tileFbm(x: number, y: number, baseFreq: number, octaves: number, seed = 0, gain = 0.5): number {
  let amp = 1, freq = baseFreq, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(x * freq, y * freq, freq, seed + i * 17);
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}
