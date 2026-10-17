/**
 * Camada de dados — interface ÚNICA (rodada 8). O servidor só fala com o banco por aqui:
 *  - PrismaDataStore (PostgreSQL local, server/prisma/schema.prisma) — desenvolvimento/produção
 *  - MemoryDataStore — testes unitários e servidores de teste (PV_TEST=1 / PV_STORE=memory)
 * Registros espelham os modelos do schema.prisma. Nunca devolva estes registros a outros clientes: a API converte em
 * DTOs públicos (src/identity/types.ts).
 */
import type { AccessGrant, AccountStatus, PlayerPreferences } from '../../../src/identity/types';
import type { ReportCategory } from '../../../src/chat/protocol';

export interface UserRecord {
  id: string; email: string; emailVerified: boolean; passwordHash: string; status: AccountStatus;
  suspendedUntil: Date | null; createdAt: Date; updatedAt: Date; lastLoginAt: Date | null;
}
export interface ProfileRecord {
  userId: string; nickname: string; nicknameKey: string; displayName: string | null; preferences: PlayerPreferences;
  createdAt: Date; updatedAt: Date;
}
export interface SessionRecord {
  id: string; userId: string; tokenHash: string; createdAt: Date; expiresAt: Date; lastSeenAt: Date; revokedAt: Date | null; uaHash: string | null;
}
export type CodePurpose = 'EMAIL_VERIFY' | 'PASSWORD_RESET';
export interface CodeRecord {
  id: string; userId: string; purpose: CodePurpose; codeHash: string; expiresAt: Date; attempts: number; consumedAt: Date | null; createdAt: Date;
}
export interface AccessRecord {
  id: string; userId: string; grant: Exclude<AccessGrant, 'NONE'>; eventId: string | null; source: string;
  createdAt: Date; expiresAt: Date | null; revokedAt: Date | null; paymentId: string | null;
}
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELED';
export interface PaymentRecord {
  id: string; userId: string; provider: string; providerRef: string | null; amountCents: number; currency: string;
  status: PaymentStatus; eventId: string | null; createdAt: Date; updatedAt: Date;
}
export interface EventGroupRecord { id: string; eventId: string; key: string; name: string; designKey: string | null; neutral: boolean; sort: number }
export interface MembershipRecord { id: string; userId: string; eventId: string; groupId: string; createdAt: Date; updatedAt: Date }
export type ReportTarget = 'CHAT_MESSAGE' | 'GRAFFITI' | 'USER' | 'DEBATE_LINE';
export type ReportStatus = 'OPEN' | 'REVIEWED' | 'DISMISSED' | 'ACTIONED';
export interface ReportRecord {
  id: string; reporterUserId: string | null; targetUserId: string | null; targetType: ReportTarget; targetRef: string;
  category: ReportCategory; details: string | null; evidence: Record<string, unknown>; status: ReportStatus; eventId: string | null;
  /** apelido do denunciado no momento (cópia para revisão; a identidade é targetUserId) */
  reportedNicknameAtTime?: string | null;
  createdAt: Date; reviewedAt: Date | null;
}
export interface ModerationActionRecord {
  id: string; action: string; targetUserId: string | null; targetType: string | null; targetRef: string | null; reason: string | null;
  actor: string; createdAt: Date; expiresAt: Date | null;
}
/** mute pessoal por IDENTIDADE (userId), nunca por apelido (rodada 8.1) */
export interface MuteRecord { ownerUserId: string; mutedUserId: string; mutedNicknameAtTime: string | null; createdAt: Date }

/** progressão (rodada 9): XP/nível + JSON do progresso em andamento; conclusões/conquistas/recompensas em tabelas
 * com par ÚNICO (userId, id) — gravar de novo é inócuo (sem recompensa duplicada) */
export interface ProgressionRecord {
  xp: number; level: number; data: unknown; updatedAt: Date;
  completed: { missionId: string; completedAt: Date }[];
  achievements: { achievementId: string; unlockedAt: Date }[];
  grants: { item: string; source: string; grantedAt: Date }[];
}
export interface ProgressionSave {
  xp: number; level: number; data: unknown;
  /** só as NOVAS desde a última gravação (duplicadas são ignoradas pelo par único) */
  completed: { missionId: string; at: Date }[];
  achievements: { achievementId: string; at: Date }[];
  grants: { item: string; source: string; at: Date }[];
}

export interface AuditRecord { id: string; actor: string; action: string; targetType: string | null; targetId: string | null; meta: Record<string, unknown>; createdAt: Date }

export interface DataStore {
  readonly kind: 'prisma' | 'memory';
  users: {
    create(d: { email: string; passwordHash: string }): Promise<UserRecord>;
    byId(id: string): Promise<UserRecord | null>;
    byEmail(email: string): Promise<UserRecord | null>;
    update(id: string, patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>): Promise<UserRecord>;
  };
  profiles: {
    create(d: { userId: string; nickname: string; nicknameKey: string }): Promise<ProfileRecord>;
    byUserId(userId: string): Promise<ProfileRecord | null>;
    byNicknameKey(key: string): Promise<ProfileRecord | null>;
    update(userId: string, patch: Partial<Pick<ProfileRecord, 'nickname' | 'nicknameKey' | 'displayName' | 'preferences'>>): Promise<ProfileRecord>;
  };
  appearances: {
    get(userId: string): Promise<{ data: unknown; version: number; updatedAt: Date } | null>;
    put(userId: string, data: unknown): Promise<void>;
  };
  sessions: {
    create(d: { userId: string; tokenHash: string; expiresAt: Date; uaHash: string | null }): Promise<SessionRecord>;
    byTokenHash(hash: string): Promise<SessionRecord | null>;
    touch(id: string, at: Date, expiresAt?: Date): Promise<void>;
    revoke(id: string): Promise<void>;
    revokeAllForUser(userId: string): Promise<number>;
    /** limpeza (idempotente, em lotes): vencidas antes de `expiredBefore` ou revogadas antes de `revokedBefore` */
    deleteExpired(expiredBefore: Date, revokedBefore: Date, limit: number): Promise<number>;
  };
  codes: {
    create(d: { userId: string; purpose: CodePurpose; codeHash: string; expiresAt: Date }): Promise<CodeRecord>;
    latest(userId: string, purpose: CodePurpose): Promise<CodeRecord | null>;
    attempt(id: string): Promise<number>;
    consume(id: string): Promise<void>;
    /** limpeza (idempotente, em lotes): vencidos antes de `expiredBefore` ou usados antes de `consumedBefore` */
    deleteExpired(expiredBefore: Date, consumedBefore: Date, limit: number): Promise<number>;
  };
  mutes: {
    list(ownerUserId: string): Promise<MuteRecord[]>;
    /** cria (ou mantém) — idempotente */
    add(ownerUserId: string, mutedUserId: string, mutedNicknameAtTime: string | null): Promise<void>;
    /** remove; devolve se existia */
    remove(ownerUserId: string, mutedUserId: string): Promise<boolean>;
  };
  access: {
    active(userId: string, eventId: string | null, now: Date): Promise<AccessRecord[]>;
    grant(d: { userId: string; grant: AccessRecord['grant']; eventId: string | null; source: string; expiresAt?: Date | null; paymentId?: string | null }): Promise<AccessRecord>;
    revoke(id: string): Promise<void>;
    list(userId: string): Promise<AccessRecord[]>;
  };
  payments: {
    create(d: Omit<PaymentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PaymentRecord>;
    byId(id: string): Promise<PaymentRecord | null>;
    update(id: string, patch: Partial<Pick<PaymentRecord, 'status' | 'providerRef'>>): Promise<PaymentRecord>;
  };
  events: {
    upsert(d: { id: string; name: string; groups: Omit<EventGroupRecord, 'eventId'>[] }): Promise<void>;
    groups(eventId: string): Promise<EventGroupRecord[]>;
    membership(userId: string, eventId: string): Promise<MembershipRecord | null>;
    setMembership(userId: string, eventId: string, groupId: string): Promise<MembershipRecord>;
    clearMembership(userId: string, eventId: string): Promise<void>;
  };
  reports: {
    create(d: Omit<ReportRecord, 'id' | 'createdAt' | 'reviewedAt' | 'status'>): Promise<ReportRecord>;
    list(filter?: { status?: ReportStatus; limit?: number }): Promise<ReportRecord[]>;
    setStatus(id: string, status: ReportStatus): Promise<void>;
  };
  moderation: {
    create(d: Omit<ModerationActionRecord, 'id' | 'createdAt'>): Promise<ModerationActionRecord>;
    forUser(userId: string): Promise<ModerationActionRecord[]>;
  };
  /** rodada 9 — progressão (server/src/progression): gravada em LOTES pelo ProgressionService, nunca por evento */
  progression: {
    load(userId: string): Promise<ProgressionRecord | null>;
    /** upsert de PlayerProgress + inserção idempotente (pares únicos) de conclusões/conquistas/recompensas, numa transação */
    save(userId: string, d: ProgressionSave): Promise<void>;
  };
  audit: {
    append(d: Omit<AuditRecord, 'id' | 'createdAt'>): Promise<void>;
    list(limit?: number): Promise<AuditRecord[]>;
  };
  close(): Promise<void>;
}
