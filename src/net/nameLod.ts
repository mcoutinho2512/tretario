/**
 * LOD dos apelidos sobre os jogadores (rodada 8; rodada 12: população). Puro — decide QUEM tem rótulo e em que forma;
 * o NetworkClient só aplica (pool fixo de rótulos, ver src/net/NameTagPool.ts; decisões a ~5 Hz; transform por quadro
 * só dos escolhidos).
 *
 * HUMANOS (e bots de carga)
 *  0–15 m   apelido completo
 *  15–30 m  simplificado (menor, encurtado) — com MUITA gente na faixa (> `midCrowd`), só centro da tela/foco/interagindo
 *  30–50 m  só perto do centro da tela ou interagindo (chat/ação)
 *  > 50 m   nada
 * AUTÔNOMOS (NetPlayer.kind = 1; docs/AUTONOMOUS_CHARACTERS.md § Cliente)
 *  parte deles NÃO tem nome (`tagged` = false: regra `autonomousTagged`) — nunca mostra
 *  0–18 m   completo · 18–35 m como a faixa média dos humanos · > 35 m nada
 * Foco (hover do cursor / pessoa selecionada no painel): completo em qualquer faixa até o limite da categoria.
 * Oclusão: quem está atrás de prédio (raio câmera → cabeça bloqueado, amostrado — `OcclusionCache`) não tem rótulo.
 * No máximo `cap` rótulos na tela, por prioridade (perto + centro; interagindo/foco ganham).
 * Preferência NOMES DOS JOGADORES: TODOS (sem a restrição do centro) | PRÓXIMOS (regras acima) | NENHUM.
 */
export type NamesMode = 'TODOS' | 'PROXIMOS' | 'NENHUM';
export type NameTier = 'full' | 'short' | 'hidden';

export const NAME_LOD = {
  full: 15,
  short: 30,
  max: 50,
  /** raio (fração da meia-tela, NDC) considerado "centro da tela" para a faixa 30–50 m */
  center: 0.28,
  /** histerese (m) nas fronteiras: quem já está numa faixa só sai dela com esta folga */
  hyst: 1.5,
  cap: 14,
  /** faixa média (15–30 m) com mais candidatos que isto: só centro da tela / foco / interagindo */
  midCrowd: 8,
  /** autônomos: completo até `full`, faixa média até `mid`, nada além (public/gameplay/autonomous.json `nametag`) */
  npc: { full: 18, mid: 35 },
} as const;

/** limites de distância de uma categoria (humanos × autônomos) */
export interface NameRanges { full: number; short: number; max: number }
export const HUMAN_RANGES: NameRanges = { full: NAME_LOD.full, short: NAME_LOD.short, max: NAME_LOD.max };
export const npcRanges = (full: number = NAME_LOD.npc.full, mid: number = NAME_LOD.npc.mid): NameRanges => ({ full, short: mid, max: mid });

export interface NameCandidate {
  /** índice/identificador do chamador (devolvido na escolha) */
  key: number;
  /** distância horizontal câmera → jogador (m) */
  dist: number;
  /** posição projetada (NDC −1..1); `front` = à frente da câmera */
  nx: number;
  ny: number;
  front: boolean;
  /** falando no chat / fazendo uma ação agora */
  interacting: boolean;
  /** faixa da decisão anterior (histerese) */
  prev: NameTier;
  /** rodada 12 — tipo (src/world/entityKind.ts; ausente = humano) */
  kind?: number;
  /** rodada 12 — autônomo com nome (ausente = sim); falso = nunca mostra */
  tagged?: boolean;
  /** rodada 12 — sob o cursor ou selecionado no painel */
  focus?: boolean;
}

/** contexto da decisão (densidade da faixa média, limites dos autônomos) */
export interface NameContext { crowded?: boolean; npc?: NameRanges }

/** faixa de UM rótulo (antes do limite de quantidade e da oclusão) */
export function nameTier(c: NameCandidate, mode: NamesMode, ctx: NameContext = {}): NameTier {
  if (mode === 'NENHUM' || !c.front) return 'hidden';
  if (Math.abs(c.nx) > 1.05 || Math.abs(c.ny) > 1.05) return 'hidden'; // fora da tela
  const npc = c.kind === 1;
  if (npc && c.tagged === false) return 'hidden'; // autônomo sem nome
  const R = npc ? ctx.npc ?? npcRanges() : HUMAN_RANGES;
  const h = NAME_LOD.hyst;
  const fullLim = c.prev === 'full' ? R.full + h : R.full;
  const shortLim = c.prev === 'full' || c.prev === 'short' ? R.short + h : R.short;
  const maxLim = c.prev !== 'hidden' ? R.max + h : R.max;
  if (c.dist > maxLim) return 'hidden';
  if (c.dist <= fullLim) return 'full';
  if (c.focus) return 'full';
  const cr = c.prev === 'hidden' ? NAME_LOD.center : NAME_LOD.center * 1.25;
  const central = Math.hypot(c.nx, c.ny * 0.8) <= cr;
  if (c.dist <= shortLim) {
    // faixa média: com muita gente, só o centro da tela (e quem está interagindo)
    if (!ctx.crowded || mode === 'TODOS' || c.interacting) return 'short';
    return central ? 'short' : 'hidden';
  }
  // 30–50 m (só humanos: nos autônomos short = max)
  if (mode === 'TODOS' || c.interacting) return 'short';
  return central ? 'short' : 'hidden';
}

/** candidatos na faixa média (para a regra de densidade) */
export function midBandCount(cands: readonly NameCandidate[], npc: NameRanges = npcRanges()): number {
  let n = 0;
  for (const c of cands) {
    if (!c.front) continue;
    const R = c.kind === 1 ? npc : HUMAN_RANGES;
    if (c.dist > R.full && c.dist <= R.short && !(c.kind === 1 && c.tagged === false)) n++;
  }
  return n;
}

/** prioridade (menor = mais importante): distância ponderada pela distância ao centro da tela */
export function namePriority(c: NameCandidate): number {
  const center = Math.hypot(c.nx, c.ny);
  return c.dist * (1 + center * 0.6) * (c.interacting ? 0.25 : 1) * (c.focus ? 0.1 : 1);
}

/**
 * escolhe os rótulos visíveis: devolve um mapa key → faixa só dos visíveis (no máximo `cap`).
 * `occluded(key)` (opcional): consultado na ordem de prioridade só para quem passaria — ocluído não gasta vaga.
 * `scratch` evita alocar a cada decisão.
 */
export function selectNames(cands: readonly NameCandidate[], mode: NamesMode, cap: number = NAME_LOD.cap, scratch: { c: NameCandidate; t: NameTier; p: number }[] = [], occluded?: (key: number) => boolean, npc?: NameRanges): Map<number, NameTier> {
  scratch.length = 0;
  const ctx: NameContext = { crowded: midBandCount(cands, npc) > NAME_LOD.midCrowd, npc };
  for (const c of cands) {
    const t = nameTier(c, mode, ctx);
    if (t !== 'hidden') scratch.push({ c, t, p: namePriority(c) });
  }
  scratch.sort((a, b) => a.p - b.p);
  const out = new Map<number, NameTier>();
  for (let i = 0; i < scratch.length && out.size < cap; i++) {
    const e = scratch[i];
    if (occluded?.(e.c.key)) continue;
    out.set(e.c.key, e.t);
  }
  return out;
}

/**
 * rodada 12 — autônomo tem nome? `override` (campo tolerante do servidor, ex. NetPlayer.tag: 1 = sim, 2 = não; 0/ausente
 * = regra) ou a regra determinística pela semente do nid e a fração `share` (autonomous.json `nametag.share`).
 */
export function autonomousTagged(nid: number, share: number, override?: number): boolean {
  if (override === 1) return true;
  if (override === 2) return false;
  let h = Math.imul((nid | 0) ^ 0x2c1b3c6d, 0x297a2d39) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296 < share;
}

/**
 * rodada 12 — OCLUSÃO amostrada (puro; o raio é injetado). Cada chave é retestada no máximo a cada `ttlMs`, e cada
 * decisão faz no máximo `budget` raios novos (o resto usa o último resultado; desconhecido = visível). Para ficar
 * ocluído precisa de 2 testes seguidos bloqueados (sem piscar na quina de prédio); desocluir é imediato.
 */
export class OcclusionCache {
  private m = new Map<number, { at: number; hits: number; occ: boolean }>();
  private used = 0;
  rays = 0;
  constructor(public ttlMs = 400, public budget = 8) {}
  /** início de uma decisão (zera o orçamento de raios) */
  begin() { this.used = 0; }
  /** `blocked()` só é chamado se o resultado guardado venceu e ainda há orçamento */
  test(key: number, now: number, blocked: () => boolean): boolean {
    let e = this.m.get(key);
    if (e && now - e.at < this.ttlMs) return e.occ;
    if (this.used >= this.budget) return e?.occ ?? false;
    this.used++; this.rays++;
    const b = blocked();
    if (!e) this.m.set(key, (e = { at: now, hits: 0, occ: false }));
    e.at = now;
    e.hits = b ? e.hits + 1 : 0;
    e.occ = e.hits >= 2;
    return e.occ;
  }
  forget(key: number) { this.m.delete(key); }
  /** QA: último resultado guardado (undefined = nunca testado) */
  peek(key: number): boolean | undefined { return this.m.get(key)?.occ; }
  get size() { return this.m.size; }
}

/** fração do raio câmera→cabeça a partir da qual uma parede conta como "na frente" (folga de ~0,6 m antes do alvo) */
export function rayBlocks(frac: number, lenM: number): boolean {
  return frac < 1 - Math.min(0.5, 0.6 / Math.max(0.01, lenM));
}

/** apelido simplificado (faixa 15–30 m): no máximo `max` caracteres, cortando na palavra quando dá */
export function shortName(name: string, max = 10): string {
  const n = name.trim();
  if (n.length <= max) return n;
  const first = n.split(/\s+/)[0];
  if (first.length >= 3 && first.length <= max) return first;
  return `${n.slice(0, max - 1)}…`;
}
