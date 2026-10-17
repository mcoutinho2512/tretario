/**
 * Autorização CENTRAL (rodada 8). Toda decisão "pode fazer X?" passa por `can()` — no servidor (autoridade) e no
 * cliente (só para esconder botões). Nada de `isPaid`/`isAdmin` espalhado.
 *
 * Estado de acesso (AccessState) é DERIVADO de: existe conta? situação da conta (ativa/suspensa/banida)? há
 * concessão de licença ativa (DEV_GRANTED/PAID/STAFF)? — separado da concessão em si (AccountAccess).
 *   sem conta                       → VISITOR    (pode assistir e ler o chat geral)
 *   conta ativa, sem concessão      → REGISTERED (perfil/avatar/grupo; não entra jogando)
 *   conta ativa + concessão         → PLAYER
 *   conta suspensa (até a data)     → SUSPENDED  (pode assistir; não participa nem escreve)
 *   conta banida                    → BANNED     (não entra)
 */
import type { AccessGrant, AccessState, AccountStatus, WorldRole } from '../identity/types';

export type Capability =
  | 'world.spectate' | 'world.play'
  | 'chat.read' | 'chat.write'
  | 'graffiti.create' | 'report.create'
  | 'vehicle.use' | 'action.perform' | 'item.hold' | 'push'
  | 'profile.edit' | 'group.join';

export interface AccountFacts {
  status: AccountStatus;
  suspendedUntil?: Date | number | null;
  /** concessões ativas (não revogadas, não expiradas) */
  grants: AccessGrant[];
}

/** ordem de força: STAFF > PAID > DEV_GRANTED */
export function bestGrant(grants: readonly AccessGrant[]): AccessGrant {
  for (const g of ['STAFF', 'PAID', 'DEV_GRANTED'] as const) if (grants.includes(g)) return g;
  return 'NONE';
}

export function deriveAccessState(acc: AccountFacts | null, now = Date.now()): AccessState {
  if (!acc) return 'VISITOR';
  if (acc.status === 'BANNED') return 'BANNED';
  if (acc.status === 'SUSPENDED') {
    const until = acc.suspendedUntil == null ? Infinity : +acc.suspendedUntil;
    if (until > now) return 'SUSPENDED';
  }
  return bestGrant(acc.grants) === 'NONE' ? 'REGISTERED' : 'PLAYER';
}

/** capacidades por estado, sem papel (perfil/grupo/denúncia) */
const BY_STATE: Record<AccessState, readonly Capability[]> = {
  VISITOR: ['world.spectate', 'chat.read'],
  REGISTERED: ['world.spectate', 'chat.read', 'profile.edit', 'group.join', 'report.create'],
  PLAYER: ['world.spectate', 'world.play', 'chat.read', 'chat.write', 'profile.edit', 'group.join', 'report.create',
    'graffiti.create', 'vehicle.use', 'action.perform', 'item.hold', 'push'],
  SUSPENDED: ['world.spectate', 'chat.read', 'profile.edit'],
  BANNED: [],
};

/** capacidades que exigem ESTAR no mundo como jogador (espectador nunca tem, qualquer que seja a conta) */
const PLAYER_ROLE_ONLY: readonly Capability[] = ['world.play', 'graffiti.create', 'vehicle.use', 'action.perform', 'item.hold', 'push'];

/** pode? `role` = papel da conexão atual (um PLAYER assistindo como espectador não dirige) */
export function can(state: AccessState, cap: Capability, role?: WorldRole): boolean {
  if (!BY_STATE[state].includes(cap)) return false;
  if (role === 'spectator' && PLAYER_ROLE_ONLY.includes(cap)) return false;
  return true;
}

/** papel efetivo de uma conexão: o pedido do cliente só pode REBAIXAR (quem não é PLAYER sempre assiste) */
export function resolveRole(state: AccessState, requested: WorldRole | undefined): WorldRole | null {
  if (state === 'BANNED') return null;
  if (requested === 'spectator' || !can(state, 'world.play')) return can(state, 'world.spectate') ? 'spectator' : null;
  return 'player';
}
