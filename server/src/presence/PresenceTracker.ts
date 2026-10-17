/**
 * Presença (rodada 8) — SÓ em memória, com batimento e prazo (TTL). Nunca gravada no banco por quadro/mensagem.
 *
 *   ONLINE      autenticada, ainda entrando no mundo
 *   PLAYING     jogador com entidade e conexão viva, com atividade recente
 *   SPECTATING  espectador com conexão viva, com atividade recente (câmera/ping)
 *   AWAY        conectado, mas sem atividade há mais de `awayMs` (ou sem batimento há mais de `ttlMs`)
 *   OFFLINE     conexão caída (em graça de reconexão) ou sem nenhuma sessão
 * Uma conta pode ter várias sessões (jogando numa aba, assistindo noutra): `byUser` devolve a mais "forte".
 */
import type { PresenceState, WorldRole } from '../../../src/identity/types';

export interface PresenceInfo {
  userId: string | null;
  role: WorldRole;
  /** bot de carga (só servidor de teste) — nunca contado como jogador */
  bot: boolean;
}

interface Entry extends PresenceInfo {
  sid: string;
  joinedAt: number;
  /** última entrada do usuário (movimento/ação/câmera) */
  lastActive: number;
  /** último sinal de vida da conexão (qualquer mensagem, ping) */
  lastSeen: number;
  connected: boolean;
  inWorld: boolean;
}

export const PRESENCE = { awayMs: 120_000, ttlMs: 45_000 } as const;

const RANK: Record<PresenceState, number> = { OFFLINE: 0, AWAY: 1, ONLINE: 2, SPECTATING: 3, PLAYING: 4 };

export interface PresenceCounts {
  /** jogadores humanos com entidade (inclui os em graça de reconexão: a entidade está no mundo) */
  players: number;
  spectators: number;
  bots: number;
  /** conexões abertas agora (sem as em graça) */
  connections: number;
  away: number;
}

export class PresenceTracker {
  private entries = new Map<string, Entry>();
  constructor(private o: { awayMs: number; ttlMs: number } = PRESENCE) {}

  /** autenticada (onAuth/onJoin): ainda ONLINE até entrar no mundo */
  join(sid: string, info: PresenceInfo, now: number) {
    this.entries.set(sid, { ...info, sid, joinedAt: now, lastActive: now, lastSeen: now, connected: true, inWorld: false });
  }
  /** spawn concluído (jogador com entidade ou espectador com câmera) */
  enterWorld(sid: string, now: number) { const e = this.entries.get(sid); if (e) { e.inWorld = true; e.lastActive = now; e.lastSeen = now; } }
  /** entrada do usuário: tira de AWAY */
  activity(sid: string, now: number) { const e = this.entries.get(sid); if (e) { e.lastActive = now; e.lastSeen = now; } }
  /** batimento (qualquer mensagem): mantém a conexão viva, não conta como atividade */
  heartbeat(sid: string, now: number) { const e = this.entries.get(sid); if (e) e.lastSeen = now; }
  drop(sid: string) { const e = this.entries.get(sid); if (e) e.connected = false; }
  resume(sid: string, now: number) { const e = this.entries.get(sid); if (e) { e.connected = true; e.lastSeen = now; e.lastActive = now; } }
  leave(sid: string) { this.entries.delete(sid); }
  has(sid: string) { return this.entries.has(sid); }
  info(sid: string): PresenceInfo | undefined { return this.entries.get(sid); }

  state(sid: string, now: number): PresenceState {
    const e = this.entries.get(sid);
    return e ? this.stateOf(e, now) : 'OFFLINE';
  }

  private stateOf(e: Entry, now: number): PresenceState {
    if (!e.connected) return 'OFFLINE';
    if (!e.inWorld) return 'ONLINE';
    if (now - e.lastSeen > this.o.ttlMs || now - e.lastActive > this.o.awayMs) return 'AWAY';
    return e.role === 'player' ? 'PLAYING' : 'SPECTATING';
  }

  /** presença de uma conta (a sessão mais forte); OFFLINE se nenhuma */
  byUser(userId: string, now: number): PresenceState {
    let best: PresenceState = 'OFFLINE';
    for (const e of this.entries.values()) if (e.userId === userId) { const s = this.stateOf(e, now); if (RANK[s] > RANK[best]) best = s; }
    return best;
  }

  /** sessões de uma conta com um papel (duplicidade de login) */
  sessionsOf(userId: string, role?: WorldRole): string[] {
    const out: string[] = [];
    for (const e of this.entries.values()) if (e.userId === userId && (!role || e.role === role)) out.push(e.sid);
    return out;
  }

  counts(now: number): PresenceCounts {
    const c: PresenceCounts = { players: 0, spectators: 0, bots: 0, connections: 0, away: 0 };
    for (const e of this.entries.values()) {
      if (e.connected) c.connections++;
      if (e.role === 'player') { if (e.bot) c.bots++; else c.players++; }
      else if (e.connected) c.spectators++;
      if (this.stateOf(e, now) === 'AWAY') c.away++;
    }
    return c;
  }
}
