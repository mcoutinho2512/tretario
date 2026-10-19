/**
 * Rodada 12 — PERSONALIDADES como pesos (não scripts). O cérebro (brain.ts) multiplica estes pesos pelo contexto
 * (concentração por perto, briga vista, grupo, veículo livre…) e sorteia com ruído; duas pessoas da mesma personalidade
 * ainda divergem pela variação individual (`jitter` no nascimento) e pela memória curta.
 */
import type { GoalKind, Personality } from './types';

export interface PersonalityProfile {
  /** peso-base de cada objetivo (ausente = 0,1) */
  goals: Partial<Record<GoalKind, number>>;
  /** multiplicador da velocidade de caminhada */
  speed: number;
  /** chance de correr quando o objetivo tem pressa (viagem longa, fuga, alcançar o grupo) */
  run: number;
  /** vontade de formar/entrar em roda de conversa */
  social: number;
  /** gestos por minuto quando em roda/evento (média; cada pessoa varia) */
  gestures: number;
  /** atenção a humanos perto (olhar, parar, acenar) */
  curiosity: number;
  /** reação a briga: observar, entrar, fugir, defender amigo */
  fight: { watch: number; join: number; flee: number; defend: number };
  /** multiplicador do espaço pessoal */
  space: number;
  /** minutos na área antes de ir embora [mín, máx] */
  stayMin: [number, number];
  /** propensão a discutir quando esbarrado/bloqueado (raríssimo; o diretor de eventos coordena a escalada) */
  temper: number;
}

const P = (p: PersonalityProfile) => p;

export const PROFILES: Record<Personality, PersonalityProfile> = {
  SOCIAL: P({ goals: { SOCIALIZE: 1.4, MEET_GROUP: 1.0, WANDER: 0.5, JOIN_CROWD: 0.6, IDLE: 0.3, CHEER: 0.3, DANCE: 0.35, WATCH_EVENT: 0.4 }, speed: 0.97, run: 0.1, social: 0.9, gestures: 5, curiosity: 0.6, fight: { watch: 0.5, join: 0.05, flee: 0.35, defend: 0.35 }, space: 0.85, stayMin: [8, 25], temper: 0.05 }),
  OBSERVADOR: P({ goals: { WATCH_EVENT: 1.2, IDLE: 0.9, WANDER: 0.5, SOCIALIZE: 0.35, JOIN_CROWD: 0.4 }, speed: 0.9, run: 0.05, social: 0.35, gestures: 1.5, curiosity: 0.8, fight: { watch: 0.9, join: 0.02, flee: 0.25, defend: 0.15 }, space: 1.15, stayMin: [10, 30], temper: 0.03 }),
  AGITADO: P({ goals: { JOIN_CROWD: 1.0, CHEER: 1.0, DANCE: 0.8, WANDER: 0.7, SOCIALIZE: 0.6, FOLLOW_EVENT: 0.6 }, speed: 1.12, run: 0.35, social: 0.6, gestures: 8, curiosity: 0.7, fight: { watch: 0.6, join: 0.25, flee: 0.1, defend: 0.6 }, space: 0.8, stayMin: [5, 18], temper: 0.25 }),
  TORCEDOR: P({ goals: { FOLLOW_SUPPORTERS: 1.4, CHEER: 0.9, JOIN_CROWD: 0.7, SOCIALIZE: 0.6, WANDER: 0.4 }, speed: 1.02, run: 0.18, social: 0.75, gestures: 6, curiosity: 0.5, fight: { watch: 0.55, join: 0.12, flee: 0.2, defend: 0.7 }, space: 0.85, stayMin: [10, 30], temper: 0.12 }),
  MANIFESTANTE: P({ goals: { FOLLOW_EVENT: 1.3, JOIN_CROWD: 1.1, CHEER: 0.7, WATCH_EVENT: 0.5, SOCIALIZE: 0.5, WANDER: 0.3 }, speed: 0.98, run: 0.08, social: 0.6, gestures: 5, curiosity: 0.4, fight: { watch: 0.4, join: 0.04, flee: 0.45, defend: 0.3 }, space: 0.85, stayMin: [12, 35], temper: 0.05 }),
  EXPLORADOR: P({ goals: { TRAVEL: 1.3, WANDER: 1.0, USE_VEHICLE: 0.8, WATCH_EVENT: 0.3, IDLE: 0.2 }, speed: 1.1, run: 0.15, social: 0.25, gestures: 1.5, curiosity: 0.55, fight: { watch: 0.35, join: 0.03, flee: 0.5, defend: 0.2 }, space: 1.0, stayMin: [4, 14], temper: 0.04 }),
  CURIOSO: P({ goals: { WANDER: 0.9, WATCH_EVENT: 0.9, SOCIALIZE: 0.6, JOIN_CROWD: 0.5, IDLE: 0.4, TRAVEL: 0.4 }, speed: 1.0, run: 0.12, social: 0.55, gestures: 3, curiosity: 1.0, fight: { watch: 0.85, join: 0.05, flee: 0.25, defend: 0.3 }, space: 0.95, stayMin: [6, 20], temper: 0.05 }),
  CONFRONTADOR: P({ goals: { WANDER: 0.8, JOIN_CROWD: 0.6, SOCIALIZE: 0.5, FOLLOW_SUPPORTERS: 0.5, WATCH_EVENT: 0.4 }, speed: 1.05, run: 0.25, social: 0.45, gestures: 4, curiosity: 0.6, fight: { watch: 0.5, join: 0.5, flee: 0.05, defend: 0.8 }, space: 0.8, stayMin: [6, 20], temper: 0.5 }),
  CAUTELOSO: P({ goals: { WANDER: 0.8, IDLE: 0.7, TRAVEL: 0.6, WATCH_EVENT: 0.35, SOCIALIZE: 0.4 }, speed: 0.92, run: 0.1, social: 0.4, gestures: 1.5, curiosity: 0.3, fight: { watch: 0.15, join: 0.0, flee: 0.9, defend: 0.08 }, space: 1.3, stayMin: [5, 16], temper: 0.0 }),
};

/** aceita objetivo PROPOSTO pelo diretor? afinidade da personalidade × peso do pedido, contra o compromisso atual */
export function proposalAffinity(p: Personality, kind: GoalKind): number {
  const pr = PROFILES[p];
  if (kind === 'JOIN_FIGHT') return pr.fight.join;
  if (kind === 'WATCH_FIGHT') return pr.fight.watch;
  if (kind === 'AVOID_FIGHT' || kind === 'LEAVE_AREA') return Math.max(pr.fight.flee, 0.3);
  return Math.min(1.5, (pr.goals[kind] ?? 0.1) + 0.15);
}
