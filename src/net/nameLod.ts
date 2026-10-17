/**
 * LOD dos apelidos sobre os jogadores (rodada 8). Puro — decide QUEM tem rótulo e em que forma; o NetworkClient só
 * aplica (classe/visibilidade nas decisões, a ~5 Hz; transform por quadro só dos escolhidos).
 *
 *  0–15 m   apelido completo
 *  15–30 m  simplificado (menor, encurtado)
 *  30–50 m  só perto do centro da tela ou interagindo (chat/ação)
 *  > 50 m   nada
 * No máximo `cap` rótulos na tela, por prioridade (perto + centro; interagindo ganha).
 * Preferência NOMES DOS JOGADORES: TODOS (sem a restrição do centro até 50 m) | PRÓXIMOS (regras acima) | NENHUM.
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
} as const;

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
}

/** faixa de UM rótulo (antes do limite de quantidade) */
export function nameTier(c: NameCandidate, mode: NamesMode): NameTier {
  if (mode === 'NENHUM' || !c.front) return 'hidden';
  if (Math.abs(c.nx) > 1.05 || Math.abs(c.ny) > 1.05) return 'hidden'; // fora da tela
  const h = NAME_LOD.hyst;
  const lim = (base: number, tier: NameTier) => (c.prev === tier ? base + h : base);
  const fullLim = lim(NAME_LOD.full, 'full');
  const shortLim = c.prev === 'full' || c.prev === 'short' ? NAME_LOD.short + h : NAME_LOD.short;
  const maxLim = c.prev !== 'hidden' ? NAME_LOD.max + h : NAME_LOD.max;
  if (c.dist > maxLim) return 'hidden';
  if (c.dist <= fullLim) return 'full';
  if (c.dist <= shortLim) return 'short';
  // 30–50 m
  if (mode === 'TODOS' || c.interacting) return 'short';
  const cr = c.prev === 'hidden' ? NAME_LOD.center : NAME_LOD.center * 1.25;
  return Math.hypot(c.nx, c.ny * 0.8) <= cr ? 'short' : 'hidden';
}

/** prioridade (menor = mais importante): distância ponderada pela distância ao centro da tela */
export function namePriority(c: NameCandidate): number {
  const center = Math.hypot(c.nx, c.ny);
  return c.dist * (1 + center * 0.6) * (c.interacting ? 0.25 : 1);
}

/**
 * escolhe os rótulos visíveis: devolve um mapa key → faixa só dos visíveis (no máximo `cap`).
 * `scratch` evita alocar a cada decisão.
 */
export function selectNames(cands: readonly NameCandidate[], mode: NamesMode, cap: number = NAME_LOD.cap, scratch: { c: NameCandidate; t: NameTier; p: number }[] = []): Map<number, NameTier> {
  scratch.length = 0;
  for (const c of cands) {
    const t = nameTier(c, mode);
    if (t !== 'hidden') scratch.push({ c, t, p: namePriority(c) });
  }
  scratch.sort((a, b) => a.p - b.p);
  const out = new Map<number, NameTier>();
  for (let i = 0; i < scratch.length && i < cap; i++) out.set(scratch[i].c.key, scratch[i].t);
  return out;
}

/** apelido simplificado (faixa 15–30 m): no máximo `max` caracteres, cortando na palavra quando dá */
export function shortName(name: string, max = 10): string {
  const n = name.trim();
  if (n.length <= max) return n;
  const first = n.split(/\s+/)[0];
  if (first.length >= 3 && first.length <= max) return first;
  return `${n.slice(0, max - 1)}…`;
}
