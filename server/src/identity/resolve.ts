/**
 * Identidade de uma conexão (rodada 8), resolvida PELO SERVIDOR na entrada da sala:
 *  - com ticket válido → conta do banco: estado de acesso (src/access/policy.ts), papel efetivo, apelido, grupo
 *  - sem ticket → visitante ESPECTADOR (em servidor de teste PV_TEST=1: jogador anônimo para bots/QA)
 * O pedido de papel do cliente só pode rebaixar (PLAYER pode assistir; ninguém sobe a PLAYER pelo cliente).
 */
import type { AccessGrant, IdentityJoinOptions, PlayerIdentity } from '../../../src/identity/types';
import { bestGrant, deriveAccessState, resolveRole } from '../../../src/access/policy';
import { sanitizeName } from '../../../src/net/protocol';
import type { Services } from '../services';
import { anonPlayersAllowed } from '../services';

export class JoinRefused extends Error {
  constructor(readonly reason: 'ticket_invalido' | 'banido' | 'conta_inexistente') { super(reason); }
}

export interface ConnectionIdentity extends PlayerIdentity {
  /** entrada anônima de servidor de TESTE (bots/QA) */
  test: boolean;
}

export async function resolveIdentity(s: Services, o: (IdentityJoinOptions & { name?: unknown }) | undefined, eventId: string, now = Date.now()): Promise<ConnectionIdentity> {
  if (o?.ticket !== undefined) {
    const t = s.tickets.consume(o.ticket, now);
    if (!t) throw new JoinRefused('ticket_invalido');
    const user = await s.store.users.byId(t.userId);
    if (!user) throw new JoinRefused('conta_inexistente');
    const grants: AccessGrant[] = (await s.store.access.active(user.id, eventId, new Date(now))).map((g) => g.grant);
    const state = deriveAccessState({ status: user.status, suspendedUntil: user.suspendedUntil, grants }, now);
    const role = resolveRole(state, o.role ?? t.role);
    if (!role) throw new JoinRefused('banido');
    const profile = await s.store.profiles.byUserId(user.id);
    const mem = await s.store.events.membership(user.id, eventId);
    return {
      userId: user.id, authSessionId: t.authSessionId, nickname: profile?.nickname ?? 'Visitante', state, grant: bestGrant(grants), role,
      groupKey: mem ? mem.groupId.slice(mem.groupId.indexOf(':') + 1) : null, test: false,
    };
  }
  if (anonPlayersAllowed() && o?.role !== 'spectator') {
    return { userId: null, authSessionId: null, nickname: sanitizeName(o?.name), state: 'PLAYER', grant: 'NONE', role: 'player', groupKey: null, test: true };
  }
  return { userId: null, authSessionId: null, nickname: 'Espectador', state: 'VISITOR', grant: 'NONE', role: 'spectator', groupKey: null, test: false };
}
