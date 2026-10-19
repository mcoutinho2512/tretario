/**
 * Rodada 12 — CÉREBRO leve (utility AI). Cada decisão pontua os objetivos possíveis: peso da personalidade × fator do
 * contexto × ruído individual, com INÉRCIA para o objetivo atual (continuidade: ninguém muda de ideia a cada decisão).
 * Sem planner, sem LLM, sem script por grupo: a torcida só entra como "há gente da MESMA torcida perto" (igualdade).
 */
import type { GoalKind, Personality } from './types';
import { PROFILES } from './personality';
import type { Rng } from './rng';

export interface BrainContext {
  personality: Personality;
  now: number;
  current: GoalKind | null;
  /** o objetivo atual ainda vale (não expirou)? */
  currentLive: boolean;
  /** pessoas disponíveis para conversa a ≤ 14 m (autônomos sem grupo cheio) */
  socialNear: number;
  inGroup: boolean;
  /** melhor ponto de concentração: distância (m) e peso; null = nenhum a ≤ 260 m */
  hotspot: { d: number; weight: number; moving: boolean; dance: boolean } | null;
  /** briga vista: distância e idade (ms); null = nenhuma recente */
  fight: { d: number; age: number; friendInvolved: boolean } | null;
  /** tenho torcida e há gente da mesma torcida a ≤ 120 m (contagem) */
  sameSupNear: number;
  hasSup: boolean;
  /** gosta de veículo e há um livre a ≤ 30 m */
  vehicleNear: boolean;
  vehicleAffinity: boolean;
  /** humano a ≤ 8 m (curiosidade) */
  humanNear: boolean;
  /** passou do tempo de permanência na área */
  overstay: boolean;
  /** ameaça recente contra mim (fui atacado) */
  threatened: boolean;
}

export const GOAL_KINDS: readonly GoalKind[] = ['WANDER', 'MEET_GROUP', 'FOLLOW_EVENT', 'WATCH_EVENT', 'JOIN_CROWD', 'SOCIALIZE', 'CHEER', 'DANCE', 'TRAVEL', 'USE_VEHICLE', 'WATCH_FIGHT', 'AVOID_FIGHT', 'JOIN_FIGHT', 'LEAVE_AREA', 'FOLLOW_SUPPORTERS', 'IDLE'];

/** utilidade de cada objetivo neste contexto (0 = impossível agora) */
export function utilities(c: BrainContext, out: Partial<Record<GoalKind, number>> = {}): Partial<Record<GoalKind, number>> {
  const P = PROFILES[c.personality];
  const g = (k: GoalKind) => P.goals[k] ?? 0.1;
  const hs = c.hotspot;
  const hsF = hs ? Math.min(1.6, hs.weight) * (hs.d < 40 ? 1.3 : hs.d < 120 ? 1 : 0.6) : 0;
  out.WANDER = g('WANDER');
  out.IDLE = g('IDLE') * (c.humanNear ? 1 + P.curiosity * 0.5 : 1);
  out.TRAVEL = g('TRAVEL');
  out.SOCIALIZE = c.socialNear > 0 || c.inGroup ? g('SOCIALIZE') * (0.6 + Math.min(3, c.socialNear) * 0.25) * (0.5 + P.social) : 0;
  out.MEET_GROUP = c.socialNear > 1 ? g('MEET_GROUP') * 0.6 * (0.5 + P.social) : 0;
  out.JOIN_CROWD = hs ? g('JOIN_CROWD') * hsF : 0;
  out.WATCH_EVENT = hs ? g('WATCH_EVENT') * hsF : 0;
  out.CHEER = hs && hs.d < 80 ? g('CHEER') * hsF : 0;
  out.DANCE = hs && hs.dance && hs.d < 60 ? g('DANCE') * hsF : 0;
  out.FOLLOW_EVENT = hs && hs.moving ? g('FOLLOW_EVENT') * hsF * 1.2 : 0;
  out.FOLLOW_SUPPORTERS = c.hasSup && c.sameSupNear >= 2 ? g('FOLLOW_SUPPORTERS') * (0.7 + Math.min(6, c.sameSupNear) * 0.12) : 0;
  out.USE_VEHICLE = c.vehicleAffinity && c.vehicleNear ? 1.1 + g('USE_VEHICLE') : 0;
  out.LEAVE_AREA = c.overstay ? 0.9 : 0;
  // briga: observar / evitar / entrar — pela personalidade e pelo vínculo (amigo apanhando)
  if (c.fight && c.fight.age < 20_000) {
    const near = c.fight.d < 10 ? 1.3 : c.fight.d < 25 ? 1 : 0.5;
    out.WATCH_FIGHT = P.fight.watch * 1.6 * near;
    out.AVOID_FIGHT = P.fight.flee * 1.8 * (c.fight.d < 12 ? 1.5 : 0.8);
    out.JOIN_FIGHT = c.fight.d < 14 ? (P.fight.join + (c.fight.friendInvolved ? P.fight.defend : 0)) * 1.4 : 0;
  } else { out.WATCH_FIGHT = 0; out.AVOID_FIGHT = 0; out.JOIN_FIGHT = 0; }
  if (c.threatened) { out.AVOID_FIGHT = (out.AVOID_FIGHT ?? 0) + P.fight.flee * 1.5; out.JOIN_FIGHT = (out.JOIN_FIGHT ?? 0) + P.fight.join * 1.2; }
  return out;
}

/** escolhe o próximo objetivo: utilidade × ruído individual, inércia de 1,6× para o atual */
export function chooseGoal(c: BrainContext, rng: Rng): GoalKind {
  const u = utilities(c);
  let best: GoalKind = 'WANDER', bestV = -1;
  for (const k of GOAL_KINDS) {
    let v = u[k] ?? 0;
    if (v <= 0) continue;
    v *= 0.6 + rng.next() * 0.8;
    if (k === c.current && c.currentLive) v *= 1.6;
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

/** duração típica de cada objetivo (ms) [mín, máx] — reavaliado ao fim (ou antes, por interrupção) */
export const GOAL_MS: Record<GoalKind, [number, number]> = {
  WANDER: [25_000, 90_000], IDLE: [8_000, 40_000], TRAVEL: [60_000, 200_000], SOCIALIZE: [35_000, 150_000], MEET_GROUP: [30_000, 100_000],
  JOIN_CROWD: [45_000, 180_000], WATCH_EVENT: [30_000, 120_000], CHEER: [20_000, 70_000], DANCE: [20_000, 80_000], FOLLOW_EVENT: [60_000, 240_000],
  FOLLOW_SUPPORTERS: [45_000, 180_000], USE_VEHICLE: [40_000, 150_000], LEAVE_AREA: [60_000, 180_000],
  WATCH_FIGHT: [10_000, 30_000], AVOID_FIGHT: [8_000, 20_000], JOIN_FIGHT: [8_000, 22_000],
};
