/**
 * Endereço do servidor do jogo (rodada 9.1, deploy/CONTRACT.md).
 *  - PRODUÇÃO (build do Vite): MESMA ORIGEM — `wss://<host>/game` (ws:// se a página for http); o Nginx remove o
 *    prefixo /game e passa ao Colyseus (matchmaking HTTP e WebSocket pelo mesmo caminho). A API é `/api/...` relativa.
 *  - DESENVOLVIMENTO: `ws://<host>:2567` (a API vai pelo proxy do Vite). O ramo de dev some do bundle de produção
 *    (`import.meta.env.DEV` vira constante `false`) — nenhum `localhost`/porta fixa no build (npm run check:bundle).
 *  - QA: `?mp=ws://…` continua valendo em qualquer modo (main.ts / Game.ts).
 */
export const GAME_PATH = '/game';

/** endpoint de produção para a página em `protocol`//`host` (pura; tests/endpoint.test.ts) */
export function sameOriginEndpoint(protocol: string, host: string): string {
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}${GAME_PATH}`;
}

export function gameEndpoint(): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:2567`;
  return sameOriginEndpoint(location.protocol, location.host);
}
