/**
 * Esconde a pele que fica INTEIRAMENTE coberta pela roupa (como o "delete vertices" do MakeHuman).
 * O corpo mais musculoso atravessava a camiseta nos ombros/costas ("roupa rasgada"); empurrar a roupa resolvia só
 * com ~15 mm (camiseta grossa). Aqui, uma vez por geometria, removemos os triângulos do corpo cujos 3 vértices
 * estão sob a roupa: um raio pela normal da pele (de um pouco por dentro até um pouco por fora) cruza um triângulo
 * da roupa que não está perto das bordas dela (gola, mangas, barra, decote) — perto delas a pele fica, sem buraco.
 * Puro (sem three.js): recebe posições/normais já no mesmo espaço (m), na pose de repouso.
 */
export interface ClothInput { pos: ArrayLike<number>; normal: ArrayLike<number>; index: ArrayLike<number> | null }
export interface HideOptions {
  /** quanto a roupa pode estar POR DENTRO da pele (pele atravessando o tecido) (m) */
  inside?: number;
  /** quanto a roupa pode estar por fora da pele (folga do tecido) (m) */
  outside?: number;
  /** margem das bordas da roupa onde a pele nunca é escondida (m) */
  edgeMargin?: number;
  /** testa também a direção RADIAL (horizontal, para fora do eixo vertical da roupa): pega bordas finas cuja normal
   * aponta para cima/baixo (topo do cós/cinto), que o raio pela normal nunca cruza */
  radial?: boolean;
  /** vértices do corpo escondidos de qualquer forma (1 = coberto), p.ex. o braço dentro da manga (sleeveCovered) */
  force?: ArrayLike<number>;
}

/**
 * Braço DENTRO da manga curta: com o braço erguido (aceno, bandeira, dança) a manga e o braço se deformam por
 * ossos diferentes e a pele do braço atravessava o tecido em frestas — pele que, em repouso, nem sempre está a
 * poucos cm da manga (o raio pela normal não a pega). Aqui o critério é geométrico, ao longo do eixo do braço:
 * pele do braço (peso no úmero ≥ 0,5) entre o ombro e `margin` antes do punho da manga é coberta.
 * `armOf`: 1 = braço do 1º eixo, 2 = do 2º, 0 = outro; `arms`: ombro e cotovelo de cada braço (mesmo espaço).
 */
export function sleeveCovered(
  bodyPos: ArrayLike<number>, armOf: ArrayLike<number>, arms: { shoulder: number[]; elbow: number[] }[],
  cloth: ClothInput, margin = 0.035,
): Uint8Array {
  const nb = bodyPos.length / 3;
  const out = new Uint8Array(nb);
  const idx = cloth.index ?? Array.from({ length: cloth.pos.length / 3 }, (_, i) => i);
  const bnd = boundaryVerts(cloth.pos, idx);
  arms.forEach((arm, k) => {
    const [sx, sy, sz] = arm.shoulder;
    let dx = arm.elbow[0] - sx, dy = arm.elbow[1] - sy, dz = arm.elbow[2] - sz;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.05) return;
    dx /= L; dy /= L; dz /= L;
    const axial = (p: ArrayLike<number>, i: number) => (p[i * 3] - sx) * dx + (p[i * 3 + 1] - sy) * dy + (p[i * 3 + 2] - sz) * dz;
    const radial = (p: ArrayLike<number>, i: number, t: number) =>
      Math.hypot(p[i * 3] - sx - dx * t, p[i * 3 + 1] - sy - dy * t, p[i * 3 + 2] - sz - dz * t);
    // punho da manga: borda da roupa em volta do eixo, além do ombro (a gola e a barra ficam de fora)
    const cuff: number[] = [];
    for (const i of bnd) {
      const t = axial(cloth.pos, i);
      if (t > 0.15 * L && t < 1.2 * L && radial(cloth.pos, i, t) < 0.12) cuff.push(t);
    }
    if (cuff.length < 4) return;
    cuff.sort((a, b) => a - b);
    const tc = cuff[Math.floor(cuff.length * 0.25)] - margin; // lado mais curto do punho, com folga
    for (let v = 0; v < nb; v++) {
      if (armOf[v] !== k + 1) continue;
      const t = axial(bodyPos, v);
      if (t > 0.02 && t < tc && radial(bodyPos, v, t) < 0.1) out[v] = 1;
    }
  });
  return out;
}

const CELL = 0.03;
const ck = (x: number, y: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;

/** vértices de borda da roupa (arestas usadas por um só triângulo), soldando duplicatas de costura de UV (2 mm: a quantização do meshopt as separa) */
function boundaryVerts(pos: ArrayLike<number>, idx: ArrayLike<number>): number[] {
  const n = pos.length / 3;
  const weld = new Int32Array(n);
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
    const w = seen.get(k);
    if (w === undefined) { seen.set(k, i); weld[i] = i; } else weld[i] = w;
  }
  const edges = new Map<number, number>();
  const add = (a: number, b: number) => { if (a === b) return; const k = Math.min(a, b) * n + Math.max(a, b); edges.set(k, (edges.get(k) ?? 0) + 1); };
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], d = weld[idx[t + 2]];
    add(a, b); add(b, d); add(d, a);
  }
  const out = new Set<number>();
  for (const [k, cnt] of edges) if (cnt === 1) { out.add(Math.floor(k / n)); out.add(k % n); }
  // todas as cópias soldadas de um vértice de borda também são borda
  for (let i = 0; i < n; i++) if (out.has(weld[i])) out.add(i);
  return [...out];
}

/** raio × triângulo (Möller–Trumbore): t ao longo de d, ou -1 */
function rayTri(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
  const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
  const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-12) return -1;
  const f = 1 / det;
  const sx = ox - ax, sy = oy - ay, sz = oz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return -1;
  return f * (e2x * qx + e2y * qy + e2z * qz);
}

/** índice novo do corpo sem os triângulos cobertos; `hidden` = quantos triângulos saíram */
export function hideCoveredSkin(
  bodyPos: ArrayLike<number>, bodyNormal: ArrayLike<number>, bodyIndex: ArrayLike<number> | null, cloths: ClothInput[], o: HideOptions = {},
): { index: number[]; hidden: number; stats: Record<string, number>[]; covered: Uint8Array } {
  const inside = o.inside ?? 0.035, outside = o.outside ?? 0.03, edge = o.edgeMargin ?? 0.02;
  const nb = bodyPos.length / 3;
  const covered = new Uint8Array(nb);
  if (o.force) for (let v = 0; v < nb; v++) if (o.force[v]) covered[v] = 1;
  const stats: Record<string, number>[] = [];
  for (const c of cloths) {
    const nc = c.pos.length / 3;
    const idx = c.index ?? Array.from({ length: nc }, (_, i) => i);
    // vértices da roupa perto de uma borda
    const bnd = boundaryVerts(c.pos, idx);
    const bgrid = new Map<string, number[]>();
    for (const i of bnd) { const k = ck(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2]); (bgrid.get(k) ?? bgrid.set(k, []).get(k)!).push(i); }
    const nearEdge = new Uint8Array(nc);
    for (let i = 0; i < nc; i++) {
      const x = c.pos[i * 3], y = c.pos[i * 3 + 1], z = c.pos[i * 3 + 2];
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
      outer: for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
        for (const j of bgrid.get(`${cx + a},${cy + b},${cz + d}`) ?? []) {
          if (edge > 0 && Math.hypot(c.pos[j * 3] - x, c.pos[j * 3 + 1] - y, c.pos[j * 3 + 2] - z) < edge) { nearEdge[i] = 1; break outer; }
        }
      }
    }
    // triângulos "internos" da roupa numa grade (pelas células da caixa de cada um)
    const tgrid = new Map<string, number[]>();
    let usable = 0;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], d = idx[t + 2];
      if (!(nearEdge[a] || nearEdge[b] || nearEdge[d])) usable++;
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(c.pos[a * 3 + k], c.pos[b * 3 + k], c.pos[d * 3 + k]) / CELL));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(c.pos[a * 3 + k], c.pos[b * 3 + k], c.pos[d * 3 + k]) / CELL));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const k = `${x},${y},${z}`;
        (tgrid.get(k) ?? tgrid.set(k, []).get(k)!).push(t);
      }
    }
    const st = { verts: nc, boundary: bnd.length, usableTris: usable, covered: 0 };
    stats.push(st);
    // eixo vertical da roupa (centro da caixa em x/z), para a direção radial
    let cx0 = 0, cz0 = 0;
    if (o.radial) {
      let lx = Infinity, hx = -Infinity, lz = Infinity, hz = -Infinity;
      for (let i = 0; i < nc; i++) { lx = Math.min(lx, c.pos[i * 3]); hx = Math.max(hx, c.pos[i * 3]); lz = Math.min(lz, c.pos[i * 3 + 2]); hz = Math.max(hz, c.pos[i * 3 + 2]); }
      cx0 = (lx + hx) / 2; cz0 = (lz + hz) / 2;
    }
    // raio pela normal da pele (e, se pedido, radial), de `inside` por dentro até `outside` por fora
    const len = inside + outside;
    const castFrom = (v: number, nx: number, ny: number, nz: number): boolean => {
      const ox = bodyPos[v * 3] - nx * inside, oy = bodyPos[v * 3 + 1] - ny * inside, oz = bodyPos[v * 3 + 2] - nz * inside;
      const tried = new Set<number>();
      // células ao longo do raio E vizinhas (o triângulo atingido pode estar registrado só na célula ao lado)
      const cells = new Set<string>();
      for (let s = 0; s <= len + CELL; s += CELL) {
        const qx = Math.floor((ox + nx * s) / CELL), qy = Math.floor((oy + ny * s) / CELL), qz = Math.floor((oz + nz * s) / CELL);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) cells.add(`${qx + a},${qy + b},${qz + d}`);
      }
      for (const cell of cells) {
        for (const t of tgrid.get(cell) ?? []) {
          if (tried.has(t)) continue;
          tried.add(t);
          const h = rayTri(ox, oy, oz, nx, ny, nz, c.pos, idx[t], idx[t + 1], idx[t + 2]);
          if (h < 0 || h > len) continue;
          // perto da borda da roupa só esconde pele que ATRAVESSA o tecido (roupa ≥ 2 mm atrás da pele): ali esconder
          // revela a roupa; pele por baixo do tecido junto à gola/manga fica (senão abre buraco)
          const edgeTri = nearEdge[idx[t]] || nearEdge[idx[t + 1]] || nearEdge[idx[t + 2]];
          if (edge > 0 && edgeTri && h > inside - 0.002) continue;
          return true;
        }
      }
      return false;
    };
    for (let v = 0; v < nb; v++) {
      if (covered[v]) continue;
      let hit = castFrom(v, bodyNormal[v * 3], bodyNormal[v * 3 + 1], bodyNormal[v * 3 + 2]);
      if (!hit && o.radial) {
        const rx = bodyPos[v * 3] - cx0, rz = bodyPos[v * 3 + 2] - cz0, rl = Math.hypot(rx, rz);
        if (rl > 1e-4) hit = castFrom(v, rx / rl, 0, rz / rl);
      }
      if (hit) { covered[v] = 1; st.covered++; }
    }
  }
  const idx = bodyIndex ?? Array.from({ length: nb }, (_, i) => i);
  const index: number[] = [];
  let hidden = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    if (covered[idx[t]] && covered[idx[t + 1]] && covered[idx[t + 2]]) { hidden++; continue; }
    index.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return { index, hidden, stats, covered };
}
