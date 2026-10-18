/**
 * Texto das métricas públicas na tela inicial (rodada 8). Semântica: "jogadores" = pessoas com conta jogando;
 * NPCs e bots de teste NUNCA entram na conta de jogadores (rodada 9.1: a multidão de NPCs não é mais citada na home).
 */
import type { PublicMetrics } from '../identity/types';

const n = (v: number) => v.toLocaleString('pt-BR');

/** partes do texto (HTML seguro: só números e palavras fixas); null = métricas indisponíveis */
export function metricsLine(m: Partial<PublicMetrics> | null | undefined): string | null {
  if (!m || typeof m.playersOnline !== 'number' || !Number.isFinite(m.playersOnline)) return null;
  const p = Math.max(0, Math.floor(m.playersOnline));
  // rodada 9.1 (dono): sem número e sem "Nenhum jogador" — com gente real diz que há jogadores; sem ninguém
  // diz só o que é verdade (a avenida está movimentada pela multidão) e nunca afirma jogadores que não existem
  const parts = [p === 0 ? 'Avenida movimentada agora <span class="sep">·</span> entre e junte-se' : 'Alguns jogadores na avenida'];
  const s = Math.max(0, Math.floor(m.spectatorsOnline ?? 0));
  if (s > 0) parts.push(`<b>${n(s)}</b> assistindo`);
  // rodada 9.1 (dono): a multidão de NPCs não é anunciada na home; o contador continua SÓ com pessoas reais
  return parts.join(' <span class="sep">·</span> ');
}
