/**
 * Sessões de LOGIN (rodada 8): token aleatório de 32 bytes no cookie HttpOnly `pv_sid` (Secure em produção,
 * SameSite=Lax); o banco guarda só o SHA-256 do token — vazar a tabela não dá acesso a nenhuma conta.
 * Expiração DESLIZANTE de 30 dias, renovada no máximo a cada 10 min (não a cada requisição: evita uma escrita no
 * banco por chamada). Sem IP; só um hash curto do user-agent.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { DataStore, SessionRecord, UserRecord } from '../data/types';
import { cookie } from '../http/router';

export const SESSION_COOKIE = 'pv_sid';
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const SESSION_TOUCH_MS = 10 * 60_000;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const uaHash = (ua: unknown) => (typeof ua === 'string' && ua ? sha256(ua).slice(0, 16) : null);

export interface ActiveSession { session: SessionRecord; user: UserRecord; /** cookie renovado (expiração deslizante) */ refresh?: string }

export class SessionService {
  constructor(private store: DataStore, private now: () => number = Date.now) {}

  async create(userId: string, ua?: unknown): Promise<{ token: string; cookie: string; session: SessionRecord }> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.store.sessions.create({ userId, tokenHash: sha256(token), expiresAt: new Date(this.now() + SESSION_TTL_MS), uaHash: uaHash(ua) });
    return { token, session, cookie: cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000) };
  }

  /** sessão válida do cookie (não revogada, não expirada, conta existente) ou null */
  async resolve(cookies: Record<string, string>): Promise<ActiveSession | null> {
    const token = cookies[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const session = await this.store.sessions.byTokenHash(sha256(token));
    const now = this.now();
    if (!session || session.revokedAt || +session.expiresAt <= now) return null;
    const user = await this.store.users.byId(session.userId);
    if (!user) return null;
    if (now - +session.lastSeenAt >= SESSION_TOUCH_MS) {
      const exp = new Date(now + SESSION_TTL_MS);
      await this.store.sessions.touch(session.id, new Date(now), exp);
      session.lastSeenAt = new Date(now); session.expiresAt = exp;
      return { session, user, refresh: cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000) };
    }
    return { session, user };
  }

  async revoke(id: string) { await this.store.sessions.revoke(id); }

  /** apaga o cookie no navegador */
  clearCookie(): string { return cookie(SESSION_COOKIE, '', 0); }
}
