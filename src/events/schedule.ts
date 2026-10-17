/**
 * EVENTOS AGENDADOS (rodada 9) — CONTRATO. Estende o EventDef existente (src/events/types.ts): o evento do MUNDO
 * (ex.: manifestacao) ganha uma AGENDA de atividades dentro do mesmo mundo — caminhada, corrida, debate, confronto de
 * grupos… Mesmo modelo para todas (`format`); a lógica específica fica em um "runner" por formato no servidor
 * (server/src/events/), nunca em `if (evento === …)`.
 *
 * Agenda recorrente (mundo com poucos humanos também tem o que fazer): cada atividade repete a cada `everyMin`,
 * deslocada por `offsetMin`, no relógio do servidor. Estados: SCHEDULED → REGISTRATION → STARTING → ACTIVE →
 * FINISHED (ou CANCELLED, ex.: mínimo de inscritos não atingido). O servidor é a autoridade de estado e horário.
 */
import type { ZoneCombatPolicy } from '../combat/policy';
import type { Reward } from '../progression/types';
import type { EventFormat } from './types';

export type EventState = 'SCHEDULED' | 'REGISTRATION' | 'STARTING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';

/** taxonomia genérica de grupos (dados; nunca usada para dar vantagem) */
export type GroupKind = 'POLITICAL' | 'SUPPORTERS' | 'NEUTRAL' | 'CUSTOM';

export interface EventRecurrence {
  everyMin: number;
  offsetMin: number;
  /** abertura de inscrição antes do início (min); 0 = sem inscrição (entra quem chegar) */
  registrationMin: number;
  /** contagem regressiva STARTING (s) */
  startingS: number;
  durationMin: number;
}

/** regras de grupo do evento (só por chave e igualdade) */
export interface EventGroupRules {
  /** chaves de grupo que podem participar (ausente = todos, inclusive sem grupo) */
  allowed?: string[];
  /** confronto: grupo do mesmo lado sofre impacto? */
  friendlyFire?: boolean;
}

/** ponto no mundo: posição explícita ou fração do eixo da avenida (zones.ts pointOnAxis) */
export type WorldPoint = { x: number; z: number } | { t: number; side?: number };

export interface Checkpoint { id: string; at: WorldPoint; radius: number }

/** caminhada coletiva: rota com checkpoints; o "ponto de concentração" anda pela rota (RallyPoint kind 'event') */
export interface WalkSpec {
  route: Checkpoint[];
  /** velocidade do líder virtual (m/s) — a multidão acompanha; ninguém é obrigado a formação */
  paceMs: number;
  /** raio para contar como "acompanhando" (m) */
  followRadius: number;
}

/** corrida de veículo leve (MESMO runner para bicicleta e patinete) */
export interface RaceSpec {
  vehicle: 'bicycle' | 'scooter';
  checkpoints: Checkpoint[];
  laps: number;
  /** linha de largada (área) */
  start: Checkpoint;
  /** teto de tempo (s) para concluir */
  timeLimitS: number;
}

/** palco de debate em TEXTO */
export interface DebateSpec {
  /** id do eventSpot (manifest) do palco */
  stageSpot: string;
  turnSeconds: number;
  /** quantos turnos por debate e lugares no palco */
  turns: number;
  seats: number;
  /** reações por minuto por espectador (limite) */
  reactionsPerMin: number;
  /** temas neutros (texto); nenhuma frase atribuída a pessoa real */
  topics: string[];
}

/** confronto entre grupos (protótipo) */
export interface GroupClashSpec {
  /** zona(s) de confronto do evento; vira CombatEventRules para src/combat/policy.ts */
  zones: string[];
  /** retorno após ser derrubado: ponto de retorno por grupo-índice (0,1…) e proteção (ms) */
  respawn: WorldPoint[];
  protectMs: number;
  /** pontuação por objetivo: segurar uma área (s) e derrubadas no EVENTO (nunca XP por golpe) */
  holdArea?: Checkpoint;
  pointsPerKnockdown: number;
  pointsPerHoldSecond: number;
}

export interface ScheduledEventDef {
  id: string;
  format: EventFormat;
  name: string;
  description: string;
  zones: string[];
  recurrence: EventRecurrence;
  /** janela absoluta opcional (ISO) — fora dela não acontece */
  startAt?: string;
  endAt?: string;
  capacity: number;
  /** mínimo de inscritos (humanos) para não cancelar; 0 = acontece mesmo vazio (NPCs mantêm vivo) */
  minParticipants: number;
  groupRules?: EventGroupRules;
  /** política de confronto DURANTE o evento nas suas zonas (ausente = a da zona) */
  combatPolicy?: ZoneCombatPolicy;
  /** objetivos/recompensas de quem CONCLUI (participação) — entregues via GameplayEvent event_complete */
  rewards: Reward[];
  walk?: WalkSpec;
  race?: RaceSpec;
  debate?: DebateSpec;
  clash?: GroupClashSpec;
  /** NPCs de ambiente participam (caminhar, assistir, reagir) — nunca contados como jogadores */
  npcCrowd?: number;
}

/* ── protocolo ─────────────────────────────────────────────────────────────────────────────────────────────────── */

/** item da agenda (servidor → cliente). Horários no relógio comum (ms). `count` = humanos inscritos/presentes */
export interface AgendaEntry {
  id: string;
  /** id da instância (id + início) */
  inst: string;
  format: EventFormat;
  name: string;
  zone: string;
  state: EventState;
  startsAt: number;
  endsAt: number;
  count: number;
  capacity: number;
  /** o próprio está inscrito */
  joined?: boolean;
}
/** servidor → todos `agenda {now, next, recent}` ao entrar e quando muda (≤ 1 Hz, delta grosso) */
export interface AgendaMessage { list: AgendaEntry[] }
/** cliente → servidor `evt_join {inst}` / `evt_leave {inst}`; resposta `evt_res {inst, ok, r?}` */
export interface EventJoinRequest { inst: string }
export type EventJoinDenial = 'inexistente' | 'fechado' | 'lotado' | 'grupo' | 'veiculo' | 'ja_inscrito' | 'sem_permissao';

/** servidor → participantes `race {inst, cp, lap, rank, t}` (progresso decidido pelo servidor) */
export interface RaceProgress { inst: string; cp: number; lap: number; rank: number; total: number; t: number; finished?: boolean }
/** servidor → AOI/assistentes `dbt {…}`: estado do debate */
export interface DebateStateMessage {
  inst: string;
  topic: string;
  /** apelidos no palco e na fila (sem ids de conta) */
  speaker: string | null;
  turnEndsAt: number;
  queue: string[];
  reactions: { aplauso: number; positiva: number; negativa: number };
}
/** cliente → servidor: `dbt_queue {inst, on}`, `dbt_say {inst, text}`, `dbt_react {inst, r}` */
export type DebateReaction = 'aplauso' | 'positiva' | 'negativa';
