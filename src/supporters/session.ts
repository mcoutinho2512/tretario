/**
 * Rodada 10 — torcida de quem NÃO tem conta: só na memória desta aba (não persiste, não vai para o banco). Vai na
 * entrada da sala como opção `sup` (o servidor aplica a mesma política e responde pelo campo `NetPlayer.sup`).
 * `?sup=<id>` na URL (QA) define a escolha inicial.
 */
let local: string | null = (() => {
  try { return new URLSearchParams(location.search).get('sup'); } catch { return null; }
})();

export function localSupporter(): string | null { return local; }
export function setLocalSupporter(id: string | null) { local = id; }
/** opção de entrada na sala (só usada pelo servidor para sessões sem conta) */
export function supporterJoinOpt(): { sup?: string } { return local ? { sup: local } : {}; }
