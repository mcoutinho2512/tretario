/** DataStore em memória (testes unitários e servidores de teste). Mesma semântica do PrismaDataStore. */
import { randomUUID } from 'node:crypto';
import type {
  AccessRecord, AuditRecord, CodeRecord, DataStore, EventGroupRecord, MembershipRecord, ModerationActionRecord, PaymentRecord,
  ProfileRecord, ReportRecord, SessionRecord, UserRecord,
} from './types';

const clone = <T>(x: T): T => (x === null || x === undefined ? x : structuredClone(x));

export class MemoryDataStore implements DataStore {
  readonly kind = 'memory' as const;
  private u = new Map<string, UserRecord>();
  private p = new Map<string, ProfileRecord>();
  private ap = new Map<string, { data: unknown; version: number; updatedAt: Date }>();
  private s = new Map<string, SessionRecord>();
  private c = new Map<string, CodeRecord>();
  private a = new Map<string, AccessRecord>();
  private pay = new Map<string, PaymentRecord>();
  private ev = new Map<string, { id: string; name: string }>();
  private g = new Map<string, EventGroupRecord>();
  private m = new Map<string, MembershipRecord>();
  private r = new Map<string, ReportRecord>();
  private mod = new Map<string, ModerationActionRecord>();
  private log: AuditRecord[] = [];

  users = {
    create: async (d: { email: string; passwordHash: string }) => {
      if ([...this.u.values()].some((x) => x.email === d.email)) throw Object.assign(new Error('email em uso'), { code: 'P2002' });
      const now = new Date();
      const rec: UserRecord = { id: randomUUID(), email: d.email, emailVerified: false, passwordHash: d.passwordHash, status: 'ACTIVE', suspendedUntil: null, createdAt: now, updatedAt: now, lastLoginAt: null };
      this.u.set(rec.id, rec);
      return clone(rec);
    },
    byId: async (id: string) => clone(this.u.get(id) ?? null),
    byEmail: async (email: string) => clone([...this.u.values()].find((x) => x.email === email) ?? null),
    update: async (id: string, patch: Partial<UserRecord>) => {
      const rec = this.u.get(id);
      if (!rec) throw new Error('usuário inexistente');
      Object.assign(rec, patch, { updatedAt: new Date() });
      return clone(rec);
    },
  };

  profiles = {
    create: async (d: { userId: string; nickname: string; nicknameKey: string }) => {
      if ([...this.p.values()].some((x) => x.nicknameKey === d.nicknameKey)) throw Object.assign(new Error('apelido em uso'), { code: 'P2002' });
      const now = new Date();
      const rec: ProfileRecord = { ...d, displayName: null, preferences: {}, createdAt: now, updatedAt: now };
      this.p.set(d.userId, rec);
      return clone(rec);
    },
    byUserId: async (userId: string) => clone(this.p.get(userId) ?? null),
    byNicknameKey: async (key: string) => clone([...this.p.values()].find((x) => x.nicknameKey === key) ?? null),
    update: async (userId: string, patch: Partial<ProfileRecord>) => {
      const rec = this.p.get(userId);
      if (!rec) throw new Error('perfil inexistente');
      if (patch.nicknameKey && [...this.p.values()].some((x) => x.nicknameKey === patch.nicknameKey && x.userId !== userId)) throw Object.assign(new Error('apelido em uso'), { code: 'P2002' });
      Object.assign(rec, patch, { updatedAt: new Date() });
      return clone(rec);
    },
  };

  appearances = {
    get: async (userId: string) => clone(this.ap.get(userId) ?? null),
    put: async (userId: string, data: unknown) => {
      const cur = this.ap.get(userId);
      this.ap.set(userId, { data: clone(data), version: (cur?.version ?? 0) + 1, updatedAt: new Date() });
    },
  };

  sessions = {
    create: async (d: { userId: string; tokenHash: string; expiresAt: Date; uaHash: string | null }) => {
      const now = new Date();
      const rec: SessionRecord = { id: randomUUID(), ...d, createdAt: now, lastSeenAt: now, revokedAt: null };
      this.s.set(rec.id, rec);
      return clone(rec);
    },
    byTokenHash: async (hash: string) => clone([...this.s.values()].find((x) => x.tokenHash === hash) ?? null),
    touch: async (id: string, at: Date, expiresAt?: Date) => { const rec = this.s.get(id); if (rec) { rec.lastSeenAt = at; if (expiresAt) rec.expiresAt = expiresAt; } },
    revoke: async (id: string) => { const rec = this.s.get(id); if (rec) rec.revokedAt = new Date(); },
    revokeAllForUser: async (userId: string) => {
      let n = 0;
      for (const rec of this.s.values()) if (rec.userId === userId && !rec.revokedAt) { rec.revokedAt = new Date(); n++; }
      return n;
    },
  };

  codes = {
    create: async (d: { userId: string; purpose: CodeRecord['purpose']; codeHash: string; expiresAt: Date }) => {
      const rec: CodeRecord = { id: randomUUID(), ...d, attempts: 0, consumedAt: null, createdAt: new Date() };
      this.c.set(rec.id, rec);
      return clone(rec);
    },
    latest: async (userId: string, purpose: CodeRecord['purpose']) =>
      clone([...this.c.values()].filter((x) => x.userId === userId && x.purpose === purpose).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null),
    attempt: async (id: string) => { const rec = this.c.get(id); if (!rec) return 0; rec.attempts++; return rec.attempts; },
    consume: async (id: string) => { const rec = this.c.get(id); if (rec) rec.consumedAt = new Date(); },
  };

  access = {
    active: async (userId: string, eventId: string | null, now: Date) =>
      clone([...this.a.values()].filter((x) => x.userId === userId && !x.revokedAt && (!x.expiresAt || x.expiresAt > now) && (x.eventId === null || x.eventId === eventId))),
    grant: async (d: { userId: string; grant: AccessRecord['grant']; eventId: string | null; source: string; expiresAt?: Date | null; paymentId?: string | null }) => {
      const rec: AccessRecord = { id: randomUUID(), userId: d.userId, grant: d.grant, eventId: d.eventId, source: d.source, createdAt: new Date(), expiresAt: d.expiresAt ?? null, revokedAt: null, paymentId: d.paymentId ?? null };
      this.a.set(rec.id, rec);
      return clone(rec);
    },
    revoke: async (id: string) => { const rec = this.a.get(id); if (rec) rec.revokedAt = new Date(); },
    list: async (userId: string) => clone([...this.a.values()].filter((x) => x.userId === userId)),
  };

  payments = {
    create: async (d: Omit<PaymentRecord, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date();
      const rec: PaymentRecord = { id: randomUUID(), ...d, createdAt: now, updatedAt: now };
      this.pay.set(rec.id, rec);
      return clone(rec);
    },
    byId: async (id: string) => clone(this.pay.get(id) ?? null),
    update: async (id: string, patch: Partial<Pick<PaymentRecord, 'status' | 'providerRef'>>) => {
      const rec = this.pay.get(id);
      if (!rec) throw new Error('pagamento inexistente');
      Object.assign(rec, patch, { updatedAt: new Date() });
      return clone(rec);
    },
  };

  events = {
    upsert: async (d: { id: string; name: string; groups: Omit<EventGroupRecord, 'eventId'>[] }) => {
      this.ev.set(d.id, { id: d.id, name: d.name });
      for (const g of d.groups) this.g.set(g.id, { ...g, eventId: d.id });
    },
    groups: async (eventId: string) => clone([...this.g.values()].filter((x) => x.eventId === eventId).sort((a, b) => a.sort - b.sort)),
    membership: async (userId: string, eventId: string) => clone([...this.m.values()].find((x) => x.userId === userId && x.eventId === eventId) ?? null),
    setMembership: async (userId: string, eventId: string, groupId: string) => {
      if (!this.g.has(groupId) || this.g.get(groupId)!.eventId !== eventId) throw new Error('grupo inválido');
      const cur = [...this.m.values()].find((x) => x.userId === userId && x.eventId === eventId);
      const now = new Date();
      if (cur) { cur.groupId = groupId; cur.updatedAt = now; return clone(cur); }
      const rec: MembershipRecord = { id: randomUUID(), userId, eventId, groupId, createdAt: now, updatedAt: now };
      this.m.set(rec.id, rec);
      return clone(rec);
    },
    clearMembership: async (userId: string, eventId: string) => {
      for (const [k, x] of this.m) if (x.userId === userId && x.eventId === eventId) this.m.delete(k);
    },
  };

  reports = {
    create: async (d: Omit<ReportRecord, 'id' | 'createdAt' | 'reviewedAt' | 'status'>) => {
      const rec: ReportRecord = { id: randomUUID(), ...d, status: 'OPEN', createdAt: new Date(), reviewedAt: null };
      this.r.set(rec.id, rec);
      return clone(rec);
    },
    list: async (f: { status?: ReportRecord['status']; limit?: number } = {}) =>
      clone([...this.r.values()].filter((x) => !f.status || x.status === f.status).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, f.limit ?? 100)),
    setStatus: async (id: string, status: ReportRecord['status']) => { const rec = this.r.get(id); if (rec) { rec.status = status; rec.reviewedAt = new Date(); } },
  };

  moderation = {
    create: async (d: Omit<ModerationActionRecord, 'id' | 'createdAt'>) => {
      const rec: ModerationActionRecord = { id: randomUUID(), ...d, createdAt: new Date() };
      this.mod.set(rec.id, rec);
      return clone(rec);
    },
    forUser: async (userId: string) => clone([...this.mod.values()].filter((x) => x.targetUserId === userId)),
  };

  audit = {
    append: async (d: Omit<AuditRecord, 'id' | 'createdAt'>) => { this.log.push({ id: randomUUID(), ...clone(d), createdAt: new Date() }); },
    list: async (limit = 100) => clone(this.log.slice(-limit).reverse()),
  };

  async close() { /* nada */ }
}
