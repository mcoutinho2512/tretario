/** Rodada 12 — gerador pseudoaleatório pequeno e determinístico (testes reproduzíveis; nada de Math.random no cérebro). */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  /** [0, 1) */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.next(); }
  int(a: number, b: number) { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number) { return this.next() < p; }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]; }
  /** ~normal (soma de 3 uniformes), média 0, desvio ~1 */
  gauss() { return (this.next() + this.next() + this.next() - 1.5) * 2; }
  weighted<K extends string>(w: Record<K, number>): K {
    const keys = Object.keys(w) as K[];
    let tot = 0;
    for (const k of keys) tot += Math.max(0, w[k]);
    let r = this.next() * tot;
    for (const k of keys) { r -= Math.max(0, w[k]); if (r < 0) return k; }
    return keys[keys.length - 1];
  }
}
