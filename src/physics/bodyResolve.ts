/**
 * Rodada 12 — COLISÃO ENTRE CORPOS (docs/CROWD_COLLISION.md). PURO (sem Three, sem Colyseus): o MESMO código roda no
 * cliente (predição do jogador local) e no servidor (validação do humano, resolução dos autônomos).
 *
 *   SpatialBodyGrid      grade espacial de BodyRef (implementa BodyIndex): células de BODY.queryRadius, chave numérica
 *   constrainMove        UM corpo que se move (jogador local, humano no servidor, autônomo): não entra em ninguém;
 *                        tira só a componente NORMAL do passo (desliza pela tangente); sobreposição antiga sai devagar
 *   resolveBodies        MUITOS corpos móveis (autônomos entre si e contra humanos `fixed`): penetração progressiva,
 *                        no máximo BODY.maxPushPerStep por passo, repartida pela massa — nada de explosão em multidão
 *   steerAround          desvio local suavizado (espaço pessoal) para quem anda sozinho (autônomos, bots de QA)
 *   penetrationOf        maior penetração de um ponto nos vizinhos (validação do servidor com BODY.serverTolerance)
 *   findFreeSpot         ponto livre próximo (spawn, reconexão, levantar, "unstuck"): anéis em volta, sem parede
 *   StuckDetector        preso de verdade (quer andar, não anda, encostado em ≥ 2 corpos ou corpo + parede) por X s
 *
 * Nada aqui aloca por chamada em regime (arrays de saída são do chamador ou reaproveitados).
 */
import { BODY, type BodyIndex, type BodyRef } from './bodies';

const OFF = 32768;
const cellKey = (ix: number, iz: number) => ((ix + OFF) & 0xffff) * 65536 + ((iz + OFF) & 0xffff);

/** velocidade com que uma sobreposição já existente se desfaz quando ninguém empurra (m/s) */
export const DEPENETRATE_MPS = 0.6;
/** maior raio de corpo previsto (m) — folga da consulta de vizinhos */
const MAX_R = 0.5;

/** grade espacial de corpos (implementa BodyIndex). `queries` conta as consultas (métrica neighborQueries) */
export class SpatialBodyGrid implements BodyIndex {
  private cells = new Map<number, BodyRef[]>();
  private keyOf = new Map<string, number>();
  private byId = new Map<string, BodyRef>();
  /** consultas `near` desde o último `resetStats` */
  queries = 0;

  constructor(readonly cell: number = BODY.queryRadius) {
    if (!(cell > 0)) throw new Error('SpatialBodyGrid: célula precisa ser > 0');
  }

  get size() { return this.byId.size; }
  get(id: string) { return this.byId.get(id); }
  values() { return this.byId.values(); }
  resetStats() { this.queries = 0; }

  clear() { this.cells.clear(); this.keyOf.clear(); this.byId.clear(); }

  private keyAt(x: number, z: number) { return cellKey(Math.floor(x / this.cell), Math.floor(z / this.cell)); }

  /** insere ou atualiza (o objeto passado passa a ser o guardado) */
  upsert(b: BodyRef): BodyRef {
    const old = this.byId.get(b.id);
    if (old && old !== b) this.remove(b.id);
    if (!this.byId.has(b.id)) {
      this.byId.set(b.id, b);
      const k = this.keyAt(b.x, b.z);
      this.keyOf.set(b.id, k);
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(b);
      return b;
    }
    this.move(b.id, b.x, b.z);
    return b;
  }

  /** move um corpo já inserido (troca de célula se precisar) */
  move(id: string, x: number, z: number) {
    const b = this.byId.get(id);
    if (!b) return;
    b.x = x; b.z = z;
    const k = this.keyAt(x, z), k0 = this.keyOf.get(id)!;
    if (k === k0) return;
    const arr = this.cells.get(k0);
    if (arr) { const i = arr.indexOf(b); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } if (!arr.length) this.cells.delete(k0); }
    let to = this.cells.get(k);
    if (!to) this.cells.set(k, (to = []));
    to.push(b);
    this.keyOf.set(id, k);
  }

  remove(id: string) {
    const b = this.byId.get(id);
    if (!b) return;
    const k = this.keyOf.get(id)!;
    const arr = this.cells.get(k);
    if (arr) { const i = arr.indexOf(b); if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); } if (!arr.length) this.cells.delete(k); }
    this.byId.delete(id); this.keyOf.delete(id);
  }

  /** corpos com CENTRO a ≤ r de (x, z) — `out` é limpo e devolvido */
  near(x: number, z: number, r: number, out: BodyRef[]): BodyRef[] {
    this.queries++;
    out.length = 0;
    const c = this.cell, r2 = r * r;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = this.cells.get(cellKey(ix, iz));
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) { const b = arr[i]; const dx = b.x - x, dz = b.z - z; if (dx * dx + dz * dz <= r2) out.push(b); }
    }
    return out;
  }
}

/** direção determinística para dois centros coincidentes (não depende de Math.random: cliente e servidor iguais) */
function tieDir(seed: string, salt: number): [number, number] {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const a = ((h >>> 0) / 4294967296) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

export interface MoveResult {
  x: number; z: number;
  /** corpos encostados no fim do passo */
  contacts: number;
  /** andou menos de 30 % do pedido (só quando pediu para andar) */
  blocked: boolean;
  /** maior penetração restante (m) */
  maxPen: number;
}

/**
 * Passo de UM corpo que se move de (fromX, fromZ) para (toX, toZ) entre `neighbors` (vizinhos já consultados; o
 * próprio é ignorado pelo id). Regra: ninguém termina mais perto de um vizinho do que min(contato, distância de
 * antes) — só a componente normal do passo some, a tangencial fica (desliza em volta). Sobreposição antiga (spawn,
 * latência) sai a DEPENETRATE_MPS. `soft` do vizinho: penetração permitida (NPC/autônomo cedem; humano é duro).
 * 3 passadas: dois contatos ao mesmo tempo (fresta entre duas pessoas) também seguram.
 */
export function constrainMove(id: string, r: number, fromX: number, fromZ: number, toX: number, toZ: number, neighbors: readonly BodyRef[], dt: number, out?: MoveResult): MoveResult {
  const res = out ?? { x: 0, z: 0, contacts: 0, blocked: false, maxPen: 0 };
  let x = toX, z = toZ;
  const depen = DEPENETRATE_MPS * Math.max(0, dt);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i];
      if (n.id === id) continue;
      const R = r + n.r - (n.soft ?? 0);
      if (R <= 0) continue;
      let dx = x - n.x, dz = z - n.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d0 = Math.hypot(fromX - n.x, fromZ - n.z);
      const allowed = d0 >= R ? R : Math.min(R, d0 + depen);
      const d = Math.sqrt(d2);
      if (d >= allowed) continue;
      if (d < 1e-6) {
        // em cima do outro: sai para o lado de onde veio (ou uma direção fixa pelo par)
        const fx = fromX - n.x, fz = fromZ - n.z, fl = Math.hypot(fx, fz);
        if (fl > 1e-6) { dx = fx / fl; dz = fz / fl; } else [dx, dz] = tieDir(id < n.id ? id + n.id : n.id + id, id < n.id ? 0 : 1);
      } else { dx /= d; dz /= d; }
      x = n.x + dx * allowed; z = n.z + dz * allowed;
      changed = true;
    }
    if (!changed) break;
  }
  let contacts = 0, maxPen = 0;
  for (let i = 0; i < neighbors.length; i++) {
    const n = neighbors[i];
    if (n.id === id) continue;
    const dd = Math.hypot(x - n.x, z - n.z), R = r + n.r;
    if (dd < R - (n.soft ?? 0) + 0.03) contacts++;
    if (R - dd > maxPen) maxPen = R - dd;
  }
  const want = Math.hypot(toX - fromX, toZ - fromZ);
  res.x = x; res.z = z; res.contacts = contacts; res.maxPen = maxPen;
  res.blocked = want > 1e-4 && Math.hypot(x - fromX, z - fromZ) < want * 0.3;
  return res;
}

/** maior penetração de (x, z, r) nos vizinhos (ignora `selfId`) — 0 = livre */
export function penetrationOf(selfId: string, x: number, z: number, r: number, neighbors: readonly BodyRef[]): { pen: number; other: BodyRef | null } {
  let pen = 0, other: BodyRef | null = null;
  for (const n of neighbors) {
    if (n.id === selfId) continue;
    const p = r + n.r - Math.hypot(x - n.x, z - n.z);
    if (p > pen) { pen = p; other = n; }
  }
  return { pen, other };
}

export interface ResolveStats { bodies: number; queries: number; pairs: number; moved: number; maxPen: number; ms: number }
export interface ResolveOptions {
  /** passadas por chamada (padrão 2) */
  iterations?: number;
  /** empurrão máximo por corpo por passada (padrão BODY.maxPushPerStep) */
  maxPush?: number;
  /** depois de mover um corpo, confere parede (devolve a posição válida) — opcional */
  clamp?: (b: BodyRef, x: number, z: number) => { x: number; z: number };
}

const scratch: BodyRef[] = [];

/**
 * Resolução PROGRESSIVA de penetração para `bodies` (os que podem ser empurrados; `fixed` nunca se move) consultando
 * `index` (que deve conter também os fixos: humanos, por exemplo). Cada par sobreposto se afasta pela normal, a
 * parte de cada um pela massa inversa (fixo: o outro leva tudo), limitada a `maxPush` — em multidão densa a
 * separação acontece em alguns passos, sem "explosão". Gauss-Seidel no lugar; se `index` for SpatialBodyGrid, os
 * corpos que andaram trocam de célula no fim.
 */
export function resolveBodies(bodies: readonly BodyRef[], index: BodyIndex, opts: ResolveOptions = {}): ResolveStats {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const iters = opts.iterations ?? 2, maxPush = opts.maxPush ?? BODY.maxPushPerStep;
  let queries = 0, pairs = 0, maxPen = 0;
  const moved = new Set<BodyRef>();
  for (let it = 0; it < iters; it++) {
    let any = false;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (a.fixed) continue;
      index.near(a.x, a.z, a.r + MAX_R + maxPush * 2, scratch);
      queries++;
      const wa = 1 / Math.max(1e-3, a.mass ?? 1);
      let px = 0, pz = 0;
      for (let j = 0; j < scratch.length; j++) {
        const b = scratch[j];
        if (b === a || b.id === a.id) continue;
        const R = a.r + b.r;
        let dx = a.x - b.x, dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        pairs++;
        const d = Math.sqrt(d2);
        if (d < 1e-6) { [dx, dz] = tieDir(a.id < b.id ? a.id + b.id : b.id + a.id, 0); if (a.id > b.id) { dx = -dx; dz = -dz; } } else { dx /= d; dz /= d; }
        const pen = R - d;
        if (pen > maxPen) maxPen = pen;
        const share = b.fixed ? 1 : wa / (wa + 1 / Math.max(1e-3, b.mass ?? 1));
        px += dx * pen * share; pz += dz * pen * share;
      }
      const l = Math.hypot(px, pz);
      if (l < 1e-5) continue;
      const k = l > maxPush ? maxPush / l : 1;
      let nx = a.x + px * k, nz = a.z + pz * k;
      if (opts.clamp) { const c = opts.clamp(a, nx, nz); nx = c.x; nz = c.z; }
      a.x = nx; a.z = nz;
      moved.add(a);
      any = true;
    }
    if (!any) break;
  }
  if (index instanceof SpatialBodyGrid) for (const b of moved) index.move(b.id, b.x, b.z);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { bodies: bodies.length, queries, pairs, moved: moved.size, maxPen, ms: t1 - t0 };
}

/**
 * Desvio local suavizado: direção desejada (dirX, dirZ normalizada) + repulsão dos vizinhos dentro do espaço pessoal
 * (mais forte quanto mais perto e quanto mais à frente). Devolve a direção ajustada (normalizada) e um fator de
 * velocidade (desacelera antes de encostar; nunca 0 — sem deadlock: a componente lateral continua).
 */
export function steerAround(selfId: string, x: number, z: number, dirX: number, dirZ: number, neighbors: readonly BodyRef[], personal: number = BODY.personalSpace): { dx: number; dz: number; speed: number } {
  let sx = 0, sz = 0, slow = 1;
  for (const n of neighbors) {
    if (n.id === selfId) continue;
    const ox = x - n.x, oz = z - n.z, d = Math.hypot(ox, oz);
    if (d >= personal || d < 1e-6) continue;
    const ahead = -(ox * dirX + oz * dirZ) / d; // 1 = vizinho bem à frente
    if (ahead < -0.2) continue; // atrás: ignora
    const w = (1 - d / personal) * (0.5 + 0.5 * Math.max(0, ahead));
    // repulsão + lateral (contorna pelo lado em que já está), sem parar de frente
    const side = ox * dirZ - oz * dirX >= 0 ? 1 : -1;
    sx += (ox / d) * w + dirZ * side * w * 0.8; sz += (oz / d) * w - dirX * side * w * 0.8;
    slow = Math.min(slow, 0.35 + 0.65 * (d / personal) + 0.3 * (1 - Math.max(0, ahead)));
  }
  let dx = dirX + sx * 1.6, dz = dirZ + sz * 1.6;
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) { dx = dirZ; dz = -dirX; } else { dx /= l; dz /= l; }
  return { dx, dz, speed: Math.max(0.3, Math.min(1, slow)) };
}

export interface FreeSpotOptions {
  /** id de quem procura (não colide consigo mesmo) */
  selfId?: string;
  /** o ponto é aceitável (paredes, mapa) — ex.: raycast livre do ponto original */
  clear?: (x: number, z: number) => boolean;
  /** raio máximo de busca (m; padrão 6) */
  maxRadius?: number;
  /** folga além do contato (m; padrão 0.06) */
  gap?: number;
}

/**
 * Ponto livre mais próximo de (x, z) para um corpo de raio r: o próprio ponto se livre; senão anéis a cada 0,5 m
 * (8 → 24 direções, começando pela direção oposta ao vizinho mais encostado). Sem nenhum livre: o original.
 */
export function findFreeSpot(x: number, z: number, r: number, index: BodyIndex, o: FreeSpotOptions = {}): { x: number; z: number; moved: boolean; tried: number } {
  const gap = o.gap ?? 0.06, maxR = o.maxRadius ?? 6;
  const buf: BodyRef[] = [];
  let tried = 0;
  const free = (px: number, pz: number) => {
    tried++;
    index.near(px, pz, r + MAX_R + gap, buf);
    for (const b of buf) if (b.id !== o.selfId && Math.hypot(px - b.x, pz - b.z) < r + b.r + gap) return false;
    return !o.clear || o.clear(px, pz);
  };
  if (free(x, z)) return { x, z, moved: false, tried };
  // direção de partida: para longe do vizinho mais encostado
  index.near(x, z, r + MAX_R + gap, buf);
  let a0 = 0, best = Infinity;
  for (const b of buf) { if (b.id === o.selfId) continue; const d = Math.hypot(x - b.x, z - b.z); if (d < best) { best = d; a0 = d > 1e-6 ? Math.atan2(z - b.z, x - b.x) : 0; } }
  for (let rr = 0.5; rr <= maxR + 1e-6; rr += 0.5) {
    const n = Math.min(24, Math.max(8, Math.round((2 * Math.PI * rr) / 0.45)));
    for (let i = 0; i < n; i++) {
      // alterna dos dois lados da direção de partida (0, +1, −1, +2, …)
      const k = i === 0 ? 0 : (i % 2 ? (i + 1) / 2 : -i / 2);
      const a = a0 + (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      if (free(px, pz)) return { x: px, z: pz, moved: true, tried };
    }
  }
  return { x, z, moved: false, tried };
}

/**
 * "Preso de verdade": quer andar, quase não anda, e está encostado em ≥ 2 corpos (ou 1 corpo + parede) por
 * `holdS` segundos seguidos. Só então vale um "unstuck" (ponto livre próximo). Multidão que só atrapalha NÃO dispara:
 * qualquer progresso (≥ 25 % do pedido) zera o relógio.
 */
export class StuckDetector {
  private t = 0;
  constructor(readonly holdS = 3) {}
  get seconds() { return this.t; }
  reset() { this.t = 0; }
  /** devolve true quando o limite foi atingido (e zera) */
  update(dt: number, wantM: number, movedM: number, contacts: number, wallContact: boolean): boolean {
    const pressing = wantM > 1e-3 && movedM < wantM * 0.25;
    const boxed = contacts >= 2 || (contacts >= 1 && wallContact);
    if (pressing && boxed) this.t += dt; else this.t = 0;
    if (this.t >= this.holdS) { this.t = 0; return true; }
    return false;
  }
}
