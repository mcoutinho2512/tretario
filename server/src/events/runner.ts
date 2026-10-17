/**
 * RUNNER DE EVENTO AGENDADO (rodada 9) — CONTRATO entre o EventRuntime (agenda, estados, inscrição, graça de
 * reconexão: server/src/events/EventRuntime.ts) e a lógica de cada FORMATO (caminhada, corrida, confronto de grupos,
 * debate…). Sem Colyseus: o runtime fala com a sala por um `EventHost` (adaptador montado na sala) e o runner só vê
 * o `RunnerContext` da sua instância.
 *
 * Ciclo (relógio do servidor; src/events/schedule.ts):
 *   SCHEDULED → REGISTRATION → STARTING → ACTIVE → FINISHED   (ou CANCELLED: mínimo de inscritos não atingido)
 *   - `prepare` uma vez ao entrar em STARTING (grade de largada, palco…)
 *   - `start` uma vez ao entrar em ACTIVE; `tick` a cada tick da sala (10 Hz) enquanto STARTING/ACTIVE
 *   - `end` uma vez (FINISHED/CANCELLED). O runner pode encerrar antes chamando `ctx.finish()`
 *   - `onJoin`/`onLeave` para cada inscrição aceita/saída (a validação genérica — estado, capacidade, grupo — já foi
 *     feita pelo runtime; o runner pode negar com um motivo próprio, ex.: 'veiculo')
 *
 * Autoridade: participação, checkpoint, chegada e pontos são decididos AQUI a partir do estado do servidor (posição
 * aceita, veículo, grupo da identidade). O cliente nunca informa nada disso. Recompensa = `ctx.complete(sid)`
 * (participação/conclusão → GameplayEvent `event_complete`), nunca por golpe.
 *
 * Novo formato: implemente `EventRunner` e registre em server/src/events/runners.ts (`RUNNERS.set(format, () => …)`).
 */
import type { EventJoinDenial, EventState, ScheduledEventDef, WorldPoint } from '../../../src/events/schedule.ts';
import type { GameplayEvent } from '../../../src/gameplay/events.ts';
import type { CombatEventRules } from '../../../src/combat/policy.ts';

/** o que o runtime sabe de um jogador — montado pela sala a partir do estado AUTORITATIVO */
export interface ParticipantView {
  sid: string;
  name: string;
  x: number;
  z: number;
  /** tipo do veículo em uso (estado do servidor) ou null a pé */
  vehicleKind: string | null;
  /** chave do grupo no evento do mundo (só comparada por igualdade) */
  groupKey: string | null;
  /** NetPlayer.status (0 = normal) */
  status: number;
  /** em graça de reconexão (caiu, entidade congelada) */
  dropped: boolean;
  /** em cima de um trio */
  onPlatform: boolean;
}

/** adaptador da sala (Colyseus fica do lado de lá) */
export interface EventHost {
  /** jogador (com corpo) no mundo, ou null */
  participant(sid: string): ParticipantView | null;
  /** todos os jogadores com corpo (sessionIds) */
  players(): Iterable<string>;
  send(sid: string, type: string, msg: unknown): void;
  /** jogadores perto de um ponto (AOI do debate/espectadores) */
  near?(x: number, z: number, r: number, fn: (sid: string) => void): void;
  emit(sid: string, ev: GameplayEvent): void;
  zoneOf(sid: string): string | null;
  /** retorno (confronto): reposiciona quem está a pé; false se não pôde (veículo, trio…) */
  teleport?(sid: string, x: number, z: number): boolean;
  /** proteção de retorno até `untilMs` (a sala marca FX.PROTECTED) */
  protect?(sid: string, untilMs: number): void;
  log?(msg: string): void;
}

/** instância de um ScheduledEventDef (uma ocorrência da recorrência) */
export interface EventInstance {
  /** `${def.id}@${startsAt}` */
  inst: string;
  def: ScheduledEventDef;
  state: EventState;
  /** abre a inscrição · começa a contagem (STARTING) · começa (ACTIVE) · termina (ms, relógio do servidor) */
  opensAt: number;
  countdownAt: number;
  startsAt: number;
  endsAt: number;
  /** inscritos (sessionIds de humanos) */
  members: Set<string>;
  /** quem concluiu (event_complete já emitido) */
  completed: Set<string>;
  /** zona principal (agenda/minimapa) */
  zone: string;
}

export interface RunnerContext {
  readonly inst: EventInstance;
  readonly host: EventHost;
  /** eixo da avenida (WorldPoint {t, side}) */
  point(p: WorldPoint): { x: number; z: number };
  now(): number;
  /** participação concluída: emite `event_complete` (uma vez por inscrito) */
  complete(sid: string): void;
  /** encerra a instância antes do horário (todos chegaram, objetivo cumprido…) */
  finish(): void;
  /** mensagem para os inscritos (e quem acompanha) */
  sendMembers(type: string, msg: unknown): void;
  /** quem pediu para acompanhar (evt_watch: espectadores/jogadores não inscritos) */
  readonly watchers: ReadonlySet<string>;
}

/** concentração em movimento/fixa do evento: RallyPoint kind 'event' (cliente) e EnvRally (células do espectador) */
export interface EventRallyPoint {
  id: string;
  x: number;
  z: number;
  inner: number;
  radius: number;
  strength: number;
  /** NPCs de ambiente reservados para o ponto (ScheduledEventDef.npcCrowd) — sempre rotulados como simulados */
  crowd: number;
}

export interface EventRunner {
  readonly format: string;
  /** aceita inscrição depois do início (ACTIVE)? caminhada/confronto sim; corrida não */
  readonly lateJoin: boolean;
  prepare?(ctx: RunnerContext): void;
  start(ctx: RunnerContext): void;
  tick(ctx: RunnerContext, now: number, dtMs: number): void;
  end(ctx: RunnerContext, reason: 'finished' | 'cancelled'): void;
  /** null = aceita; motivo = nega (o runtime responde evt_res) */
  onJoin(ctx: RunnerContext, sid: string): EventJoinDenial | null;
  /** saiu (pedido, ou graça vencida = `forfeit`) */
  onLeave(ctx: RunnerContext, sid: string, forfeit: boolean): void;
  /** retrato do estado do runner (QA/clientes; pequeno) */
  state(ctx: RunnerContext): unknown;
  /** movimento ACEITO pelo servidor de um inscrito (posição final validada; `ok` false = houve correção) */
  onMove?(ctx: RunnerContext, sid: string, x: number, z: number, mode: string, ok: boolean, reason: string, now: number): void;
  /** concentrações do evento (caminhada: líder virtual andando) */
  rally?(ctx: RunnerContext): EventRallyPoint[];
  /** regras de confronto da instância ATIVA (confronto de grupos) */
  combat?(ctx: RunnerContext): CombatEventRules | null;
  /** derrubada entre inscritos (CombatSystem → runtime.onKnockdown) */
  onKnockdown?(ctx: RunnerContext, attacker: string, target: string): void;
  /** mensagens próprias do formato (ex.: debate `dbt_queue`/`dbt_say`/`dbt_react`) roteadas pela sala */
  onMessage?(ctx: RunnerContext, sid: string, type: string, msg: unknown): void;
  /** retrato para quem acaba de pedir para acompanhar (evt_watch) */
  watch?(ctx: RunnerContext, sid: string): void;
}

export type RunnerFactory = (def: ScheduledEventDef) => EventRunner;
