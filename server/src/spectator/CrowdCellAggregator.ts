/**
 * Células agregadas do espectador AÉREO (rodada 8.1) — PURO e testável (tests/crowdCells.test.ts).
 *
 *  CrowdCellAggregator  monta UMA vez por período (CROWD_CELL.hz) o conjunto de células da avenida a partir dos
 *                       jogadores REAIS (posição, grupo do evento, atividade) + estimativa da multidão de AMBIENTE
 *                       (dados do evento: concentrações × rallyCrowd, pedestres) — jogadores e ambiente SEPARADOS.
 *                       Compartilhado por todos os espectadores (nunca por espectador). Determinístico: mesma entrada
 *                       (em qualquer ordem) → snapshots idênticos; seed = cellSeed(cx, cz, época).
 *  environmentCells     estimativa determinística do ambiente por célula (amostragem fixa dos anéis de concentração
 *                       com a mesma distribuição do cliente + pedestres ao longo do eixo; arredondamento pelo maior resto)
 *  CellFeed             entrega por espectador: delta (alteradas + removidas) desde o último envio, `full` na troca de
 *                       camada/entrada, FAR = células a ≤ farRadius do foco, AGGREGATE = todas; teto de bytes/s por
 *                       balde de fichas (o que não coube vai no próximo envio, mais perto do foco primeiro)
 */
import { CELL_ACTIVITIES, CROWD_CELL, cellSeed, type CrowdCellSnapshot, type SpecCellsMessage, type SpecTier } from '../../../src/spectator/tiers';
import { CELL_INDEX_MAX, cellDensity, cellKey, cellWireBytes, headerWireBytes } from '../../../src/spectator/cellCodec';
import { RallyRegistry } from '../../../src/social/rally';
import { pointOnAxis } from '../../../src/world/zones';

/** jogador como o agregador o vê (atividade: índice em CELL_ACTIVITIES) */
export interface CellPlayer { x: number; z: number; group: string; activity: number }
/** concentração (mesma forma do cliente — src/social/rally.ts RALLY_SHAPE) */
export interface EnvRally { x: number; z: number; inner: number; radius: number; strength: number;
  /** rodada 9 — NPCs reservados do ponto (evento agendado: ScheduledEventDef.npcCrowd), fora da divisão de rallyCrowd */
  crowd?: number }
export interface EnvModel {
  rallies: readonly EnvRally[];
  /** pessoas de concentração (social.rallyCrowd do evento) */
  rallyCrowd: number;
  /** pedestres NPC estimados (PEDESTRIAN_ESTIMATE × npcs.pedestrianDensity) */
  peds: number;
  /** eixo da avenida e trecho onde os pedestres são distribuídos (frações 0..1) */
  axis: readonly [number, number][];
  pedRange: readonly [number, number];
}

const NA = CELL_ACTIVITIES.length;
const inGrid = (cx: number, cz: number) => cx >= -CELL_INDEX_MAX && cx <= CELL_INDEX_MAX && cz >= -CELL_INDEX_MAX && cz <= CELL_INDEX_MAX;

/** n pessoas distribuídas por pesos (chave → peso), arredondamento pelo maior resto; empate → menor chave */
export function apportion(n: number, w: Map<number, number>, out: Map<number, number>) {
  let W = 0;
  for (const v of w.values()) W += v;
  if (n <= 0 || W <= 0) return;
  const rows: [number, number][] = [];
  let given = 0;
  for (const [k, v] of w) {
    const q = (n * v) / W, b = Math.floor(q + 1e-9);
    given += b;
    if (b) out.set(k, (out.get(k) ?? 0) + b);
    rows.push([k, q - b]);
  }
  rows.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  for (let i = 0; i < n - given && i < rows.length; i++) out.set(rows[i][0], (out.get(rows[i][0]) ?? 0) + 1);
}

/** amostras fixas por anel: 24 ângulos × 8 raios com a MESMA distribuição de RallyRegistry.spotFor */
const RING_A = 24, RING_R = 8;

/** multidão de ambiente por célula (chave → pessoas) — determinística, soma exata (menos o que cair fora da grade) */
export function environmentCells(m: EnvModel, size: number = CROWD_CELL.sizeM): Map<number, number> {
  const out = new Map<number, number>();
  // concentrações: pessoas por ponto ∝ força × área do anel (igual a RallyCrowd.rebuild)
  const pts = m.rallies.filter((p) => p.strength > 0);
  const pw = new Map<number, number>();
  pts.forEach((p, i) => { if (!p.crowd) pw.set(i, p.strength * (p.radius * p.radius - p.inner * p.inner)); });
  const perPoint = new Map<number, number>();
  apportion(Math.max(0, Math.round(m.rallyCrowd)), pw, perPoint);
  pts.forEach((p, i) => {
    const n = p.crowd ? Math.round(p.crowd) : perPoint.get(i) ?? 0;
    if (!n) return;
    const w = new Map<number, number>();
    for (let a = 0; a < RING_A; a++) for (let r = 0; r < RING_R; r++) {
      const s = RallyRegistry.spotFor({ ...p, id: '', kind: 'event' }, (a + 0.5) / RING_A, (r + 0.5) / RING_R);
      const cx = Math.floor(s.x / size), cz = Math.floor(s.z / size);
      if (!inGrid(cx, cz)) continue;
      const k = cellKey(cx, cz);
      w.set(k, (w.get(k) ?? 0) + 1);
    }
    apportion(n, w, out);
  });
  // pedestres: espalhados ao longo do eixo (Central → Candelária), uma amostra a cada ~meia célula
  const peds = Math.max(0, Math.round(m.peds));
  if (peds && m.axis.length > 1) {
    const w = new Map<number, number>();
    const S = 96;
    for (let i = 0; i < S; i++) {
      const t = m.pedRange[0] + ((i + 0.5) / S) * (m.pedRange[1] - m.pedRange[0]);
      const p = pointOnAxis(m.axis as [number, number][], t);
      const cx = Math.floor(p.x / size), cz = Math.floor(p.z / size);
      if (!inGrid(cx, cz)) continue;
      const k = cellKey(cx, cz);
      w.set(k, (w.get(k) ?? 0) + 1);
    }
    apportion(peds, w, out);
  }
  return out;
}

/** conjunto de células de um período (compartilhado) */
export interface CellSet {
  t: number;
  /** chave → snapshot (ordem crescente de chave) */
  cells: Map<number, CrowdCellSnapshot>;
  /** chave → assinatura do conteúdo (sem `t`): detecção de mudança barata por espectador */
  sig: Map<number, number>;
  totals: { players: number; env: number; cells: number };
}

/** assinatura (FNV-1a de 32 bits) do conteúdo da célula — independe de `t` */
export function cellSignature(c: CrowdCellSnapshot): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h = Math.imul(h ^ (v & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (v >>> 16), 16777619) >>> 0; };
  mix(c.players); mix(c.env);
  for (const a of c.activity) mix(a);
  for (const g of Object.keys(c.groups)) { for (let i = 0; i < g.length; i++) mix(g.charCodeAt(i)); mix(c.groups[g] + 1); }
  return h >>> 0;
}

export class CrowdCellAggregator {
  stats = { builds: 0, ms: 0 };
  constructor(readonly epoch: number, readonly size: number = CROWD_CELL.sizeM) {}

  /** monta o conjunto: jogadores (qualquer ordem) + ambiente por célula */
  build(players: Iterable<CellPlayer>, env: ReadonlyMap<number, number>, t: number): CellSet {
    const t0 = performance.now();
    const acc = new Map<number, { players: number; act: number[]; groups: Map<string, number> }>();
    let totalP = 0, totalE = 0;
    for (const p of players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const cx = Math.floor(p.x / this.size), cz = Math.floor(p.z / this.size);
      if (!inGrid(cx, cz)) continue;
      const k = cellKey(cx, cz);
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { players: 0, act: [0, 0, 0, 0], groups: new Map() }));
      a.players++;
      a.act[Math.max(0, Math.min(NA - 1, p.activity | 0))]++;
      const g = p.group ?? '';
      a.groups.set(g, (a.groups.get(g) ?? 0) + 1);
      totalP++;
    }
    const keys = new Set<number>([...acc.keys()]);
    for (const [k, v] of env) if (v > 0) keys.add(k);
    const cells = new Map<number, CrowdCellSnapshot>(), sig = new Map<number, number>();
    for (const k of [...keys].sort((a, b) => a - b)) {
      const cx = (k & 255) - 128, cz = (k >> 8) - 128;
      const a = acc.get(k), e = env.get(k) ?? 0;
      const groups: Record<string, number> = {};
      if (a) for (const g of [...a.groups.keys()].sort()) groups[g] = a.groups.get(g)!;
      const players = a?.players ?? 0;
      const c: CrowdCellSnapshot = {
        cx, cz, players, env: e, groups, activity: (a ? [a.act[0], a.act[1], a.act[2], a.act[3]] : [0, 0, 0, 0]) as [number, number, number, number],
        density: cellDensity(players, e, this.size), seed: cellSeed(cx, cz, this.epoch), t,
      };
      totalE += e;
      cells.set(k, c);
      sig.set(k, cellSignature(c));
    }
    this.stats.builds++;
    this.stats.ms = performance.now() - t0;
    return { t, cells, sig, totals: { players: totalP, env: totalE, cells: cells.size } };
  }
}

/** estado de entrega de UM espectador */
export class CellFeed {
  /** chave → assinatura do que o cliente TEM */
  private sent = new Map<number, number>();
  private tier: SpecTier = 'NEAR';
  private tokens: number = CROWD_CELL.maxBytesPerSec;
  private at = -Infinity;
  private needFull = true;
  /** QA: bytes e mensagens enviados; envios cortados pelo teto */
  stats = { bytes: 0, msgs: 0, capped: 0, cells: 0 };

  constructor(private maxBytesPerSec: number = CROWD_CELL.maxBytesPerSec, private farRadius: number = CROWD_CELL.farRadiusM, private size: number = CROWD_CELL.sizeM) {}

  /** camada mudou (servidor decide pela altitude): próximo envio é `full` */
  setTier(t: SpecTier) { if (t !== this.tier) { this.tier = t; this.needFull = true; } }
  get currentTier() { return this.tier; }
  /** quantas células o cliente tem agora */
  get known() { return this.sent.size; }

  /** a célula entra no envio desta camada? (FAR com folga de 1 célula para sair: sem pisca-pisca na borda) */
  private wanted(k: number, fx: number, fz: number, had: boolean): boolean {
    if (this.tier === 'AGGREGATE') return true;
    if (this.tier !== 'FAR') return false;
    const cx = (k & 255) - 128, cz = (k >> 8) - 128;
    const d = Math.hypot((cx + 0.5) * this.size - fx, (cz + 0.5) * this.size - fz);
    return d <= this.farRadius + (had ? this.size : 0);
  }

  /**
   * próxima mensagem (forma decodificada) ou null (nada mudou). NEAR/MID: uma única mensagem `full` vazia ao entrar
   * na camada (o cliente apaga as células) e depois nada. Respeita o teto: o que não cabe fica para o próximo envio.
   */
  next(set: CellSet, focus: { x: number; z: number }, now: number): SpecCellsMessage | null {
    const dt = Number.isFinite(this.at) ? Math.max(0, (now - this.at) / 1000) : 1;
    this.at = now;
    this.tokens = Math.min(this.maxBytesPerSec, this.tokens + this.maxBytesPerSec * dt);
    const full = this.needFull;
    if (full) this.sent.clear();
    if (this.tier === 'NEAR' || this.tier === 'MID') {
      if (!full) return null;
      this.needFull = false;
      return this.account({ tier: this.tier, cells: [], removed: [], full: true }, 20);
    }
    const removed: [number, number][] = [];
    for (const k of this.sent.keys()) if (!set.cells.has(k) || !this.wanted(k, focus.x, focus.z, true)) removed.push([(k & 255) - 128, (k >> 8) - 128]);
    const cand: { k: number; d: number }[] = [];
    for (const [k, c] of set.cells) {
      const had = this.sent.has(k);
      if (!this.wanted(k, focus.x, focus.z, had)) continue;
      if (had && this.sent.get(k) === set.sig.get(k)) continue;
      cand.push({ k, d: Math.hypot((c.cx + 0.5) * this.size - focus.x, (c.cz + 0.5) * this.size - focus.z) });
    }
    if (!full && !removed.length && !cand.length) return null;
    cand.sort((a, b) => a.d - b.d || a.k - b.k);
    // orçamento: cabeçalho com TODAS as chaves de grupo possíveis (limite superior) + removidas + células em ordem
    const gk = new Set<string>();
    for (const { k } of cand) for (const g of Object.keys(set.cells.get(k)!.groups)) gk.add(g);
    let bytes = headerWireBytes(gk) + removed.length * 2;
    const cells: CrowdCellSnapshot[] = [];
    let capped = false;
    for (const { k } of cand) {
      const c = set.cells.get(k)!, b = cellWireBytes(c);
      if (bytes + b > this.tokens) { capped = true; break; }
      bytes += b;
      cells.push(c);
    }
    if (!cells.length && !removed.length && !full) { if (capped) this.stats.capped++; return null; }
    for (const [cx, cz] of removed) this.sent.delete(cellKey(cx, cz));
    for (const c of cells) this.sent.set(cellKey(c.cx, c.cz), set.sig.get(cellKey(c.cx, c.cz))!);
    this.needFull = false;
    if (capped) this.stats.capped++;
    return this.account({ tier: this.tier, cells, removed, full }, bytes);
  }

  private account(m: SpecCellsMessage, bytes: number): SpecCellsMessage {
    this.tokens -= bytes;
    this.stats.bytes += bytes; this.stats.msgs++; this.stats.cells += m.cells.length;
    return m;
  }
}
