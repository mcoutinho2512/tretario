/**
 * Grade de densidade da multidão (minimapa): agrega posições (agentes da multidão, multidão distante da rede,
 * concentração) numa grade GROSSA de células — o minimapa desenha manchas de calor, nunca 500 pontinhos.
 * Puro (sem DOM). Reaproveita os buffers entre amostras; amostrar a 1–2 Hz.
 */
export class DensityGrid {
  readonly cols: number;
  readonly rows: number;
  /** contagem por célula (linha-major: idx = row * cols + col) */
  readonly counts: Uint16Array;
  /** total de pontos dentro da grade na última amostra */
  total = 0;
  /** maior contagem de uma célula na última amostra */
  peak = 0;

  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly cell: number) {
    this.cols = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.rows = Math.max(1, Math.ceil((z1 - z0) / cell));
    this.counts = new Uint16Array(this.cols * this.rows);
  }

  clear() { this.counts.fill(0); this.total = 0; this.peak = 0; }

  /** soma um ponto (fora da grade: ignorado) */
  add(x: number, z: number, w = 1) {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((z - this.z0) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const i = r * this.cols + c;
    const v = Math.min(65535, this.counts[i] + w);
    this.counts[i] = v;
    this.total += w;
    if (v > this.peak) this.peak = v;
  }

  /** soma uma lista de agentes {x, z} */
  addAll(list: readonly { x: number; z: number }[]) { for (const a of list) this.add(a.x, a.z); }

  /** contagem da célula que contém (x, z) */
  at(x: number, z: number): number {
    const c = Math.floor((x - this.x0) / this.cell), r = Math.floor((z - this.z0) / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 0;
    return this.counts[r * this.cols + c];
  }

  /** células não vazias: [col, row, contagem] (para desenhar só o que existe) */
  cells(out: [number, number, number][] = []): [number, number, number][] {
    out.length = 0;
    for (let i = 0; i < this.counts.length; i++) {
      const v = this.counts[i];
      if (v) out.push([i % this.cols, (i / this.cols) | 0, v]);
    }
    return out;
  }
}

/** intensidade 0..1 de uma célula: escala raiz (poucas pessoas já aparecem; a concentração satura em `full`) */
export function heatLevel(count: number, full = 40): number {
  if (count <= 0) return 0;
  return Math.min(1, Math.sqrt(count / full));
}
