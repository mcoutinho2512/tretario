/**
 * Rodada 12 — contagem PÚBLICA de pessoas vistas por este cliente (puro). Só HUMANOS: autônomos (kind 1) e bots de
 * carga (kind 2) nunca somam; na multidão distante, quem vem marcado como não humano (bit 6 da mensagem "crowd")
 * também não. Ausente = humano (servidor antigo). A home/telões/espectador usam isto ou as métricas do servidor
 * (server/src/presence: só clientes humanos — autônomos não são clientes).
 */
import { isHuman } from '../world/entityKind';

export function countHumans(remoteKinds: Iterable<number | undefined>, farNpc: Iterable<boolean | undefined>, includeSelf: boolean): number {
  let n = includeSelf ? 1 : 0;
  for (const k of remoteKinds) if (isHuman(k)) n++;
  for (const f of farNpc) if (!f) n++;
  return n;
}
