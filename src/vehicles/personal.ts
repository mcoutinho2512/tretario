/**
 * Rodada 12 — CONTRATO: VEÍCULO PESSOAL (docs/PERSONAL_VEHICLES.md). "Selecionou → aparece": o cliente PEDE um tipo;
 * o SERVIDOR escolhe um ponto seguro PRÓXIMO, cria o veículo (o MESMO NetVehicle/VehicleSystem — sem sistema paralelo),
 * marca o dono e, quando seguro, já monta o jogador. Um veículo pessoal ativo por jogador; trocar de tipo remove o
 * anterior; sair/abandonar/desconectar → some depois do prazo. Rate limit no servidor.
 */
export type PersonalKind = 'scooter' | 'bicycle' | 'moto' | 'car';
export const PERSONAL_KINDS: readonly PersonalKind[] = ['scooter', 'bicycle', 'moto', 'car'];

/** mensagens: cliente → `pveh_req`; servidor → `pveh_ok` | `pveh_denied` */
export interface PersonalVehicleRequest { kind: PersonalKind; seq?: number }
export interface PersonalVehicleOk { id: string; kind: PersonalKind; x: number; z: number; heading: number; mounted: boolean; replaced?: string }
export type PersonalDenyReason = 'tipo' | 'taxa' | 'estado' | 'sem_lugar' | 'espectador' | 'evento' | 'caido';
export interface PersonalVehicleDenied { kind: string; reason: PersonalDenyReason }

export const PERSONAL_RULES = {
  /** um veículo pessoal ativo por jogador (o pedido de outro tipo substitui) */
  maxActivePerPlayer: 1,
  /** intervalo mínimo entre pedidos aceitos (ms) */
  minIntervalMs: 2500,
  /** pedidos recusados por taxa a partir de N em 10 s */
  burstPer10s: 4,
  /** sem dono a bordo por este tempo → some (ms) */
  despawnIdleMs: 45_000,
  /** distância-alvo do ponto de surgimento ao avatar (m) */
  spawnDist: { scooter: 0.9, bicycle: 1.1, moto: 1.6, car: 3.2 } as Record<PersonalKind, number>,
  /** distância máxima aceitável antes de recusar com 'sem_lugar' (m) */
  spawnMaxDist: { scooter: 4, bicycle: 4, moto: 6, car: 14 } as Record<PersonalKind, number>,
  /** monta sozinho ao surgir */
  autoMount: { scooter: true, bicycle: true, moto: true, car: true } as Record<PersonalKind, boolean>,
} as const;
