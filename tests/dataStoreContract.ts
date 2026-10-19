/**
 * Testes de CONTRATO do DataStore (rodada 8): a mesma bateria roda no MemoryDataStore (`npm test`,
 * tests/dataStore.test.ts) e no PrismaDataStore (`npm run test:db`, server/test/prismaStore.dbtest.ts).
 * Não é um arquivo .test.ts: quem chama fornece a fábrica. Cada teste usa e-mails/ids únicos (banco compartilhado).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DataStore } from '../server/src/data/types';

const uniq = () => randomUUID().slice(0, 8);
const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

export function dataStoreContract(name: string, make: () => Promise<DataStore>) {
  describe(`DataStore (${name}) — contrato`, () => {
    let s: DataStore;
    beforeAll(async () => { s = await make(); });
    afterAll(async () => { await s?.close(); });

    const newUser = async () => s.users.create({ email: `u${uniq()}@exemplo.test`, passwordHash: 'scrypt$x' });

    it('usuários: criar, buscar, atualizar; e-mail único → P2002', async () => {
      const u = await newUser();
      expect(u.emailVerified).toBe(false);
      expect(u.status).toBe('ACTIVE');
      expect((await s.users.byEmail(u.email))?.id).toBe(u.id);
      expect((await s.users.byId(u.id))?.email).toBe(u.email);
      await expect(s.users.create({ email: u.email, passwordHash: 'y' })).rejects.toMatchObject({ code: 'P2002' });
      const until = new Date(Date.now() + 3600_000);
      const up = await s.users.update(u.id, { status: 'SUSPENDED', suspendedUntil: until, emailVerified: true });
      expect(up.status).toBe('SUSPENDED');
      expect(+up.suspendedUntil!).toBe(+until);
      expect(await s.users.byId('00000000-0000-0000-0000-000000000000')).toBeNull();
    });

    it('perfis: apelido único pela chave → P2002 (criar e atualizar); preferências JSON', async () => {
      const a = await newUser(), b = await newUser();
      const key = `k${uniq()}`;
      await s.profiles.create({ userId: a.id, nickname: 'Fulano', nicknameKey: key });
      await expect(s.profiles.create({ userId: b.id, nickname: 'fulano', nicknameKey: key })).rejects.toMatchObject({ code: 'P2002' });
      await s.profiles.create({ userId: b.id, nickname: 'Outro', nicknameKey: `o${uniq()}` });
      await expect(s.profiles.update(b.id, { nicknameKey: key })).rejects.toMatchObject({ code: 'P2002' });
      const p = await s.profiles.update(a.id, { preferences: { names: 'PROXIMOS', chatCollapsed: true } });
      expect(p.preferences).toEqual({ names: 'PROXIMOS', chatCollapsed: true });
      expect((await s.profiles.byNicknameKey(key))?.userId).toBe(a.id);
    });

    it('torcida (rodada 10): colunas novas nulas por padrão, gravar/ler, troca pendente, perfil intacto', async () => {
      const u = await newUser();
      expect(await s.supporters.get(u.id)).toBeNull(); // sem perfil
      await s.profiles.create({ userId: u.id, nickname: 'Torcedor', nicknameKey: `t${uniq()}` });
      expect(await s.supporters.get(u.id)).toEqual({ group: null, pending: null, changedAt: null });
      const at = new Date(Date.now() - 5000);
      await s.supporters.set(u.id, { group: 'grupo_a', pending: null, changedAt: at });
      await s.supporters.set(u.id, { group: 'grupo_a', pending: 'grupo_b', changedAt: at });
      const r = (await s.supporters.get(u.id))!;
      expect(r.group).toBe('grupo_a');
      expect(r.pending).toBe('grupo_b');
      expect(+r.changedAt!).toBe(+at);
      expect((await s.profiles.byUserId(u.id))?.nickname).toBe('Torcedor'); // nada existente muda
    });

    it('título equipado (rodada 11): coluna nova nula por padrão, gravar/ler/limpar, perfil e torcida intactos', async () => {
      const u = await newUser();
      expect(await s.titles.get(u.id)).toBeNull(); // sem perfil
      await s.profiles.create({ userId: u.id, nickname: 'Titulada', nicknameKey: `ti${uniq()}` });
      expect(await s.titles.get(u.id)).toBeNull();
      await s.titles.set(u.id, 'Boa de papo');
      expect(await s.titles.get(u.id)).toBe('Boa de papo');
      await s.titles.set(u.id, null);
      expect(await s.titles.get(u.id)).toBeNull();
      expect((await s.profiles.byUserId(u.id))?.nickname).toBe('Titulada');
      expect(await s.supporters.get(u.id)).toEqual({ group: null, pending: null, changedAt: null });
    });

    it('aparência: upsert com versão crescente', async () => {
      const u = await newUser();
      expect(await s.appearances.get(u.id)).toBeNull();
      await s.appearances.put(u.id, { body: 'mulher', skin: 1 });
      await s.appearances.put(u.id, { body: 'homem', skin: 2 });
      const a = await s.appearances.get(u.id);
      expect(a?.data).toEqual({ body: 'homem', skin: 2 });
      expect(a?.version).toBe(2);
    });

    it('sessões: por hash, touch, revogar uma e todas', async () => {
      const u = await newUser();
      const exp = new Date(Date.now() + 86_400_000);
      const s1 = await s.sessions.create({ userId: u.id, tokenHash: `h${uniq()}`, expiresAt: exp, uaHash: null });
      const s2 = await s.sessions.create({ userId: u.id, tokenHash: `h${uniq()}`, expiresAt: exp, uaHash: 'ua' });
      expect((await s.sessions.byTokenHash(s1.tokenHash))?.id).toBe(s1.id);
      const at = new Date(Date.now() + 1000), exp2 = new Date(Date.now() + 2 * 86_400_000);
      await s.sessions.touch(s1.id, at, exp2);
      const t = await s.sessions.byTokenHash(s1.tokenHash);
      expect(+t!.lastSeenAt).toBe(+at);
      expect(+t!.expiresAt).toBe(+exp2);
      await s.sessions.revoke(s1.id);
      expect((await s.sessions.byTokenHash(s1.tokenHash))?.revokedAt).toBeInstanceOf(Date);
      expect(await s.sessions.revokeAllForUser(u.id)).toBe(1); // só a s2 ainda estava ativa
      expect((await s.sessions.byTokenHash(s2.tokenHash))?.revokedAt).toBeInstanceOf(Date);
      expect(await s.sessions.byTokenHash('nao-existe')).toBeNull();
    });

    it('códigos: mais recente por finalidade, tentativas, consumo', async () => {
      const u = await newUser();
      const exp = new Date(Date.now() + 900_000);
      await s.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: 'a', expiresAt: exp });
      await pause();
      const c2 = await s.codes.create({ userId: u.id, purpose: 'EMAIL_VERIFY', codeHash: 'b', expiresAt: exp });
      await s.codes.create({ userId: u.id, purpose: 'PASSWORD_RESET', codeHash: 'c', expiresAt: exp });
      expect((await s.codes.latest(u.id, 'EMAIL_VERIFY'))?.id).toBe(c2.id);
      expect(await s.codes.attempt(c2.id)).toBe(1);
      expect(await s.codes.attempt(c2.id)).toBe(2);
      await s.codes.consume(c2.id);
      expect((await s.codes.latest(u.id, 'EMAIL_VERIFY'))?.consumedAt).toBeInstanceOf(Date);
    });

    it('acesso: ativas por evento/global, expiração e revogação', async () => {
      const u = await newUser();
      const now = new Date();
      const g1 = await s.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'teste' });
      await s.access.grant({ userId: u.id, grant: 'PAID', eventId: 'ev-x', source: 'teste' });
      await s.access.grant({ userId: u.id, grant: 'STAFF', eventId: null, source: 'teste', expiresAt: new Date(Date.now() - 1000) });
      expect((await s.access.active(u.id, 'ev-x', now)).map((a) => a.grant).sort()).toEqual(['DEV_GRANTED', 'PAID']);
      expect((await s.access.active(u.id, 'ev-y', now)).map((a) => a.grant)).toEqual(['DEV_GRANTED']);
      expect((await s.access.active(u.id, null, now)).map((a) => a.grant)).toEqual(['DEV_GRANTED']);
      await s.access.revoke(g1.id);
      expect((await s.access.active(u.id, 'ev-y', now))).toEqual([]);
      expect((await s.access.list(u.id)).length).toBe(3);
    });

    it('pagamentos + concessão ligada ao pagamento (única)', async () => {
      const u = await newUser();
      const p = await s.payments.create({ userId: u.id, provider: 'mock', providerRef: `r${uniq()}`, amountCents: 500, currency: 'BRL', status: 'PENDING', eventId: null });
      expect((await s.payments.update(p.id, { status: 'PAID' })).status).toBe('PAID');
      expect((await s.payments.byId(p.id))?.status).toBe('PAID');
      const g = await s.access.grant({ userId: u.id, grant: 'PAID', eventId: null, source: 'payment:mock', paymentId: p.id });
      expect(g.paymentId).toBe(p.id);
      await expect(s.access.grant({ userId: u.id, grant: 'PAID', eventId: null, source: 'payment:mock', paymentId: p.id })).rejects.toMatchObject({ code: 'P2002' });
    });

    it('eventos: upsert idempotente, grupos ordenados, membership por evento', async () => {
      const ev = `ev${uniq()}`;
      const groups = [{ id: `${ev}:b`, key: 'b', name: 'B', designKey: null, neutral: false, sort: 1 }, { id: `${ev}:a`, key: 'a', name: 'A', designKey: 'paz', neutral: true, sort: 0 }];
      await s.events.upsert({ id: ev, name: 'Evento', groups });
      await s.events.upsert({ id: ev, name: 'Evento 2', groups: [{ ...groups[0], name: 'B2' }, groups[1]] });
      const gs = await s.events.groups(ev);
      expect(gs.map((g) => g.key)).toEqual(['a', 'b']);
      expect(gs[1].name).toBe('B2');
      expect(gs[0]).toMatchObject({ eventId: ev, designKey: 'paz', neutral: true });
      const u = await newUser();
      expect(await s.events.membership(u.id, ev)).toBeNull();
      await s.events.setMembership(u.id, ev, `${ev}:a`);
      const m = await s.events.setMembership(u.id, ev, `${ev}:b`);
      expect(m.groupId).toBe(`${ev}:b`);
      expect((await s.events.membership(u.id, ev))?.groupId).toBe(`${ev}:b`);
      await expect(s.events.setMembership(u.id, ev, 'outro:x')).rejects.toThrow();
      await s.events.clearMembership(u.id, ev);
      expect(await s.events.membership(u.id, ev)).toBeNull();
    });

    it('denúncias, moderação e auditoria', async () => {
      const a = await newUser(), b = await newUser();
      const r = await s.reports.create({ reporterUserId: a.id, targetUserId: b.id, targetType: 'CHAT_MESSAGE', targetRef: `m${uniq()}`, category: 'SPAM', details: null, evidence: { text: 'oi' }, eventId: null });
      expect(r.status).toBe('OPEN');
      expect((await s.reports.list({ status: 'OPEN', limit: 500 })).some((x) => x.id === r.id)).toBe(true);
      await s.reports.setStatus(r.id, 'REVIEWED');
      expect((await s.reports.list({ status: 'OPEN', limit: 500 })).some((x) => x.id === r.id)).toBe(false);
      const rr = (await s.reports.list({ status: 'REVIEWED', limit: 500 })).find((x) => x.id === r.id)!;
      expect(rr.reviewedAt).toBeInstanceOf(Date);
      expect(rr.evidence).toEqual({ text: 'oi' });
      // rodada 9: fala do palco de debate (enum DEBATE_LINE, migração 20261017140000)
      const d = await s.reports.create({ reporterUserId: a.id, targetUserId: b.id, targetType: 'DEBATE_LINE', targetRef: `debate:x:${uniq()}`, category: 'ASSEDIO', details: null, evidence: { kind: 'debate', text: 'fala' }, eventId: null });
      expect((await s.reports.list({ status: 'OPEN', limit: 500 })).find((x) => x.id === d.id)).toMatchObject({ targetType: 'DEBATE_LINE', evidence: { kind: 'debate', text: 'fala' } });
      await s.moderation.create({ action: 'SUSPEND', targetUserId: b.id, targetType: 'USER', targetRef: null, reason: 'teste', actor: 'cli:t', expiresAt: null });
      expect((await s.moderation.forUser(b.id)).map((m) => m.action)).toEqual(['SUSPEND']);
      const tag = uniq();
      await s.audit.append({ actor: 'cli:t', action: `teste.${tag}`, targetType: 'user', targetId: b.id, meta: { n: 1 } });
      const log = await s.audit.list(50);
      expect(log.find((x) => x.action === `teste.${tag}`)?.meta).toEqual({ n: 1 });
    });

    it('progressão (rodada 9): load/save em lote, JSON do progresso, pares únicos sem duplicar recompensa', async () => {
      const u = await newUser();
      expect(await s.progression.load(u.id)).toBeNull();
      const t = new Date(Date.now() - 60_000);
      await s.progression.save(u.id, {
        xp: 75, level: 1, data: { v: 1, active: [{ missionId: 'conheca_pv', values: { central: 1 }, startedAt: 1 }], seen: ['welcome'] },
        completed: [{ missionId: 'boas_vindas', at: t }], achievements: [{ achievementId: 'primeiros_passos', at: t }], grants: [{ item: 'title:Teste', source: 'mission:boas_vindas', at: t }],
      });
      // segundo lote: XP sobe, repete conclusão/conquista/item (ignorados pelo par único) e acrescenta novos
      await s.progression.save(u.id, {
        xp: 300, level: 3, data: { v: 1, active: [], seen: ['welcome'] },
        completed: [{ missionId: 'boas_vindas', at: new Date() }, { missionId: 'conheca_pv', at: new Date() }],
        achievements: [{ achievementId: 'primeiros_passos', at: new Date() }],
        grants: [{ item: 'title:Teste', source: 'outra', at: new Date() }, { item: 'shirt:209', source: 'mission:mobilidade', at: new Date() }],
      });
      const r = (await s.progression.load(u.id))!;
      expect(r.xp).toBe(300);
      expect(r.level).toBe(3);
      expect(r.data).toEqual({ v: 1, active: [], seen: ['welcome'] });
      expect(r.completed.map((c) => c.missionId).sort()).toEqual(['boas_vindas', 'conheca_pv']);
      expect(+r.completed.find((c) => c.missionId === 'boas_vindas')!.completedAt).toBe(+t); // a primeira vale
      expect(r.achievements.map((a) => a.achievementId)).toEqual(['primeiros_passos']);
      expect(r.grants.map((g) => g.item).sort()).toEqual(['shirt:209', 'title:Teste']);
      expect(r.grants.find((g) => g.item === 'title:Teste')!.source).toBe('mission:boas_vindas');
      // outra conta não vê nada
      const v = await newUser();
      expect(await s.progression.load(v.id)).toBeNull();
    });
  });
}
