/**
 * Rodada 9.1 — produção beta no PostgreSQL REAL (npm run test:db): conta pendente → prod:approve (verificado, auditado)
 * → --grant (DEV_GRANTED) → promote/demote STAFF (enum do Prisma), e o `ping` do /health/ready.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createPrismaStore, type PrismaDataStore } from '../src/data/prisma';
import { approveBeta, demoteStaff, promoteStaff, AdminError } from '../src/access/admin';

const open: PrismaDataStore[] = [];
afterAll(async () => { for (const s of open) await s.close(); });

describe('produção beta — PostgreSQL', () => {
  it('ping (SELECT 1) do /health/ready', async () => {
    const store = await createPrismaStore(process.env.DATABASE_URL ?? '');
    open.push(store);
    await expect(store.ping()).resolves.toBeUndefined();
  });

  it('approve → verificado + AuditLog; --grant → DEV_GRANTED; STAFF entra e sai', async () => {
    const store = open[0] ?? await createPrismaStore(process.env.DATABASE_URL ?? '');
    const email = `beta-${Date.now()}@exemplo.test`;
    const u = await store.users.create({ email, passwordHash: 'scrypt$x' });
    const ctx = { store, actor: 'cli:dbtest' };
    expect(await approveBeta(ctx, email)).toEqual({ verified: true, grantId: null });
    expect((await store.users.byId(u.id))?.emailVerified).toBe(true);
    const g = await approveBeta(ctx, email.toUpperCase(), { grant: true });
    expect(g.verified).toBe(false);
    const grants = await store.access.list(u.id);
    expect(grants.some((a) => a.grant === 'DEV_GRANTED' && a.id === g.grantId)).toBe(true);
    await promoteStaff(ctx, email);
    await expect(promoteStaff(ctx, email)).rejects.toBeInstanceOf(AdminError);
    expect((await store.access.active(u.id, null, new Date())).some((a) => a.grant === 'STAFF')).toBe(true);
    expect(await demoteStaff(ctx, email)).toBe(1);
    expect((await store.access.active(u.id, null, new Date())).some((a) => a.grant === 'STAFF')).toBe(false);
    const audit = (await store.audit.list(50)).filter((a) => a.targetId === u.id || a.actor === 'cli:dbtest');
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['BETA_APPROVE', 'GRANT_ACCESS', 'REVOKE_ACCESS']));
    for (const a of audit) expect(JSON.stringify(a.meta)).not.toContain('@');
  });
});
