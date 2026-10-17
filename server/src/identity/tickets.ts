/**
 * Tickets de entrada na sala (rodada 8): o navegador autenticado (cookie HttpOnly) pede POST /api/session/ticket e
 * recebe um ticket ALEATÓRIO de uso único, válido por 60 s, que vai nas opções de entrada da sala. O servidor resolve
 * a identidade a partir dele — o WebSocket nunca carrega o cookie e o cliente nunca declara quem é ou o que pode.
 */
import { randomBytes } from 'node:crypto';

export interface TicketPayload { userId: string; authSessionId: string; role: 'player' | 'spectator' }

const TTL_MS = 60_000;

export class TicketService {
  private tickets = new Map<string, TicketPayload & { exp: number }>();

  issue(p: TicketPayload, now = Date.now()): string {
    if (this.tickets.size >= 1000) this.sweep(now);
    const t = randomBytes(24).toString('base64url');
    this.tickets.set(t, { ...p, exp: now + TTL_MS });
    return t;
  }

  /** consome (uso único); null se inexistente/expirado */
  consume(t: unknown, now = Date.now()): TicketPayload | null {
    if (typeof t !== 'string' || t.length > 64) return null;
    const p = this.tickets.get(t);
    this.tickets.delete(t);
    if (!p || p.exp < now) return null;
    return { userId: p.userId, authSessionId: p.authSessionId, role: p.role };
  }

  /** remove os vencidos (nunca consumidos) — CleanupService periódico; `issue` também chama acima de 1000. Devolve quantos */
  sweep(now = Date.now()): number {
    let n = 0;
    for (const [k, v] of this.tickets) if (v.exp < now) { this.tickets.delete(k); n++; }
    return n;
  }

  get size() { return this.tickets.size; }
}
