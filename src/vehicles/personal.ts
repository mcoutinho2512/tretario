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

// ---- rodada 12 (agente B) — acréscimos (docs/PERSONAL_VEHICLES.md)
/**
 * monta sozinho só quando a entrada (porta/lado) está a ≤ N m do avatar: a animação de montagem da rodada 10 anda até
 * a porta em ≤ 45 % do `enterMs` — mais longe que isso o corpo "deslizaria". Mais longe (carro na pista com o avatar
 * no meio de uma calçada larga) o veículo APARECE ali, destacado, e o jogador entra com E/clique (`mounted: false`).
 */
export const PERSONAL_AUTOMOUNT_MAX_M = 3.0;
/** prefixo dos ids de veículo pessoal (NetVehicle) — o dono está em `NetVehicle.owner` */
export const PERSONAL_ID_PREFIX = 'pveh_';
/** rótulos curtos da interface */
export const PERSONAL_LABEL: Record<PersonalKind, string> = { scooter: 'Patinete', bicycle: 'Bicicleta', moto: 'Moto', car: 'Carro' };
export const isPersonalKind = (k: unknown): k is PersonalKind => typeof k === 'string' && (PERSONAL_KINDS as readonly string[]).includes(k);
/** texto curto da recusa (HUD) */
export const PERSONAL_DENY_TEXT: Record<PersonalDenyReason, string> = {
  tipo: 'Veículo indisponível', taxa: 'Devagar — espere um instante para pedir outro veículo', estado: 'Agora não dá: desça do veículo/trio primeiro',
  sem_lugar: 'Sem lugar seguro aqui para o veículo — ande um pouco (carro e moto só na pista)', espectador: 'Espectador não usa veículo',
  evento: 'Este evento não permite esse veículo', caido: 'Levante-se primeiro',
};
