/**
 * Hash espacial 2D (x, z) puro e sem dependências — usado pelo SERVIDOR para área de interesse (AOI),
 * candidatos de empurrão/impacto e qualquer outra consulta "quem está perto de mim", em vez de varrer N×N.
 *
 * - Itens são inteiros ≥ 0 ("slots": o servidor dá um slot por jogador e o reaproveita quando ele sai);
 *   posições em arrays tipados, células num Map com chave numérica (sem strings, sem objetos por item).
 * - Células quadradas de `cell` metros (AOI/2 é um bom valor: um raio de AOI cobre ~5×5 células).
 * - Reconstruído a cada tick (N inserções, O(N)); `move` existe para quem prefere atualizar no lugar.
 */

const OFF = 32768;
const key = (ix: number, iz: number) => ((ix + OFF) & 0xffff) * 65536 + ((iz + OFF) & 0xffff);

export class SpatialGrid {
  private cells = new Map<number, number[]>();
  private xs = new Float64Array(256);
  private zs = new Float64Array(256);
  private ks = new Float64Array(256);
  private present = new Uint8Array(256);
  private n = 0;

  constructor(readonly cell: number) {
    if (!(cell > 0)) throw new Error('SpatialGrid: célula precisa ser > 0');
  }

  get size() { return this.n; }

  private grow(id: number) {
    if (id < this.present.length) return;
    let len = this.present.length;
    while (len <= id) len *= 2;
    const g = <A extends Float64Array | Uint8Array>(a: A): A => { const b = new (a.constructor as new (n: number) => A)(len); b.set(a); return b; };
    this.xs = g(this.xs); this.zs = g(this.zs); this.ks = g(this.ks); this.present = g(this.present);
  }

  clear() {
    for (const arr of this.cells.values()) for (const id of arr) this.present[id] = 0;
    this.cells.clear();
    this.n = 0;
  }

  insert(id: number, x: number, z: number) {
    if (!(id >= 0) || !Number.isInteger(id)) throw new Error('SpatialGrid: id precisa ser inteiro ≥ 0');
    this.grow(id);
    if (this.present[id]) { this.move(id, x, z); return; }
    const k = key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(id);
    this.xs[id] = x; this.zs[id] = z; this.ks[id] = k; this.present[id] = 1;
    this.n++;
  }

  remove(id: number) {
    if (!this.present[id]) return;
    const arr = this.cells.get(this.ks[id])!;
    const i = arr.indexOf(id);
    if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
    if (!arr.length) this.cells.delete(this.ks[id]);
    this.present[id] = 0;
    this.n--;
  }

  move(id: number, x: number, z: number) {
    if (!this.present[id]) { this.insert(id, x, z); return; }
    const k = key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (k !== this.ks[id]) { this.remove(id); this.insert(id, x, z); return; }
    this.xs[id] = x; this.zs[id] = z;
  }

  has(id: number) { return !!this.present[id]; }
  x(id: number) { return this.xs[id]; }
  z(id: number) { return this.zs[id]; }

  /**
   * Chama `fn(id, distância)` para cada item a ≤ r de (x, z). Ordem não definida.
   * Só visita as células que tocam o quadrado envolvente do círculo.
   */
  forEachInRadius(x: number, z: number, r: number, fn: (id: number, d: number) => void) {
    const c = this.cell, xs = this.xs, zs = this.zs;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    const r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.cells.get(key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const id = arr[i];
          const dx = xs[id] - x, dz = zs[id] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(id, Math.sqrt(d2));
        }
      }
    }
  }

  /** itens a ≤ r, com distância (array novo — conveniência; o caminho quente usa forEachInRadius) */
  queryRadius(x: number, z: number, r: number): { item: number; d: number }[] {
    const out: { item: number; d: number }[] = [];
    this.forEachInRadius(x, z, r, (item, d) => out.push({ item, d }));
    return out;
  }
}

/**
 * Regra da área de interesse de UM cliente — versão de REFERÊNCIA (objetos, fácil de ler e testar).
 *
 *  - entra quem está a ≤ `radius`; quem já está na vista só sai além de `radius × hysteresis` (sem "pisca-pisca")
 *  - `cap` (opcional): no máximo `cap` itens na vista, os MAIS PRÓXIMOS primeiro. Quem já está na vista tem
 *    vantagem de `rankBonus` (a distância conta × rankBonus) para não trocar de lugar a cada passo na borda do limite.
 *  - `always`: itens que ficam sempre (o próprio jogador, o veículo em que está), fora do limite.
 *
 * Retorna também a lista "overflow" (elegíveis por distância mas cortados pelo limite) — o servidor a usa
 * para a multidão distante (posições compactas em baixa frequência).
 * O servidor usa `selectInterestSlots` (mesma regra, sem alocação); os testes provam que as duas concordam.
 */
export interface InterestInput<T> {
  /** candidatos a ≤ radius × hysteresis (com distância) */
  candidates: { item: T; d: number }[];
  inView: ReadonlySet<T>;
  radius: number;
  hysteresis?: number;
  cap?: number;
  rankBonus?: number;
  always?: ReadonlySet<T>;
}
export interface InterestResult<T> { add: T[]; remove: T[]; overflow: { item: T; d: number }[] }

export function selectInterest<T>(inp: InterestInput<T>): InterestResult<T> {
  const hyst = inp.hysteresis ?? 1.15;
  const cap = inp.cap ?? Infinity;
  const bonus = inp.rankBonus ?? 0.85;
  const always = inp.always;
  const out = Math.max(inp.radius, inp.radius * hyst);
  const elig: { item: T; d: number; rank: number }[] = [];
  const keep = new Set<T>();
  for (const c of inp.candidates) {
    if (always?.has(c.item)) { keep.add(c.item); continue; }
    const has = inp.inView.has(c.item);
    if (c.d <= inp.radius || (has && c.d <= out)) elig.push({ item: c.item, d: c.d, rank: has ? c.d * bonus : c.d });
  }
  let overflow: { item: T; d: number }[] = [];
  if (elig.length > cap) {
    elig.sort((a, b) => a.rank - b.rank);
    overflow = elig.slice(cap).map((e) => ({ item: e.item, d: e.d }));
    elig.length = cap;
  }
  for (const e of elig) keep.add(e.item);
  if (always) for (const a of always) keep.add(a);
  const add: T[] = [], remove: T[] = [];
  for (const k of keep) if (!inp.inView.has(k)) add.push(k);
  for (const v of inp.inView) if (!keep.has(v)) remove.push(v);
  return { add, remove, overflow };
}

/** memória de trabalho reaproveitada entre chamadas de `selectInterestSlots` */
export class InterestScratch {
  slot = new Int32Array(1024);
  d = new Float64Array(1024);
  rank = new Float64Array(1024);
  stamp = new Uint32Array(1024);
  pass = 0;
  ensure(n: number, maxSlot: number) {
    if (n > this.slot.length) {
      let len = this.slot.length; while (len < n) len *= 2;
      const sl = new Int32Array(len), d = new Float64Array(len), r = new Float64Array(len);
      sl.set(this.slot); d.set(this.d); r.set(this.rank);
      this.slot = sl; this.d = d; this.rank = r;
    }
    if (maxSlot >= this.stamp.length) {
      let len = this.stamp.length; while (len <= maxSlot) len *= 2;
      const s = new Uint32Array(len); s.set(this.stamp); this.stamp = s;
    }
  }
}

/** vista de um cliente: marcação por slot + lista dos slots na vista */
export interface SlotView { has: Uint8Array; list: number[] }

export function makeSlotView(n = 256): SlotView { return { has: new Uint8Array(n), list: [] }; }

/**
 * Mesma regra de `selectInterest`, sobre slots inteiros e sem alocação no caminho quente:
 * busca na grade, seleção parcial (quickselect, O(n)) dos `cap` de menor "rank", diferença com a vista atual.
 * Atualiza `view` e escreve em `add`/`remove`/`overflow` (zerados aqui). `me` fica sempre (sem contar no limite).
 * `overflow` não sai ordenado por distância.
 */
export function selectInterestSlots(
  grid: SpatialGrid, me: number, x: number, z: number, view: SlotView,
  o: { radius: number; hysteresis?: number; cap?: number; rankBonus?: number },
  s: InterestScratch, add: number[], remove: number[], overflow: number[],
) {
  const hyst = o.hysteresis ?? 1.15, bonus = o.rankBonus ?? 0.85;
  const cap = o.cap && o.cap > 0 ? o.cap : Infinity;
  const R = o.radius, out = Math.max(R, R * hyst);
  add.length = 0; remove.length = 0; overflow.length = 0;
  s.ensure(grid.size + 1, Math.max(me, 0) + 1);
  if (view.has.length <= me) grow(view, me);
  let n = 0;
  const has = view.has;
  grid.forEachInRadius(x, z, out, (id, d) => {
    if (id === me) return;
    const inV = id < has.length && has[id] === 1;
    if (d <= R || (inV && d <= out)) {
      if (n >= s.slot.length) s.ensure(n * 2, 0);
      s.slot[n] = id; s.d[n] = d; s.rank[n] = inV ? d * bonus : d; n++;
    }
  });
  let keepN = n;
  if (n > cap) {
    quickselect(s, 0, n - 1, cap - 1);
    keepN = cap;
    for (let i = cap; i < n; i++) overflow.push(s.slot[i]);
  }
  const pass = ++s.pass === 0xffffffff ? (s.stamp.fill(0), (s.pass = 1)) : s.pass;
  let maxSlot = me;
  for (let i = 0; i < keepN; i++) if (s.slot[i] > maxSlot) maxSlot = s.slot[i];
  s.ensure(0, maxSlot);
  if (view.has.length <= maxSlot) grow(view, maxSlot);
  const stamp = s.stamp;
  stamp[me] = pass;
  for (let i = 0; i < keepN; i++) stamp[s.slot[i]] = pass;
  // saem: estavam na vista e não ficaram
  const next: number[] = [];
  for (const id of view.list) {
    if (id < stamp.length && stamp[id] === pass) next.push(id);
    else { remove.push(id); view.has[id] = 0; }
  }
  // entram
  if (!view.has[me]) { view.has[me] = 1; next.push(me); add.push(me); }
  for (let i = 0; i < keepN; i++) {
    const id = s.slot[i];
    if (!view.has[id]) { view.has[id] = 1; next.push(id); add.push(id); }
  }
  view.list = next;
}

function grow(v: SlotView, id: number) {
  let len = Math.max(1, v.has.length);
  while (len <= id) len *= 2;
  const h = new Uint8Array(len); h.set(v.has); v.has = h;
}

/** quickselect (Hoare) sobre os arrays paralelos de `s`, por rank: deixa os k+1 menores em [lo..k] */
function quickselect(s: InterestScratch, lo: number, hi: number, k: number) {
  const r = s.rank, sl = s.slot, d = s.d;
  const swap = (i: number, j: number) => {
    const t = r[i]; r[i] = r[j]; r[j] = t;
    const u = sl[i]; sl[i] = sl[j]; sl[j] = u;
    const w = d[i]; d[i] = d[j]; d[j] = w;
  };
  while (hi > lo) {
    const pivot = r[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (r[i] < pivot) i++;
      while (r[j] > pivot) j--;
      if (i <= j) { swap(i, j); i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}
