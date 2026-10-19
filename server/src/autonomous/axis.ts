/** Rodada 12 — eixo da avenida (polilinha do manifesto) parametrizado por comprimento: destinos "ao longo" da Vargas. */
export class Axis {
  readonly len: number;
  private cum: number[] = [0];
  constructor(readonly pts: readonly (readonly [number, number])[]) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) { s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); this.cum.push(s); }
    this.len = s;
  }
  get ok() { return this.pts.length >= 2 && this.len > 1; }

  /** ponto a `s` m do início, deslocado `lat` m para a esquerda do sentido do eixo */
  at(s: number, lat = 0): { x: number; z: number; tx: number; tz: number } {
    const p = this.pts;
    if (!this.ok) return { x: p[0]?.[0] ?? 0, z: p[0]?.[1] ?? 0, tx: 1, tz: 0 };
    const t = Math.max(0, Math.min(this.len, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < t) i++;
    const a = p[i - 1], b = p[i], seg = this.cum[i] - this.cum[i - 1] || 1, f = (t - this.cum[i - 1]) / seg;
    const tx = (b[0] - a[0]) / seg, tz = (b[1] - a[1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * f - tz * lat, z: a[1] + (b[1] - a[1]) * f + tx * lat, tx, tz };
  }

  /** projeção: comprimento ao longo do eixo e afastamento lateral (m; + = esquerda) */
  project(x: number, z: number): { s: number; lat: number; d: number } {
    const p = this.pts;
    let best = { s: 0, lat: 0, d: Infinity };
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0], az = p[i - 1][1], bx = p[i][0], bz = p[i][1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const f = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const qx = ax + vx * f, qz = az + vz * f, d = Math.hypot(x - qx, z - qz);
      if (d < best.d) {
        const l = Math.sqrt(l2), lat = (-(vz / l) * (x - qx) + (vx / l) * (z - qz));
        best = { s: this.cum[i - 1] + f * l, lat: -lat, d };
      }
    }
    // sinal coerente com `at`: lat > 0 = esquerda (−tz, +tx)
    const q = this.at(best.s, 0), lx = -q.tz, lz = q.tx;
    best.lat = (x - q.x) * lx + (z - q.z) * lz;
    return best;
  }
}
