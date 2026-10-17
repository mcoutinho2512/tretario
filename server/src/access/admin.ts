/**
 * Administração de acesso e moderação (rodada 8) — usada pela CLI do operador (server/tools/admin.ts) e pelos testes.
 * Não há botão no site que conceda acesso: a ÚNICA forma de virar PLAYER nesta rodada é uma concessão gravada aqui
 * (DEV_GRANTED) ou, no futuro, um pagamento confirmado (src/payments). Toda ação grava AuditLog (nunca senha, token
 * ou código) e, quando é sanção/concessão, ModerationAction.
 */
import type { AccessRecord, DataStore, ReportStatus, UserRecord } from '../data/types';

export class AdminError extends Error {
  constructor(readonly code: 'conta_inexistente' | 'argumento_invalido' | 'nada_a_fazer', msg?: string) { super(msg ?? code); }
}

export interface AdminCtx { store: DataStore; actor: string; now?: () => number }

async function userByEmail(store: DataStore, email: string): Promise<UserRecord> {
  const u = await store.users.byEmail(String(email ?? '').trim().toLowerCase());
  if (!u) throw new AdminError('conta_inexistente', `nenhuma conta com o e-mail ${email}`);
  return u;
}

async function record(c: AdminCtx, action: string, user: UserRecord | null, o: { reason?: string | null; meta?: Record<string, unknown>; targetType?: string; targetRef?: string; expiresAt?: Date | null; moderation?: boolean }) {
  if (o.moderation !== false) {
    await c.store.moderation.create({
      action, targetUserId: user?.id ?? null, targetType: o.targetType ?? (user ? 'USER' : null), targetRef: o.targetRef ?? null,
      reason: o.reason ?? null, actor: c.actor, expiresAt: o.expiresAt ?? null,
    });
  }
  await c.store.audit.append({ actor: c.actor, action, targetType: o.targetType ?? 'user', targetId: o.targetRef ?? user?.id ?? null, meta: { ...(o.reason ? { reason: o.reason } : {}), ...(o.meta ?? {}) } });
}

export async function grantAccess(c: AdminCtx, email: string, o: { eventId?: string | null; hours?: number | null } = {}): Promise<AccessRecord> {
  const u = await userByEmail(c.store, email);
  const now = c.now?.() ?? Date.now();
  const expiresAt = o.hours && o.hours > 0 ? new Date(now + o.hours * 3600_000) : null;
  const g = await c.store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: o.eventId ?? null, source: `cli:${c.actor}`, expiresAt });
  await record(c, 'GRANT_ACCESS', u, { meta: { grant: 'DEV_GRANTED', eventId: o.eventId ?? null, accessId: g.id }, expiresAt });
  return g;
}

/** revoga as concessões DEV_GRANTED ativas (do evento indicado, ou todas) */
export async function revokeAccess(c: AdminCtx, email: string, o: { eventId?: string | null } = {}): Promise<number> {
  const u = await userByEmail(c.store, email);
  const now = new Date(c.now?.() ?? Date.now());
  const list = (await c.store.access.list(u.id)).filter((a) => a.grant === 'DEV_GRANTED' && !a.revokedAt && (!a.expiresAt || a.expiresAt > now) && (o.eventId === undefined || o.eventId === null || a.eventId === o.eventId));
  for (const a of list) await c.store.access.revoke(a.id);
  await record(c, 'REVOKE_ACCESS', u, { meta: { revoked: list.length, eventId: o.eventId ?? null } });
  return list.length;
}

export async function suspend(c: AdminCtx, email: string, hours: number, reason: string): Promise<Date> {
  if (!(hours > 0)) throw new AdminError('argumento_invalido', '--hours=N precisa ser > 0');
  if (!reason?.trim()) throw new AdminError('argumento_invalido', '--reason=... é obrigatório');
  const u = await userByEmail(c.store, email);
  const until = new Date((c.now?.() ?? Date.now()) + hours * 3600_000);
  await c.store.users.update(u.id, { status: 'SUSPENDED', suspendedUntil: until });
  await record(c, 'SUSPEND', u, { reason, expiresAt: until, meta: { hours } });
  return until;
}

export async function unsuspend(c: AdminCtx, email: string): Promise<void> {
  const u = await userByEmail(c.store, email);
  if (u.status !== 'SUSPENDED') throw new AdminError('nada_a_fazer', 'conta não está suspensa');
  await c.store.users.update(u.id, { status: 'ACTIVE', suspendedUntil: null });
  await record(c, 'UNSUSPEND', u, {});
}

/** banimento: também derruba todas as sessões de login */
export async function ban(c: AdminCtx, email: string, reason: string): Promise<void> {
  if (!reason?.trim()) throw new AdminError('argumento_invalido', '--reason=... é obrigatório');
  const u = await userByEmail(c.store, email);
  await c.store.users.update(u.id, { status: 'BANNED', suspendedUntil: null });
  const n = await c.store.sessions.revokeAllForUser(u.id);
  await record(c, 'BAN', u, { reason, meta: { sessionsRevoked: n } });
}

export async function unban(c: AdminCtx, email: string): Promise<void> {
  const u = await userByEmail(c.store, email);
  if (u.status !== 'BANNED') throw new AdminError('nada_a_fazer', 'conta não está banida');
  await c.store.users.update(u.id, { status: 'ACTIVE' });
  await record(c, 'UNBAN', u, {});
}

export async function listReports(c: AdminCtx, status?: ReportStatus, limit = 50) {
  const list = await c.store.reports.list({ status, limit });
  await record(c, 'LIST_REPORTS', null, { moderation: false, targetType: 'report', meta: { status: status ?? null, count: list.length } });
  return list;
}

/** registra a remoção de um grafite (a remoção em si é feita pelo chamador: sala em execução ou arquivo local) */
export async function recordGraffitiRemoval(c: AdminCtx, id: number, reason: string | null, via: string): Promise<void> {
  await record(c, 'REMOVE_GRAFFITI', null, { targetType: 'GRAFFITI', targetRef: String(id), reason, meta: { via } });
}
