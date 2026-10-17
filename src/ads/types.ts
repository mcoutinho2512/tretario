/**
 * ESPAÇOS DE TELÃO/PAINEL (rodada 9) — FUNDAÇÃO, sem venda. Dados em `public/gameplay/adslots.json`. Um slot aponta
 * para uma superfície que JÁ existe: painel de LED de fachada (src/events/Billboards.ts, manifest.billboards) ou telão
 * de evento (src/events/screenFeed.ts, manifest.eventSpots kind 'screen'/'stage', trio).
 *
 * Nesta rodada só conteúdo INTERNO (agenda, eventos, missões, avisos, arte do jogo/campanhas cadastradas). Nenhum
 * upload público, nenhum vídeo de usuário, nenhuma cobrança.
 */
export type AdFormat = 'IMAGE' | 'VIDEO' | 'CAMPAIGN' | 'EVENT' | 'SYSTEM';
export type AdSurface = 'billboard' | 'screen';

export interface AdSlotDefinition {
  /** ex.: CENTRAL_SCREEN_01, CANDELARIA_SCREEN_01, TRIO_SIDE_01, STAGE_SCREEN_01 */
  id: string;
  surface: AdSurface;
  /** id da superfície (BillboardSlot.id, eventSpot id, 'trio0') */
  target: string;
  zone: string;
  /** formatos que o slot aceitará no futuro; nesta rodada só os internos são servidos */
  formats: AdFormat[];
  /** rotação (s) */
  rotateSeconds: number;
}

/** conteúdo interno de um slot (gerado pelo jogo, nunca enviado por usuário) */
export type AdContent =
  | { kind: 'SYSTEM'; text: string; sub?: string }
  /** rodada 9 (aditivo): instantâneo do item da agenda para o telão desenhar sem depender da agenda do cliente */
  | { kind: 'EVENT'; inst: string; name?: string; format?: string; zone?: string; state?: import('../events/schedule').EventState; startsAt?: number; count?: number; capacity?: number }
  | { kind: 'CAMPAIGN'; designKey: string }
  | { kind: 'IMAGE'; url: string };
