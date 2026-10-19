/**
 * Rodada 12 — VARIEDADE de animação por pessoa (puro, determinístico). Uma semente estável por pessoa (nid da rede,
 * id do agente) vira parâmetros próprios: fase inicial dos ciclos, cadência da passada, andamento do parado e
 * deslocamento de fase das ações em laço (palmas, dança, comemoração). Assim 100 pessoas que começam a bater palmas
 * no MESMO tick do servidor não ficam em uníssono, e duas pessoas paradas lado a lado não respiram juntas.
 *
 * Determinístico por id: todos os clientes veem a mesma pessoa com o mesmo jeito (e o QA reproduz).
 * Usado pelos esqueletos (HumanAnimator.setVariant) e pela multidão instanciada (CrowdRenderer, VAT).
 */

/** mistura de 32 bits (murmur3 fmix) — semente → inteiro bem espalhado */
export function mix32(n: number): number {
  let h = n >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** semente de uma pessoa a partir do id (número ou texto: sessionId) */
export function personSeed(id: number | string): number {
  if (typeof id === 'number') return mix32(Math.imul(id | 0, 0x9e3779b1) ^ 0x5bd1e995);
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return mix32(h);
}

/** k-ésimo número 0..1 derivado da semente (canais independentes) */
export function seedUnit(seed: number, k: number): number {
  return mix32((seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0) / 4294967296;
}

export interface AnimVariant {
  /** fase inicial dos ciclos de locomoção (0..1) */
  phase0: number;
  /** multiplicador da passada (> 1 = passos mais longos e cadência menor), 0,94..1,06 */
  stride: number;
  /** andamento do parado (respiração/balanço), 0,9..1,1 */
  idleRate: number;
  /** deslocamento de fase das ações em laço (fração do ciclo, 0..1) */
  actOffset: number;
  /** andamento das ações em laço, 0,96..1,04 */
  actRate: number;
}

export function animVariant(seed: number): AnimVariant {
  return {
    phase0: seedUnit(seed, 0),
    stride: 0.94 + seedUnit(seed, 1) * 0.12,
    idleRate: 0.9 + seedUnit(seed, 2) * 0.2,
    actOffset: seedUnit(seed, 3),
    actRate: 0.96 + seedUnit(seed, 4) * 0.08,
  };
}

/** fase (0..1) de uma ação em laço para esta pessoa: `t` s desde o início comum, ciclo `dur` s */
export function loopPhase(t: number, dur: number, v: Pick<AnimVariant, 'actOffset' | 'actRate'>): number {
  if (!(dur > 0)) return 0;
  const x = (t * v.actRate) / dur + v.actOffset;
  return ((x % 1) + 1) % 1;
}
