/**
 * Sessão de login nas rotas da API (rodada 8): lê o cookie HttpOnly, procura a sessão pelo HASH do token e devolve
 * conta + sessão (ou null). Interface pequena usada por perfil/eventos; o módulo de autenticação (login/cadastro)
 * cria o cookie com o MESMO nome e o mesmo hash (`hashToken`) — se ele mudar, só este arquivo muda.
 */
import type { ApiRequest } from './router';
import type { DataStore, SessionRecord, UserRecord } from '../data/types';
import type { AccessState } from '../../../src/identity/types';
import { deriveAccessState } from '../../../src/access/policy';

// cookie e hash são os do módulo de autenticação (server/src/auth/session.ts) — uma definição só
import { SESSION_COOKIE, sha256 } from '../auth/session';
export { SESSION_COOKIE };

/** hash do token de sessão guardado no banco (o token em claro só existe no cookie) */
export const hashToken = (token: string): string => sha256(token);

export interface AuthedUser {
  user: UserRecord;
  session: SessionRecord;
}

/** conta da sessão do cookie; null sem cookie, sessão inexistente/revogada/expirada ou conta banida */
export async function requireUser(req: Pick<ApiRequest, 'cookies'>, store: DataStore, now = new Date()): Promise<AuthedUser | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token || token.length > 256) return null;
  const session = await store.sessions.byTokenHash(hashToken(token));
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  const user = await store.users.byId(session.userId);
  if (!user || user.status === 'BANNED') return null;
  return { user, session };
}

/** estado de acesso da conta no evento (política central) */
export async function accessStateOf(store: DataStore, user: UserRecord, eventId: string | null, now = new Date()): Promise<AccessState> {
  const grants = (await store.access.active(user.id, eventId, now)).map((g) => g.grant);
  return deriveAccessState({ status: user.status, suspendedUntil: user.suspendedUntil, grants }, +now);
}
