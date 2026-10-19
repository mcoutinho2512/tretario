/**
 * Rodada 12 — CONTRATO: tipo de entidade (NetPlayer.kind). Três sistemas que NUNCA se misturam:
 *   HUMAN       usuário real conectado — o ÚNICO que entra em "jogadores online" e métricas de humanos
 *   AUTONOMOUS  personagem do mundo decidido pelo SERVIDOR (docs/AUTONOMOUS_CHARACTERS.md) — compartilhado por todos
 *   LOAD_BOT    ferramenta de benchmark (join `bot: true`, só servidor de teste)
 */
export const ENTITY_KIND = { HUMAN: 0, AUTONOMOUS: 1, LOAD_BOT: 2 } as const;
export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];
export const isHuman = (k: number | undefined) => (k ?? 0) === ENTITY_KIND.HUMAN;
