/**
 * Reconexão (rodada 8) — regras PURAS compartilhadas por cliente e servidor (docs/SHARED_WORLD.md § Reconexão).
 *
 *   cliente   CONNECTED ─queda─▶ RECONNECTING ─voltou─▶ CONNECTED
 *                                     └─prazo/recusa─▶ EXPIRED ─nova entrada─▶ CONNECTED (entidade nova)
 *   servidor  CONNECTED ─queda─▶ DISCONNECTED_GRACE (entidade fica, congelada e marcada; nunca duplicada)
 *                                     ├─voltou (mesmo token)─▶ CONNECTED (mesma entidade, mesmo entityId)
 *                                     └─prazo─▶ EXPIRED (entidade removida; sem fantasma)
 * Sessão substituída (mesma conta em outra aba/aparelho) também leva a EXPIRED, sem reconexão automática.
 */
export type LinkState = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED_GRACE' | 'EXPIRED';
export type LinkEvent = 'drop' | 'reconnected' | 'expired' | 'replaced' | 'rejoined';

export const RECONNECT = {
  /** prazo de graça no servidor (s): a entidade espera a volta da MESMA conexão */
  graceS: 20,
  /** atraso base e máximo das tentativas do cliente (ms) — exponencial com jitter */
  baseDelayMs: 300,
  maxDelayMs: 4000,
  /** código de fechamento quando a sessão é substituída por outra da mesma conta (sem reconexão automática) */
  replacedCloseCode: 4020, // ≠ 4010 (MAY_TRY_RECONNECT do Colyseus, que o SDK trata como queda)
} as const;

/** valor de LinkState sincronizado em NetPlayer.link (0 conectado · 1 em graça) */
export const LINK_WIRE = { CONNECTED: 0, GRACE: 1 } as const;

/** transição; eventos inválidos para o estado mantêm o estado (idempotente) */
export function nextLink(side: 'client' | 'server', s: LinkState, e: LinkEvent): LinkState {
  if (s === 'EXPIRED') return e === 'rejoined' ? 'CONNECTED' : 'EXPIRED';
  if (e === 'replaced' || e === 'expired') return s === 'CONNECTED' && e === 'expired' ? 'CONNECTED' : 'EXPIRED';
  if (e === 'drop') return s === 'CONNECTED' ? (side === 'client' ? 'RECONNECTING' : 'DISCONNECTED_GRACE') : s;
  if (e === 'reconnected') return s === 'RECONNECTING' || s === 'DISCONNECTED_GRACE' ? 'CONNECTED' : s;
  return s;
}

/** máquina com relógio: `tick(now)` expira a graça vencida */
export class LinkMachine {
  state: LinkState = 'CONNECTED';
  since = 0;
  constructor(readonly side: 'client' | 'server', readonly graceMs = RECONNECT.graceS * 1000) {}
  apply(e: LinkEvent, now: number): LinkState {
    const n = nextLink(this.side, this.state, e);
    if (n !== this.state) { this.state = n; this.since = now; }
    return n;
  }
  /** em graça/reconectando além do prazo → EXPIRED */
  tick(now: number): LinkState {
    if ((this.state === 'RECONNECTING' || this.state === 'DISCONNECTED_GRACE') && now - this.since > this.graceMs) { this.state = 'EXPIRED'; this.since = now; }
    return this.state;
  }
  /** ms restantes de graça (0 fora dela) */
  remaining(now: number): number {
    return this.state === 'RECONNECTING' || this.state === 'DISCONNECTED_GRACE' ? Math.max(0, this.graceMs - (now - this.since)) : 0;
  }
}

/**
 * atraso da tentativa `attempt` (1, 2, …): exponencial limitado com jitter "igual" (metade fixa + metade aleatória),
 * para que milhares de clientes caídos juntos (queda do servidor/rede) não voltem todos no mesmo instante.
 */
export function backoffDelay(attempt: number, base: number = RECONNECT.baseDelayMs, max: number = RECONNECT.maxDelayMs, rnd: () => number = Math.random): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rnd() * (exp / 2));
}

/**
 * tentativas para cobrir TODO o prazo de graça mesmo com o jitter mínimo (metade do atraso) — o cliente só desiste
 * (e entra como entidade nova) depois que a graça do servidor certamente venceu: nunca coexistem a entidade em graça
 * e uma nova da mesma pessoa.
 */
export function retriesForGrace(graceMs: number = RECONNECT.graceS * 1000, base: number = RECONNECT.baseDelayMs, max: number = RECONNECT.maxDelayMs): number {
  let t = 0, n = 0;
  while (t < graceMs && n < 100) { n++; t += Math.min(max, base * 2 ** (n - 1)) / 2; }
  return n + 1;
}
