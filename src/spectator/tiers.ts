/**
 * Espectador AÉREO (rodada 8.1) — CONTRATO das camadas de representação. Quanto mais alto/longe, menos detalhe POR
 * pessoa e mais dado AGREGADO por célula; nunca as 500 entidades completas para quem está no alto.
 *
 *   NEAR       pessoas completas (StateView normal, mesmo AOI de jogador) — câmera baixa
 *   MID        AOI encolhido em volta do foco + multidão "crowd" compacta (mesma mensagem v2)
 *   FAR        só CÉLULAS agregadas perto do foco + AOI mínimo
 *   AGGREGATE  só CÉLULAS agregadas da avenida inteira (Central → Candelária)
 *
 * O servidor escolhe a camada pela altitude que o cliente informa (spec_cam {x, z, alt}), com histerese, e envia
 * `spec_cells` (CrowdCellSnapshot[]) só para espectadores em FAR/AGGREGATE. Jogador normal: NADA muda (nem banda).
 * Snapshots são DETERMINÍSTICOS: mesma entrada → mesmo snapshot (contagem, distribuições, seed) para todos os
 * espectadores; o cliente desenha impostores/instâncias com o `seed` da célula, então dois espectadores veem o mesmo.
 * Jogadores reais e multidão de ambiente (environmentCrowd) são contados SEPARADAMENTE.
 */
export type SpecTier = 'NEAR' | 'MID' | 'FAR' | 'AGGREGATE';
export const SPEC_TIERS: readonly SpecTier[] = ['NEAR', 'MID', 'FAR', 'AGGREGATE'];

/** limites de altitude (m acima do foco) para SUBIR de camada; descer exige `hysteresis` a menos */
export const SPEC_TIER_ALT = { MID: 45, FAR: 110, AGGREGATE: 200, hysteresis: 12 } as const;
/** raio do AOI de entidades por camada (m); 0 = nenhuma entidade */
export const SPEC_TIER_AOI = { NEAR: 220, MID: 140, FAR: 60, AGGREGATE: 0 } as const;

/** células agregadas: grade fixa alinhada à origem do mundo */
export const CROWD_CELL = {
  sizeM: 40,
  /** frequência de envio de `spec_cells` (Hz) */
  hz: 1,
  /** raio de células enviadas em FAR (m em volta do foco) */
  farRadiusM: 260,
  /** teto de banda de `spec_cells` por espectador (bytes/s) */
  maxBytesPerSec: 6_000,
} as const;

/** atividades agregadas (índices fixos) */
export const CELL_ACTIVITIES = ['parado', 'andando', 'acao', 'veiculo'] as const;

export interface CrowdCellSnapshot {
  /** índice inteiro da célula (floor(x/size), floor(z/size)) */
  cx: number; cz: number;
  /** jogadores REAIS na célula */
  players: number;
  /** multidão de ambiente (NPCs de concentração/pedestres estimados pelos dados do evento) */
  env: number;
  /** distribuição por grupo do evento (chave do EventGroup → contagem de jogadores); '' = sem grupo */
  groups: Record<string, number>;
  /** contagem por atividade, na ordem de CELL_ACTIVITIES (só jogadores) */
  activity: [number, number, number, number];
  /** pessoas/m² (players + env) */
  density: number;
  /** seed determinística da célula (hash de cx, cz, época do evento) — layout de impostores no cliente */
  seed: number;
  /** relógio comum do servidor (ms) da amostra */
  t: number;
}

/** servidor → cliente (`spec_cells`): células alteradas desde o último envio + remoções */
export interface SpecCellsMessage { tier: SpecTier; cells: CrowdCellSnapshot[]; removed?: [number, number][]; full?: boolean }

/** camada para uma altitude, a partir da atual (histerese) — pura */
export function tierForAltitude(alt: number, current: SpecTier): SpecTier {
  const h = SPEC_TIER_ALT.hysteresis;
  const up: SpecTier = alt >= SPEC_TIER_ALT.AGGREGATE ? 'AGGREGATE' : alt >= SPEC_TIER_ALT.FAR ? 'FAR' : alt >= SPEC_TIER_ALT.MID ? 'MID' : 'NEAR';
  const ci = SPEC_TIERS.indexOf(current), ui = SPEC_TIERS.indexOf(up);
  if (ui >= ci) return up;
  // descer: só abaixo do limite da camada atual menos a histerese
  const lim = current === 'AGGREGATE' ? SPEC_TIER_ALT.AGGREGATE : current === 'FAR' ? SPEC_TIER_ALT.FAR : SPEC_TIER_ALT.MID;
  if (alt >= lim - h) return current;
  return tierForAltitude(alt, SPEC_TIERS[ci - 1]);
}

/** seed determinística da célula */
export function cellSeed(cx: number, cz: number, epoch: number): number {
  let h = (Math.imul(cx | 0, 73856093) ^ Math.imul(cz | 0, 19349663) ^ Math.imul(epoch | 0, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
