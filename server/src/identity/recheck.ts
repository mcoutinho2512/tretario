/**
 * Reavaliação periódica das identidades conectadas (rodada 8). A CLI do operador grava no banco (suspensão,
 * banimento, revogação de acesso) em OUTRO processo; a sala relê, a cada IDENTITY_RECHECK_MS, a conta de quem está
 * conectado e aplica:
 *   - conta banida/apagada            → desconecta (código 4003)
 *   - jogador que perdeu world.play   → desconecta com 4002: o cliente pede ticket novo e volta como espectador
 *   - outra mudança (ex.: espectador suspenso) → atualiza o estado no lugar (gate() já passa a negar)
 * Simples e sem canal entre processos; custo: 2 consultas por conta conectada por ciclo.
 */
import type { AccessGrant } from '../../../src/identity/types';
import { bestGrant, can, deriveAccessState } from '../../../src/access/policy';
import type { Services } from '../services';
import type { ConnectionIdentity } from './resolve';

export const IDENTITY_RECHECK_MS = Number(process.env.PV_IDENTITY_RECHECK_MS ?? 15_000);
export const CLOSE_DOWNGRADED = 4002;
export const CLOSE_BANNED = 4003;

export interface RecheckAction { sessionId: string; kind: 'update' | 'downgrade' | 'kick'; identity: ConnectionIdentity }

export async function recheckIdentities(s: Services, identities: ReadonlyMap<string, ConnectionIdentity>, eventId: string, now = Date.now()): Promise<RecheckAction[]> {
  const out: RecheckAction[] = [];
  const byUser = new Map<string, { state: ConnectionIdentity['state']; grant: AccessGrant } | null>();
  for (const [sessionId, id] of identities) {
    if (!id.userId || id.test) continue;
    if (!byUser.has(id.userId)) {
      const user = await s.store.users.byId(id.userId);
      if (!user) byUser.set(id.userId, null);
      else {
        const grants: AccessGrant[] = (await s.store.access.active(user.id, eventId, new Date(now))).map((g) => g.grant);
        byUser.set(id.userId, { state: deriveAccessState({ status: user.status, suspendedUntil: user.suspendedUntil, grants }, now), grant: bestGrant(grants) });
      }
    }
    const cur = byUser.get(id.userId);
    if (!cur || cur.state === 'BANNED') { out.push({ sessionId, kind: 'kick', identity: { ...id, state: 'BANNED' } }); continue; }
    if (cur.state === id.state && cur.grant === id.grant) continue;
    const next = { ...id, state: cur.state, grant: cur.grant };
    out.push({ sessionId, kind: id.role === 'player' && !can(cur.state, 'world.play', 'player') ? 'downgrade' : 'update', identity: next });
  }
  return out;
}
