/**
 * Provedores de autenticação (rodada 8). Hoje só e-mail + senha (EmailPasswordProvider). Login social (Google) fica
 * PREPARADO como interface: sem implementação falsa, sem credencial. Quando entrar, precisa de uma migration nova
 * (ex.: tabela ExternalIdentity { provider, subject, userId }) e de um fluxo OAuth com state/PKCE — ver docs/AUTH.md.
 */
import type { DataStore, UserRecord } from '../data/types';
import { burnPasswordTime, DEFAULT_SCRYPT, hashPassword, needsRehash, verifyPassword, type ScryptParams } from './password';

export type AuthProviderId = 'email' | 'google';

export interface AuthProvider {
  readonly id: AuthProviderId;
}

/** e-mail normalizado (minúsculas, sem espaços) ou null se inválido */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export class EmailPasswordProvider implements AuthProvider {
  readonly id = 'email' as const;
  constructor(private store: DataStore, private scrypt: ScryptParams = DEFAULT_SCRYPT) {}

  hash(pw: string) { return hashPassword(pw, this.scrypt); }

  /** confere e-mail + senha; refaz o hash se os parâmetros mudaram. Mesmo custo com ou sem conta. */
  async authenticate(email: string, password: string): Promise<UserRecord | null> {
    const user = await this.store.users.byEmail(email);
    if (!user) { await burnPasswordTime(password, this.scrypt); return null; }
    if (!(await verifyPassword(password, user.passwordHash))) return null;
    if (needsRehash(user.passwordHash, this.scrypt)) {
      return this.store.users.update(user.id, { passwordHash: await this.hash(password) });
    }
    return user;
  }
}

/**
 * Login social (FUTURO — não implementado nesta rodada). Contrato esperado de um provedor OAuth/OIDC:
 * gerar a URL de autorização com `state` + PKCE e trocar o `code` por uma identidade VERIFICADA pelo provedor.
 */
export interface OAuthIdentity { provider: Exclude<AuthProviderId, 'email'>; subject: string; email: string | null; emailVerified: boolean }
export interface OAuthProvider extends AuthProvider {
  readonly id: Exclude<AuthProviderId, 'email'>;
  authorizationUrl(o: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(o: { code: string; codeVerifier: string; redirectUri: string }): Promise<OAuthIdentity>;
}
