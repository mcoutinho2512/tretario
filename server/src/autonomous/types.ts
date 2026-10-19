/**
 * Rodada 12 — CONTRATO dos PERSONAGENS AUTÔNOMOS (docs/AUTONOMOUS_CHARACTERS.md) e do mundo dinâmico
 * (docs/DYNAMIC_WORLD.md). Personagens do MUNDO, decididos pelo SERVIDOR (não são bots de carga nem contas humanas;
 * NetPlayer.kind = AUTONOMOUS). Sem LLM: personalidade = pesos de probabilidade; objetivos leves; memória curta;
 * frequências de decisão distribuídas (nunca "todos pensam no mesmo tick"); LOD de simulação pela distância ao humano
 * mais próximo. Usam os MESMOS sistemas dos jogadores: movimento com colisão (src/physics/bodies.ts), CombatSystem,
 * veículos/montagem, ações sociais e props.
 */
export type Personality = 'SOCIAL' | 'OBSERVADOR' | 'AGITADO' | 'TORCEDOR' | 'MANIFESTANTE' | 'EXPLORADOR' | 'CURIOSO' | 'CONFRONTADOR' | 'CAUTELOSO';

export type GoalKind =
  | 'WANDER' | 'MEET_GROUP' | 'FOLLOW_EVENT' | 'WATCH_EVENT' | 'JOIN_CROWD' | 'SOCIALIZE' | 'CHEER' | 'DANCE'
  | 'TRAVEL' | 'USE_VEHICLE' | 'WATCH_FIGHT' | 'AVOID_FIGHT' | 'JOIN_FIGHT' | 'LEAVE_AREA' | 'FOLLOW_SUPPORTERS' | 'IDLE';

/** nível de simulação (pela distância ao HUMANO mais próximo) */
export type SimLod = 'NEAR' | 'MID' | 'FAR' | 'DORMANT';

export interface Goal {
  kind: GoalKind;
  /** alvo: ponto, entidade (sessionId/id) ou evento dinâmico */
  x?: number; z?: number; target?: string; eventId?: string;
  /** quando expira (ms do servidor) — reavaliar depois */
  until: number;
  /** quem pediu: o próprio cérebro ou o diretor de eventos */
  source: 'self' | 'director';
}

/** memória curta (segundos a poucos minutos) — continuidade em vez de sorteio a cada decisão */
export interface ShortMemory {
  following?: string; groupId?: string; destination?: { x: number; z: number };
  threat?: { id: string; at: number }; fightSeen?: { x: number; z: number; at: number };
  lastGesture?: { act: number; at: number }; lastOpponent?: { id: string; at: number }; vehicle?: string;
}

/** visão de leitura do mundo para o DIRETOR de eventos dinâmicos (implementada pelo sistema de autônomos) */
export interface AutonomousWorldView {
  /** autônomos numa região (não aloca: reutiliza `out`) */
  near(x: number, z: number, r: number, out: { id: string; x: number; z: number; personality: Personality; sup: number; goal: GoalKind; group?: string }[]): number;
  /** humanos (para não deixar a avenida vazia perto deles) */
  humans(): Iterable<{ id: string; x: number; z: number }>;
  /** o diretor PROPÕE um objetivo; o cérebro aceita conforme a personalidade (não é script fixo) */
  propose(id: string, goal: Omit<Goal, 'source'>, weight: number): boolean;
  /** intensidade de confronto e de multidão ao redor de um ponto (para escalada e áudio) */
  heat(x: number, z: number, r: number): { combatants: number; crowd: number; hitsPerMin: number };
}

/** escalada de um foco (interna; não aparece literalmente para o jogador) */
export type Escalation = 'CALMO' | 'TENSAO' | 'CONFRONTO' | 'GENERALIZADO';

export type DynamicEventKind = 'CONCENTRACAO' | 'CAMINHADA' | 'MANIFESTACAO' | 'ENCONTRO_TORCIDAS' | 'DISCUSSAO' | 'BRIGA' | 'BRIGA_GENERALIZADA' | 'CORRIDA_IMPROVISADA' | 'FESTA';

export interface DynamicEventState {
  id: string; kind: DynamicEventKind; x: number; z: number; r: number;
  escalation: Escalation; startedAt: number; participants: number; watchers: number;
}
