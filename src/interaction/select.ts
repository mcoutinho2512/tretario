/**
 * Rodada 10 — escolha do alvo (PURO, sem DOM/Three; tests/interaction.test.ts). docs/INTERACTION_SYSTEM.md
 *
 *  contextual  UM alvo para a tecla E / botão USAR / realce: no alcance (`maxDistance`), no estado certo, disponível;
 *              maior `priority` vence; empate → menor distância, ponderada pela mira (o que está à frente da câmera
 *              ganha de leve). Prioridade ≤ CONTEXT_MIN_PRIORITY (pessoas) só por clique/toque — nada de realce em
 *              cada pessoa que passa.
 *  tela        clique/toque: o candidato cujo ponto projetado está mais perto do dedo/cursor, dentro do raio de
 *              clique em px — nunca menor que o mínimo confortável (toque ≥ 44 px de diâmetro).
 */
import type { Interactable, InteractionPlayerState } from './types';

/** prioridade até aqui = só por clique/toque (não vira alvo contextual nem realce sozinho) */
export const CONTEXT_MIN_PRIORITY = 15;
/** diâmetro mínimo do alvo em px: toque (WCAG/Apple 44 px) e mouse */
export const TOUCH_MIN_PX = 44;
export const MOUSE_MIN_PX = 28;
/** além disso o candidato nem é coletado (clique em algo distante: "chegue mais perto") */
export const COLLECT_RADIUS_M = 30;

export function distOf(c: Interactable, px: number, pz: number): number {
  return c.distance ?? Math.hypot(c.x - px, c.z - pz);
}
export function inReach(c: Interactable, px: number, pz: number): boolean {
  return distOf(c, px, pz) <= c.maxDistance;
}
export function stateOk(c: Interactable, state: InteractionPlayerState): boolean {
  return c.allowedStates.includes(state);
}

/**
 * alvo contextual (E / USAR / realce). `aimX/aimZ` = direção (unitária) para onde a câmera olha no chão;
 * `type` restringe a um tipo (T = só 'pickup').
 */
export function chooseContext(
  cands: readonly Interactable[], px: number, pz: number, state: InteractionPlayerState,
  aimX = 0, aimZ = 0, type?: Interactable['interactionType'],
): Interactable | null {
  let best: Interactable | null = null, bp = -Infinity, bs = Infinity;
  for (const c of cands) {
    if (c.priority <= CONTEXT_MIN_PRIORITY || c.availability !== 'available' || !stateOk(c, state)) continue;
    if (type && c.interactionType !== type) continue;
    const d = distOf(c, px, pz);
    if (d > c.maxDistance) continue;
    // mira: cos do ângulo entre a câmera e o alvo (0,75 × d à frente, 1,25 × d atrás)
    const dx = c.x - px, dz = c.z - pz, l = Math.hypot(dx, dz);
    const cos = l > 0.05 ? (dx * aimX + dz * aimZ) / l : 1;
    const s = Math.max(0, d) * (1 - 0.25 * cos);
    if (c.priority > bp || (c.priority === bp && s < bs)) { best = c; bp = c.priority; bs = s; }
  }
  return best;
}

/** ponto de um candidato na tela (px, coordenadas do cliente) + raio do objeto em px; null = atrás da câmera */
export interface ScreenHit { sx: number; sy: number; rPx: number }

/**
 * clique/toque em (x, y): candidato (no estado certo) cujo ponto projetado está dentro do raio — o mais perto
 * relativo ao raio; praticamente empatados (≤ 0,05), o de maior prioridade.
 */
export function pickScreen(
  cands: readonly Interactable[], state: InteractionPlayerState, x: number, y: number, minPx: number,
  project: (c: Interactable) => ScreenHit | null,
): Interactable | null {
  let best: Interactable | null = null, bn = Infinity, bp = -Infinity;
  for (const c of cands) {
    if (!stateOk(c, state)) continue;
    const h = project(c);
    if (!h) continue;
    const r = Math.max(h.rPx, minPx / 2);
    const n = Math.hypot(h.sx - x, h.sy - y) / r;
    if (n > 1) continue;
    if (n < bn - 0.05 || (Math.abs(n - bn) <= 0.05 && c.priority > bp)) { best = c; bn = n; bp = c.priority; }
  }
  return best;
}

/** texto curto do realce: "CARRO · Entrar" (indisponível: "CARRO · Em uso") */
export function highlightText(c: Interactable, reach: boolean): string {
  const t = c.targetLabel.toUpperCase();
  if (c.availability === 'busy') return `${t} · Em uso`;
  if (c.availability === 'cooldown') return `${t} · Aguarde…`;
  return reach ? `${t} · ${c.interactionLabel}` : `${t} · chegue mais perto`;
}

/** ação contextual do HUD ("E — ENTRAR NO CARRO") */
export function promptText(c: Interactable): string {
  return c.prompt ?? `E — ${c.interactionLabel.toUpperCase()} · ${c.targetLabel.toUpperCase()}`;
}
