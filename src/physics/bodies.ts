/**
 * Rodada 12 — CONTRATO de colisão entre corpos (docs/CROWD_COLLISION.md). Corpo humano = círculo no plano
 * horizontal (sem rigid body por pessoa); vizinhos por grade espacial; resolução de penetração progressiva (no máximo
 * `maxPushPerStep` por passo — nada de "explosão" em multidão) + desvio local suavizado para quem se move sozinho
 * (autônomos). Mesmo raio no cliente (predição) e no servidor (autoridade). Calibrado contra o alcance de combate:
 * dois corpos encostados ficam a 2 × radius = 0,64 m, bem dentro do soco (1,2 m) e do chute (1,5 m).
 */
export const BODY = {
  /** raio do corpo (m) */
  radius: 0.32,
  /** espaço pessoal (m, centro a centro) — autônomos desaceleram/desviam antes de encostar */
  personalSpace: 0.9,
  /** quanto a resolução empurra por passo (m) — progressiva, sem saltos */
  maxPushPerStep: 0.12,
  /** penetração tolerada antes do servidor corrigir um humano (m) — absorve latência/predição */
  serverTolerance: 0.18,
  /** raio de busca de vizinhos (m) */
  queryRadius: 2.0,
} as const;

/** um corpo para a resolução (id estável; `fixed` = não é empurrado: caído, montado em veículo parado, etc.) */
export interface BodyRef { id: string; x: number; z: number; r: number; fixed?: boolean }

/** consulta de vizinhos (implementada por grade espacial no servidor e no cliente) */
export interface BodyIndex {
  near(x: number, z: number, r: number, out: BodyRef[]): BodyRef[];
}
