/**
 * EVENTOS DE GAMEPLAY (rodada 9) — CONTRATO entre os sistemas que ACONTECEM (movimento, ações sociais, veículos,
 * confronto, eventos, corridas, debate) e os que REAGEM (missões, conquistas, XP, telemetria). Emitidos SÓ pelo
 * servidor, a partir do estado autoritativo (nunca de um contador enviado pelo cliente) — server/src/gameplay/bus.ts.
 *
 * Objetivos de missão/conquista (src/progression/types.ts) referenciam `type` + filtro sobre os campos abaixo.
 * Anti-farm: nada aqui é "golpe acertado em jogador" com valor de XP; o confronto entra por participação/conclusão.
 */
export type GameplayEvent =
  /** entrou numa zona (ZoneTracker do servidor, com histerese) */
  | { type: 'zone_enter'; zone: string }
  /** distância percorrida (agregada pelo servidor a partir de movimentos ACEITOS), em lotes de ≥ 10 m */
  | { type: 'distance'; mode: 'foot' | 'bicycle' | 'scooter' | 'car' | 'moto'; meters: number }
  /** ação social concluída/iniciada (src/social/actions.ts key) */
  | { type: 'action'; key: string; category: string }
  /** pegou item (src/social/props.ts kind) */
  | { type: 'prop'; kind: string }
  /** entrou num veículo (kind) / subiu no trio */
  | { type: 'vehicle_enter'; kind: string }
  | { type: 'trio_board' }
  /** ficou ≥ N s dentro do anel de uma concentração (RallyPoint kind) */
  | { type: 'rally_visit'; kind: string }
  /** confronto: ação executada (sem alvo), esquiva bem-sucedida, boneco de treino derrubado */
  | { type: 'combat_action'; key: string }
  | { type: 'combat_dodge' }
  | { type: 'dummy_knockdown' }
  /** eventos agendados (src/events/types.ts ScheduledEventDef) */
  | { type: 'event_join'; eventId: string; format: string }
  | { type: 'event_complete'; eventId: string; format: string }
  /** corrida concluída (posição 1..n; dnf não emite) */
  | { type: 'race_finish'; raceId: string; vehicle: string; rank: number; timeMs: number }
  /** debate: assistiu N s, falou um turno, reagiu */
  | { type: 'debate_watch'; seconds: number }
  | { type: 'debate_turn' }
  | { type: 'debate_react' }
  /** pichação aceita, chat enviado (só telemetria/conquistas leves — sem XP por quantidade) */
  | { type: 'graffiti' }
  | { type: 'chat' };

export type GameplayEventType = GameplayEvent['type'];

/** quem gerou: conexão no mundo (o serviço de progressão resolve a conta; o cliente nunca vê userId) */
export interface GameplayEnvelope { sid: string; at: number; ev: GameplayEvent }
