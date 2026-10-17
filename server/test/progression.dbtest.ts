/**
 * Rodada 9 — tabelas de progressão no PostgreSQL REAL (`npm run test:db`): pares únicos no banco (não só no código),
 * cascata ao apagar a conta, e o ProgressionService gravando em lote e restaurando após "reinício" (conexão nova).
 */
import { describe, it, expect } from 'vitest';
import { createPrismaStore } from '../src/data/prisma';
import { ProgressionService } from '../src/progression/ProgressionService';
import { loadCatalog } from '../src/progression/catalog';

const URL_ = process.env.DATABASE_URL ?? '';

describe('progressão — PostgreSQL', () => {
  it('pares únicos (CompletedMission, AchievementUnlock, RewardGrant) recusam duplicata; apagar a conta apaga o progresso', async () => {
    const s = await createPrismaStore(URL_);
    const u = await s.users.create({ email: `prog${Date.now()}@exemplo.test`, passwordHash: 'x' });
    await s.progression.save(u.id, { xp: 10, level: 1, data: {}, completed: [{ missionId: 'boas_vindas', at: new Date() }], achievements: [{ achievementId: 'no_palco', at: new Date() }], grants: [{ item: 'acc:bolsa', source: 'a', at: new Date() }] });
    const dup = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'P2002' });
    await dup(s.db.completedMission.create({ data: { userId: u.id, missionId: 'boas_vindas' } }));
    await dup(s.db.achievementUnlock.create({ data: { userId: u.id, achievementId: 'no_palco' } }));
    await dup(s.db.rewardGrant.create({ data: { userId: u.id, item: 'acc:bolsa', source: 'outra' } }));
    expect(await s.db.rewardGrant.count({ where: { userId: u.id } })).toBe(1);
    await s.db.user.delete({ where: { id: u.id } });
    expect(await s.progression.load(u.id)).toBeNull();
    expect(await s.db.rewardGrant.count({ where: { userId: u.id } })).toBe(0);
    await s.close();
  });

  it('serviço grava em lote e a conta volta igual depois do "reinício" (nova conexão, nova sessão)', async () => {
    const a = await createPrismaStore(URL_);
    const u = await a.users.create({ email: `prog2${Date.now()}@exemplo.test`, passwordHash: 'x' });
    let writes = 0;
    const orig = a.progression.save;
    a.progression.save = (id, d) => { writes++; return orig(id, d); };
    const svc = new ProgressionService({ catalog: loadCatalog(), store: a, send: () => {}, flushMs: 60_000 });
    await svc.preload(u.id);
    svc.join('s1', { userId: u.id, persistent: true });
    const t = Date.now();
    for (let i = 0; i < 6; i++) svc.onEvent({ sid: 's1', at: t + i, ev: { type: 'distance', mode: 'foot', meters: 10 } });
    for (const zone of ['CENTRAL', 'CAMPO_DE_SANTANA', 'RIO_BRANCO', 'CANDELARIA']) svc.onEvent({ sid: 's1', at: t + 100, ev: { type: 'zone_enter', zone } });
    expect(writes).toBe(0);
    const before = svc.snapshot('s1')!;
    expect(before.completedMissions).toEqual(['boas_vindas', 'conheca_pv']);
    svc.leave('s1');
    await svc.flushAll();
    expect(writes).toBe(1);
    await a.close();
    const b = await createPrismaStore(URL_);
    const svc2 = new ProgressionService({ catalog: loadCatalog(), store: b, send: () => {} });
    await svc2.preload(u.id);
    svc2.join('s2', { userId: u.id, persistent: true });
    const after = svc2.snapshot('s2')!;
    expect(after.xp).toBe(before.xp);
    expect(after.completedMissions.sort()).toEqual(before.completedMissions.sort());
    expect(after.achievements.sort()).toEqual(before.achievements.sort());
    expect(after.unlocks.sort()).toEqual(before.unlocks.sort());
    await b.close();
  });
});
