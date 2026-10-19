/**
 * PrismaDataStore (rodada 8): DataStore sobre PostgreSQL local com @prisma/client 7 + @prisma/adapter-pg.
 * Mesma semântica do MemoryDataStore (os mesmos testes de contrato rodam nos dois: `npm test` / `npm run test:db`).
 * Violação de unicidade chega como erro com `code: 'P2002'` (o Prisma já usa esse código; normalizamos o resto).
 * Registra-se em `storeFactories.prisma` ao ser importado (server/src/index.ts, ferramentas de operador).
 *
 * DATABASE_URL pode trazer `?schema=<nome>` (testes usam um schema próprio): repassado ao adaptador.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.ts';
import type {
  AccessRecord, AuditRecord, CodeRecord, MuteRecord, DataStore, EventGroupRecord, MembershipRecord, ModerationActionRecord, PaymentRecord,
  ProfileRecord, ProgressionRecord, ProgressionSave, ReportRecord, SessionRecord, SupporterRecord, UserRecord,
} from './types.ts';
import type { PlayerPreferences } from '../../../src/identity/types.ts';
import { storeFactories } from '../services.ts';

type Client = InstanceType<typeof PrismaClient>;

/** separa `?schema=` da URL (o driver pg não conhece esse parâmetro) */
export function parseDatabaseUrl(url: string): { connectionString: string; schema: string } {
  const u = new URL(url);
  const schema = u.searchParams.get('schema') || 'public';
  u.searchParams.delete('schema');
  return { connectionString: u.toString(), schema };
}

/** erros de unicidade sempre com code 'P2002' (igual ao MemoryDataStore) */
async function q<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = String((e as Error)?.message ?? '');
    if (code === 'P2002' || code === '23505' || /unique constraint/i.test(msg)) throw Object.assign(new Error('violação de unicidade'), { code: 'P2002', cause: e });
    throw e;
  }
}

const json = (x: unknown) => (x ?? {}) as Prisma.InputJsonValue;

export class PrismaDataStore implements DataStore {
  readonly kind = 'prisma' as const;
  readonly db: Client;

  constructor(url: string) {
    const { connectionString, schema } = parseDatabaseUrl(url);
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
  }

  async connect() { await this.db.$connect(); await this.db.$queryRawUnsafe('SELECT 1'); }

  users = {
    create: (d: { email: string; passwordHash: string }) => q(this.db.user.create({ data: d })) as Promise<UserRecord>,
    byId: (id: string) => this.db.user.findUnique({ where: { id } }) as Promise<UserRecord | null>,
    byEmail: (email: string) => this.db.user.findUnique({ where: { email } }) as Promise<UserRecord | null>,
    update: (id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>) => {
      const { updatedAt: _u, ...data } = patch;
      return q(this.db.user.update({ where: { id }, data })) as Promise<UserRecord>;
    },
  };

  private profile = (r: Awaited<ReturnType<Client['profile']['findUnique']>>): ProfileRecord | null =>
    r ? { ...r, preferences: (r.preferences ?? {}) as PlayerPreferences } : null;

  profiles = {
    create: async (d: { userId: string; nickname: string; nicknameKey: string }) => this.profile(await q(this.db.profile.create({ data: d })))!,
    byUserId: async (userId: string) => this.profile(await this.db.profile.findUnique({ where: { userId } })),
    byNicknameKey: async (key: string) => this.profile(await this.db.profile.findUnique({ where: { nicknameKey: key } })),
    update: async (userId: string, patch: Partial<Pick<ProfileRecord, 'nickname' | 'nicknameKey' | 'displayName' | 'preferences'>>) => {
      const { preferences, ...rest } = patch;
      return this.profile(await q(this.db.profile.update({ where: { userId }, data: { ...rest, ...(preferences !== undefined ? { preferences: json(preferences) } : {}) } })))!;
    },
  };

  /** rodada 10 — torcida: colunas novas (nullable) do Profile */
  supporters = {
    get: async (userId: string): Promise<SupporterRecord | null> => {
      const r = await this.db.profile.findUnique({ where: { userId }, select: { supporterGroup: true, supporterPending: true, supporterChangedAt: true } });
      return r ? { group: r.supporterGroup, pending: r.supporterPending, changedAt: r.supporterChangedAt } : null;
    },
    set: async (userId: string, rec: SupporterRecord) => {
      await q(this.db.profile.update({ where: { userId }, data: { supporterGroup: rec.group, supporterPending: rec.pending, supporterChangedAt: rec.changedAt } }));
    },
  };

  // rodada 11 — título equipado (Profile.titleKey, coluna nova NULLABLE)
  titles = {
    get: async (userId: string): Promise<string | null> => (await this.db.profile.findUnique({ where: { userId }, select: { titleKey: true } }))?.titleKey ?? null,
    set: async (userId: string, title: string | null) => {
      await q(this.db.profile.update({ where: { userId }, data: { titleKey: title } }));
    },
  };

  appearances = {
    get: async (userId: string) => {
      const r = await this.db.characterAppearance.findUnique({ where: { userId } });
      return r ? { data: r.data as unknown, version: r.version, updatedAt: r.updatedAt } : null;
    },
    put: async (userId: string, data: unknown) => {
      await this.db.characterAppearance.upsert({ where: { userId }, create: { userId, data: json(data) }, update: { data: json(data), version: { increment: 1 } } });
    },
  };

  sessions = {
    create: (d: { userId: string; tokenHash: string; expiresAt: Date; uaHash: string | null }) => q(this.db.session.create({ data: d })) as Promise<SessionRecord>,
    byTokenHash: (hash: string) => this.db.session.findUnique({ where: { tokenHash: hash } }) as Promise<SessionRecord | null>,
    touch: async (id: string, at: Date, expiresAt?: Date) => {
      await this.db.session.updateMany({ where: { id }, data: { lastSeenAt: at, ...(expiresAt ? { expiresAt } : {}) } });
    },
    revoke: async (id: string) => { await this.db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } }); },
    revokeAllForUser: async (userId: string) => (await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })).count,
    deleteExpired: async (expiredBefore: Date, revokedBefore: Date, limit: number) => {
      const ids = (await this.db.session.findMany({ where: { OR: [{ expiresAt: { lt: expiredBefore } }, { revokedAt: { lt: revokedBefore } }] }, select: { id: true }, take: limit })).map((r) => r.id);
      if (!ids.length) return 0;
      return (await this.db.session.deleteMany({ where: { id: { in: ids } } })).count;
    },
  };

  codes = {
    create: (d: { userId: string; purpose: CodeRecord['purpose']; codeHash: string; expiresAt: Date }) => this.db.verificationCode.create({ data: d }) as Promise<CodeRecord>,
    latest: (userId: string, purpose: CodeRecord['purpose']) =>
      this.db.verificationCode.findFirst({ where: { userId, purpose }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) as Promise<CodeRecord | null>,
    attempt: async (id: string) => {
      try { return (await this.db.verificationCode.update({ where: { id }, data: { attempts: { increment: 1 } } })).attempts; } catch { return 0; }
    },
    consume: async (id: string) => { await this.db.verificationCode.updateMany({ where: { id }, data: { consumedAt: new Date() } }); },
    deleteExpired: async (expiredBefore: Date, consumedBefore: Date, limit: number) => {
      // lote por ids (índice em expiresAt); deleteMany de ids já apagados por outra instância apaga 0 — idempotente
      const ids = (await this.db.verificationCode.findMany({ where: { OR: [{ expiresAt: { lt: expiredBefore } }, { consumedAt: { lt: consumedBefore } }] }, select: { id: true }, take: limit })).map((r) => r.id);
      if (!ids.length) return 0;
      return (await this.db.verificationCode.deleteMany({ where: { id: { in: ids } } })).count;
    },
  };

  mutes = {
    list: async (ownerUserId: string) => this.db.muteRelationship.findMany({ where: { ownerUserId }, orderBy: { createdAt: 'asc' } }) as Promise<MuteRecord[]>,
    add: async (ownerUserId: string, mutedUserId: string, mutedNicknameAtTime: string | null) => {
      await this.db.muteRelationship.upsert({ where: { ownerUserId_mutedUserId: { ownerUserId, mutedUserId } }, create: { ownerUserId, mutedUserId, mutedNicknameAtTime }, update: {} });
    },
    remove: async (ownerUserId: string, mutedUserId: string) => (await this.db.muteRelationship.deleteMany({ where: { ownerUserId, mutedUserId } })).count > 0,
  };

  access = {
    active: (userId: string, eventId: string | null, now: Date) =>
      this.db.accountAccess.findMany({
        where: {
          userId, revokedAt: null,
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ eventId: null }, ...(eventId !== null ? [{ eventId }] : [])] }],
        },
        orderBy: { createdAt: 'asc' },
      }) as Promise<AccessRecord[]>,
    grant: (d: { userId: string; grant: AccessRecord['grant']; eventId: string | null; source: string; expiresAt?: Date | null; paymentId?: string | null }) =>
      q(this.db.accountAccess.create({ data: { userId: d.userId, grant: d.grant, eventId: d.eventId, source: d.source, expiresAt: d.expiresAt ?? null, paymentId: d.paymentId ?? null } })) as Promise<AccessRecord>,
    revoke: async (id: string) => { await this.db.accountAccess.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } }); },
    list: (userId: string) => this.db.accountAccess.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }) as Promise<AccessRecord[]>,
  };

  payments = {
    create: (d: Omit<PaymentRecord, 'id' | 'createdAt' | 'updatedAt'>) => q(this.db.payment.create({ data: d })) as Promise<PaymentRecord>,
    byId: (id: string) => this.db.payment.findUnique({ where: { id } }) as Promise<PaymentRecord | null>,
    update: (id: string, patch: Partial<Pick<PaymentRecord, 'status' | 'providerRef'>>) => q(this.db.payment.update({ where: { id }, data: patch })) as Promise<PaymentRecord>,
  };

  events = {
    upsert: async (d: { id: string; name: string; groups: Omit<EventGroupRecord, 'eventId'>[] }) => {
      await this.db.event.upsert({ where: { id: d.id }, create: { id: d.id, name: d.name }, update: { name: d.name } });
      for (const g of d.groups) {
        const data = { key: g.key, name: g.name, designKey: g.designKey, neutral: g.neutral, sort: g.sort };
        await this.db.eventGroup.upsert({ where: { id: g.id }, create: { id: g.id, eventId: d.id, ...data }, update: data });
      }
    },
    groups: (eventId: string) => this.db.eventGroup.findMany({ where: { eventId }, orderBy: { sort: 'asc' } }) as Promise<EventGroupRecord[]>,
    membership: (userId: string, eventId: string) => this.db.eventMembership.findUnique({ where: { userId_eventId: { userId, eventId } } }) as Promise<MembershipRecord | null>,
    setMembership: async (userId: string, eventId: string, groupId: string) => {
      const g = await this.db.eventGroup.findUnique({ where: { id: groupId } });
      if (!g || g.eventId !== eventId) throw new Error('grupo inválido');
      return q(this.db.eventMembership.upsert({ where: { userId_eventId: { userId, eventId } }, create: { userId, eventId, groupId }, update: { groupId } })) as Promise<MembershipRecord>;
    },
    clearMembership: async (userId: string, eventId: string) => { await this.db.eventMembership.deleteMany({ where: { userId, eventId } }); },
  };

  private report = (r: Awaited<ReturnType<Client['report']['create']>>): ReportRecord => ({ ...r, evidence: (r.evidence ?? {}) as Record<string, unknown> }) as ReportRecord;

  reports = {
    create: async (d: Omit<ReportRecord, 'id' | 'createdAt' | 'reviewedAt' | 'status'>) => this.report(await this.db.report.create({ data: { ...d, evidence: json(d.evidence) } })),
    list: async (f: { status?: ReportRecord['status']; limit?: number } = {}) =>
      (await this.db.report.findMany({ where: f.status ? { status: f.status } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: f.limit ?? 100 })).map(this.report),
    setStatus: async (id: string, status: ReportRecord['status']) => { await this.db.report.updateMany({ where: { id }, data: { status, reviewedAt: new Date() } }); },
  };

  moderation = {
    create: (d: Omit<ModerationActionRecord, 'id' | 'createdAt'>) => this.db.moderationAction.create({ data: d }) as Promise<ModerationActionRecord>,
    forUser: (userId: string) => this.db.moderationAction.findMany({ where: { targetUserId: userId }, orderBy: { createdAt: 'asc' } }) as Promise<ModerationActionRecord[]>,
  };

  progression = {
    load: async (userId: string): Promise<ProgressionRecord | null> => {
      const [p, c, a, g] = await Promise.all([
        this.db.playerProgress.findUnique({ where: { userId } }),
        this.db.completedMission.findMany({ where: { userId }, orderBy: { completedAt: 'asc' } }),
        this.db.achievementUnlock.findMany({ where: { userId }, orderBy: { unlockedAt: 'asc' } }),
        this.db.rewardGrant.findMany({ where: { userId }, orderBy: { grantedAt: 'asc' } }),
      ]);
      if (!p && !c.length && !a.length && !g.length) return null;
      return {
        xp: p?.xp ?? 0, level: p?.level ?? 1, data: (p?.data ?? {}) as unknown, updatedAt: p?.updatedAt ?? new Date(0),
        completed: c.map((x) => ({ missionId: x.missionId, completedAt: x.completedAt })),
        achievements: a.map((x) => ({ achievementId: x.achievementId, unlockedAt: x.unlockedAt })),
        grants: g.map((x) => ({ item: x.item, source: x.source, grantedAt: x.grantedAt })),
      };
    },
    save: async (userId: string, d: ProgressionSave) => {
      // uma transação por lote: progresso + linhas novas; skipDuplicates respeita os pares únicos (sem recompensa dupla)
      await this.db.$transaction([
        this.db.playerProgress.upsert({ where: { userId }, create: { userId, xp: d.xp, level: d.level, data: json(d.data) }, update: { xp: d.xp, level: d.level, data: json(d.data) } }),
        ...(d.completed.length ? [this.db.completedMission.createMany({ data: d.completed.map((x) => ({ userId, missionId: x.missionId, completedAt: x.at })), skipDuplicates: true })] : []),
        ...(d.achievements.length ? [this.db.achievementUnlock.createMany({ data: d.achievements.map((x) => ({ userId, achievementId: x.achievementId, unlockedAt: x.at })), skipDuplicates: true })] : []),
        ...(d.grants.length ? [this.db.rewardGrant.createMany({ data: d.grants.map((x) => ({ userId, item: x.item, source: x.source, grantedAt: x.at })), skipDuplicates: true })] : []),
      ]);
    },
  };

  audit = {
    append: async (d: Omit<AuditRecord, 'id' | 'createdAt'>) => { await this.db.auditLog.create({ data: { ...d, meta: json(d.meta) } }); },
    list: async (limit = 100) =>
      (await this.db.auditLog.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit })).map((r) => ({ ...r, meta: (r.meta ?? {}) as Record<string, unknown> })),
  };

  async close() { await this.db.$disconnect(); }
  async ping() { await this.db.$queryRawUnsafe('SELECT 1'); }
}

export async function createPrismaStore(url = process.env.DATABASE_URL ?? ''): Promise<PrismaDataStore> {
  const s = new PrismaDataStore(url);
  await s.connect();
  return s;
}

storeFactories.prisma = () => createPrismaStore();
