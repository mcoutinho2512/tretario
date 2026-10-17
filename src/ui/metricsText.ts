/**
 * Texto das métricas públicas na tela inicial (rodada 8). Semântica: "jogadores" = pessoas com conta jogando;
 * a multidão de NPCs é SEMPRE rotulada como simulada; bots de teste nunca entram na conta de jogadores.
 */
import type { PublicMetrics } from '../identity/types';

const n = (v: number) => v.toLocaleString('pt-BR');

/** partes do texto (HTML seguro: só números e palavras fixas); null = métricas indisponíveis */
export function metricsLine(m: Partial<PublicMetrics> | null | undefined): string | null {
  if (!m || typeof m.playersOnline !== 'number' || !Number.isFinite(m.playersOnline)) return null;
  const p = Math.max(0, Math.floor(m.playersOnline));
  const parts = [p === 0 ? 'Nenhum jogador na avenida agora' : `<b>${n(p)}</b> ${p === 1 ? 'jogador' : 'jogadores'} na avenida`];
  const s = Math.max(0, Math.floor(m.spectatorsOnline ?? 0));
  if (s > 0) parts.push(`<b>${n(s)}</b> assistindo`);
  const crowd = Math.max(0, Math.floor(m.environmentCrowd ?? 0));
  if (crowd > 0) parts.push(`<span class="muted">multidão simulada ~${n(crowd)}</span>`);
  return parts.join(' <span class="sep">·</span> ');
}
