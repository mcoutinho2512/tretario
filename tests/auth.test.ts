/** Rodada 8 — segurança de conta e sessão (AuthService sobre MemoryDataStore; o mesmo código roda no Prisma). */
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import { resolveIdentity, JoinRefused } from '../server/src/identity/resolve';
import { AuthService } from '../server/src/auth/service';
import { DevelopmentMailProvider } from '../server/src/auth/mail';
import { hashPassword, verifyPassword, needsRehash, checkPasswordPolicy } from '../server/src/auth/password';
import { SESSION_COOKIE, SESSION_TOUCH_MS, SESSION_TTL_MS } from '../server/src/auth/session';
import { CODE_TTL_MS } from '../server/src/auth/codes';
import { parseCookies } from '../server/src/http/router';
import { ban, grantAccess, suspend } from '../server/src/access/admin';
import type { Services } from '../server/src/services';
import type { MeResponse } from '../src/identity/types';

const FAST = { logN: 10, r: 8, p: 1 };
const EV = 'manifestacao';

function setup() {
  const clock = { t: Date.now() };
  const store = new MemoryDataStore();
  const tickets = new TicketService();
  const mail = new DevelopmentMailProvider(false);
  const auth = new AuthService({ store, tickets, mail, secret: 'segredo-de-teste', currentEventId: () => EV, scrypt: FAST, now: () => clock.t });
  const svc: Services = { store, tickets };
  const req = (body: unknown = {}, cookies: Record<string, string> = {}, ip = '10.0.0.1') => ({ body, cookies, ip, headers: { 'user-agent': 'vitest' } });
  /** cookie de sessão de uma resposta */
  const sid = (res: { cookies?: string[] }) => parseCookies(res.cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0]);
  const code = (email: string, kind = 'EMAIL_VERIFY') => mail.outbox(email).find((m) => m.kind === kind)!.code;
  async function account(email = 'ana@exemplo.test', nickname = 'Ana_RJ', password = 'Copacabana!42') {
    const r = await auth.register(req({ email, password, confirm: password, nickname }));
    expect(r.status).toBe(201);
    const c = sid(r);
    expect((await auth.verifyEmail(req({ code: code(email) }, c))).status ?? 200).toBe(200);
    return { cookies: c, email, password, nickname };
  }
  return { clock, store, tickets, mail, auth, svc, req, sid, code, account };
}

describe('senhas', () => {
  it('scrypt versionado com sal por usuário; compara certo; detecta parâmetros antigos', async () => {
    const h1 = await hashPassword('Copacabana!42', FAST), h2 = await hashPassword('Copacabana!42', FAST);
    expect(h1).toMatch(/^scrypt\$10\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(h1).not.toBe(h2); // sal diferente
    expect(await verifyPassword('Copacabana!42', h1)).toBe(true);
    expect(await verifyPassword('copacabana!42', h1)).toBe(false);
    expect(await verifyPassword('x', 'lixo')).toBe(false);
    expect(needsRehash(h1, FAST)).toBe(false);
    expect(needsRehash(h1, { logN: 11, r: 8, p: 1 })).toBe(true);
  });
  it('política: curta, comum, sequência, igual ao e-mail', () => {
    expect(checkPasswordPolicy('abc')).toBe('senha_curta');
    expect(checkPasswordPolicy('12345678')).toBe('senha_comum');
    expect(checkPasswordPolicy('Password')).toBe('senha_comum');
    expect(checkPasswordPolicy('aaaaaaaaaa')).toBe('senha_comum');
    expect(checkPasswordPolicy('abcdefghij')).toBe('senha_comum');
    expect(checkPasswordPolicy('joaozinho', { email: 'joaozinho@x.com' })).toBe('senha_comum');
    expect(checkPasswordPolicy('x'.repeat(129))).toBe('senha_longa');
    expect(checkPasswordPolicy('Copacabana!42')).toBeNull();
  });
});

describe('cadastro e verificação', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('senha NUNCA em claro no banco; e-mail normalizado; código só como hash', async () => {
    const pw = 'Copacabana!42';
    const r = await t.auth.register(t.req({ email: '  Ana@Exemplo.TEST ', password: pw, confirm: pw, nickname: 'Ana_RJ' }));
    expect(r.status).toBe(201);
    const u = (await t.store.users.byEmail('ana@exemplo.test'))!;
    expect(u.passwordHash.startsWith('scrypt$')).toBe(true);
    const sent = t.code('ana@exemplo.test');
    // inspeciona TODO o estado interno do store: nem senha, nem código, nem token de sessão em claro
    const dump = JSON.stringify(Object.values(t.store).map((v) => (v instanceof Map ? [...v.values()] : v)));
    expect(dump).not.toContain(pw);
    expect(dump).not.toContain(`"${sent}"`);
    expect(dump).not.toContain(t.sid(r)[SESSION_COOKIE]);
    // o DTO do próprio usuário não traz e-mail nem ids
    const me = (r.body as { me: MeResponse }).me;
    expect(JSON.stringify(me)).not.toContain('exemplo.test');
    expect(me).toMatchObject({ authenticated: true, user: { nickname: 'Ana_RJ', emailVerified: false }, access: { state: 'REGISTERED', grant: 'NONE' } });
  });

  it('erros claros: senhas diferentes, e-mail inválido, e-mail em uso, apelido reservado/bloqueado', async () => {
    const ok = { email: 'b@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Beto' };
    expect((await t.auth.register(t.req({ ...ok, confirm: 'outra' }))).body).toMatchObject({ error: 'senhas_diferentes' });
    expect((await t.auth.register(t.req({ ...ok, email: 'sem-arroba' }))).body).toMatchObject({ error: 'email_invalido' });
    expect((await t.auth.register(t.req({ ...ok, password: '12345678', confirm: '12345678' }))).body).toMatchObject({ error: 'senha_comum' });
    expect((await t.auth.register(t.req({ ...ok, nickname: 'Adm1n' }))).body).toMatchObject({ error: 'apelido_reservado' });
    expect((await t.auth.register(t.req({ ...ok, nickname: 'com espaço' }))).body).toMatchObject({ error: 'apelido_caracteres' });
    expect((await t.auth.register(t.req({ ...ok, nickname: 'ab' }))).body).toMatchObject({ error: 'apelido_curto' });
    expect((await t.auth.register(t.req(ok))).status).toBe(201);
    expect((await t.auth.register(t.req({ ...ok, nickname: 'Outro' }))).body).toMatchObject({ error: 'email_em_uso' });
  });

  it('apelido duplicado recusado com variações de acento, maiúsculas, leet e símbolos', async () => {
    await t.account('a@exemplo.test', 'João.Silva');
    for (const n of ['joao.silva', 'JOAO_SILVA', 'Joao-Silva', 'J0ao.Silva', 'joãosilva']) {
      const r = await t.auth.register(t.req({ email: `x${Math.random()}@exemplo.test`, password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: n }));
      expect(r.body, n).toMatchObject({ error: 'apelido_em_uso' });
      expect(r.status).toBe(409);
    }
    const q = (n: string) => t.auth.nicknameAvailable({ ...t.req(), query: new URLSearchParams({ n }) });
    expect((await q('JOAO_SILVA')).body).toEqual({ available: false, reason: 'apelido_em_uso' });
    expect((await q('Maria_Lapa')).body).toMatchObject({ available: true });
  });

  it('código de e-mail: errado, máximo de tentativas, expiração, reenvio limitado', async () => {
    const r = await t.auth.register(t.req({ email: 'c@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Cida' }));
    const c = t.sid(r);
    const good = t.code('c@exemplo.test');
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await t.auth.verifyEmail(t.req({ code: wrong }, c))).body).toMatchObject({ error: 'codigo_invalido' });
    // 5 tentativas gastas: nem o código certo vale mais
    expect((await t.auth.verifyEmail(t.req({ code: good }, c))).body).toMatchObject({ error: 'codigo_expirado' });
    expect((await t.auth.resendCode(t.req({}, c))).body).toMatchObject({ ok: true });
    expect((await t.auth.resendCode(t.req({}, c))).body).toMatchObject({ error: 'aguarde' }); // 1 por minuto
    const fresh = t.code('c@exemplo.test');
    t.clock.t += CODE_TTL_MS + 1;
    expect((await t.auth.verifyEmail(t.req({ code: fresh }, c))).body).toMatchObject({ error: 'codigo_expirado' });
    expect((await t.auth.resendCode(t.req({}, c))).body).toMatchObject({ ok: true });
    const r2 = await t.auth.verifyEmail(t.req({ code: t.code('c@exemplo.test') }, c));
    expect((r2.body as { me: MeResponse }).me.user?.emailVerified).toBe(true);
  });
});

describe('sessão', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('me restaura a sessão; inválida, expirada e revogada são recusadas', async () => {
    const a = await t.account();
    expect(((await t.auth.me(t.req({}, a.cookies))).body as MeResponse).authenticated).toBe(true);
    // token inventado
    const bad = await t.auth.me(t.req({}, { [SESSION_COOKIE]: 'x'.repeat(43) }));
    expect((bad.body as MeResponse)).toEqual({ authenticated: false, access: { state: 'VISITOR', grant: 'NONE' } });
    expect(bad.cookies?.[0]).toMatch(/Max-Age=0/); // apaga o cookie ruim
    // logout revoga
    await t.auth.logout(t.req({}, a.cookies));
    expect(((await t.auth.me(t.req({}, a.cookies))).body as MeResponse).authenticated).toBe(false);
    expect((await t.auth.ticket(t.req({}, a.cookies))).status).toBe(401);
    // expiração
    const l = await t.auth.login(t.req({ email: a.email, password: a.password }));
    const c = t.sid(l);
    t.clock.t += SESSION_TTL_MS + 1;
    expect(((await t.auth.me(t.req({}, c))).body as MeResponse).authenticated).toBe(false);
  });

  it('cookie HttpOnly + SameSite=Lax; expiração deslizante renovada no máximo a cada 10 min', async () => {
    const l = await t.auth.register(t.req({ email: 'd@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Dani' }));
    expect(l.cookies?.[0]).toMatch(/HttpOnly/);
    expect(l.cookies?.[0]).toMatch(/SameSite=Lax/);
    const c = t.sid(l);
    const s0 = (await t.store.sessions.byTokenHash((await t.auth.sessions.resolve(c))!.session.tokenHash))!;
    t.clock.t += 60_000;
    expect((await t.auth.me(t.req({}, c))).cookies).toBeUndefined(); // < 10 min: sem escrita
    expect(+(await t.store.sessions.byTokenHash(s0.tokenHash))!.lastSeenAt).toBe(+s0.lastSeenAt);
    t.clock.t += SESSION_TOUCH_MS;
    const r = await t.auth.me(t.req({}, c));
    expect(r.cookies?.[0]).toMatch(new RegExp(`Max-Age=${SESSION_TTL_MS / 1000}`));
    expect(+(await t.store.sessions.byTokenHash(s0.tokenHash))!.expiresAt).toBe(t.clock.t + SESSION_TTL_MS);
  });

  it('login: mensagem genérica; força bruta limitada por e-mail (backoff) e por IP', async () => {
    const a = await t.account();
    const wrong = await t.auth.login(t.req({ email: a.email, password: 'errada-123' }));
    const ghost = await t.auth.login(t.req({ email: 'naoexiste@exemplo.test', password: 'errada-123' }));
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(ghost.body); // não revela se a conta existe
    for (let i = 0; i < 4; i++) await t.auth.login(t.req({ email: a.email, password: `errada-${i}` }, {}, `10.1.0.${i}`));
    // 6ª falha → bloqueado, mesmo com a senha certa e de outro IP
    await t.auth.login(t.req({ email: a.email, password: 'errada-x' }, {}, '10.9.9.9'));
    const blocked = await t.auth.login(t.req({ email: a.email, password: a.password }, {}, '10.2.2.2'));
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ error: 'muitas_tentativas' });
    t.clock.t += 2000;
    expect((await t.auth.login(t.req({ email: a.email, password: a.password }, {}, '10.2.2.2'))).status ?? 200).toBe(200);
    // IP que tenta muitos e-mails diferentes
    for (let i = 0; i < 21; i++) await t.auth.login(t.req({ email: `alvo${i}@exemplo.test`, password: 'qualquer-1' }, {}, '10.6.6.6'));
    expect((await t.auth.login(t.req({ email: a.email, password: a.password }, {}, '10.6.6.6'))).status).toBe(429);
  });

  it('login refaz o hash quando os parâmetros do scrypt mudam', async () => {
    const a = await t.account();
    const u = (await t.store.users.byEmail(a.email))!;
    await t.store.users.update(u.id, { passwordHash: await hashPassword(a.password, { logN: 11, r: 8, p: 1 }) });
    expect((await t.auth.login(t.req({ email: a.email, password: a.password }))).status ?? 200).toBe(200);
    expect((await t.store.users.byEmail(a.email))!.passwordHash.startsWith('scrypt$10$')).toBe(true);
  });
});

describe('esqueci a senha', () => {
  it('mesma resposta com ou sem conta; código redefine e derruba TODAS as sessões', async () => {
    const t = setup();
    const a = await t.account();
    const l2 = await t.auth.login(t.req({ email: a.email, password: a.password }));
    const yes = await t.auth.forgot(t.req({ email: a.email }));
    const no = await t.auth.forgot(t.req({ email: 'ninguem@exemplo.test' }));
    expect(yes).toEqual(no);
    expect(t.mail.outbox('ninguem@exemplo.test')).toEqual([]);
    const code = t.code(a.email, 'PASSWORD_RESET');
    expect((await t.auth.reset(t.req({ email: 'ninguem@exemplo.test', code, password: 'Nova#Senha2026' }))).body).toEqual({ error: 'codigo_invalido' });
    expect((await t.auth.reset(t.req({ email: a.email, code: '999999' === code ? '000000' : '999999', password: 'Nova#Senha2026' }))).body).toEqual({ error: 'codigo_invalido' });
    expect((await t.auth.reset(t.req({ email: a.email, code, password: 'Nova#Senha2026' }))).body).toEqual({ ok: true });
    for (const c of [a.cookies, t.sid(l2)]) expect(((await t.auth.me(t.req({}, c))).body as MeResponse).authenticated).toBe(false);
    expect((await t.auth.login(t.req({ email: a.email, password: a.password }))).status).toBe(401);
    expect((await t.auth.login(t.req({ email: a.email, password: 'Nova#Senha2026' }))).status ?? 200).toBe(200);
    expect((await t.store.audit.list()).some((x) => x.action === 'auth.password_reset')).toBe(true);
  });
  it('limitado por IP (429 igual para qualquer e-mail) e silenciosamente por e-mail', async () => {
    const t = setup();
    const a = await t.account();
    for (let i = 0; i < 5; i++) await t.auth.forgot(t.req({ email: a.email }, {}, '10.3.3.3'));
    expect(t.mail.outbox(a.email).filter((m) => m.kind === 'PASSWORD_RESET').length).toBe(3);
    for (let i = 0; i < 5; i++) await t.auth.forgot(t.req({ email: `z${i}@exemplo.test` }, {}, '10.3.3.3'));
    expect((await t.auth.forgot(t.req({ email: a.email }, {}, '10.3.3.3'))).status).toBe(429);
  });
});

describe('acesso: só o servidor/CLI concede PLAYER', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });
  const join = (svc: Services, ticket: string, role: 'player' | 'spectator' = 'player', now?: number) => resolveIdentity(svc, { ticket, role }, EV, now);

  it('campos forjados no cadastro e pedido de papel "player" sem concessão → espectador', async () => {
    const pw = 'Copacabana!42';
    const r = await t.auth.register(t.req({ email: 'e@exemplo.test', password: pw, confirm: pw, nickname: 'Edu', grant: 'STAFF', state: 'PLAYER', status: 'ACTIVE', emailVerified: true, access: { state: 'PLAYER' } }));
    expect((r.body as { me: MeResponse }).me.access).toEqual({ state: 'REGISTERED', grant: 'NONE' });
    const c = t.sid(r);
    expect((await t.auth.ticket(t.req({ role: 'player' }, c))).body).toMatchObject({ error: 'email_nao_verificado' });
    await t.auth.verifyEmail(t.req({ code: t.code('e@exemplo.test') }, c));
    const tk = await t.auth.ticket(t.req({ role: 'player', grant: 'STAFF' }, c));
    expect(tk.body).toMatchObject({ role: 'spectator', access: { state: 'REGISTERED' } });
    const id = await join(t.svc, (tk.body as { ticket: string }).ticket, 'player', t.clock.t);
    expect(id).toMatchObject({ state: 'REGISTERED', role: 'spectator', nickname: 'Edu' });
    // ticket é de uso único
    await expect(join(t.svc, (tk.body as { ticket: string }).ticket, 'player', t.clock.t)).rejects.toBeInstanceOf(JoinRefused);
  });

  it('concessão pela CLI → PLAYER (e grava AuditLog + ModerationAction)', async () => {
    const a = await t.account();
    await grantAccess({ store: t.store, actor: 'cli:teste', now: () => t.clock.t }, a.email, { eventId: EV });
    const u = (await t.store.users.byEmail(a.email))!;
    const audit = await t.store.audit.list();
    expect(audit[0]).toMatchObject({ actor: 'cli:teste', action: 'GRANT_ACCESS', targetId: u.id });
    expect(JSON.stringify(audit)).not.toMatch(/scrypt|Copacabana/);
    expect((await t.store.moderation.forUser(u.id)).map((m) => m.action)).toEqual(['GRANT_ACCESS']);
    const tk = await t.auth.ticket(t.req({ role: 'player' }, a.cookies));
    expect(tk.body).toMatchObject({ role: 'player', access: { state: 'PLAYER', grant: 'DEV_GRANTED' } });
    expect(await join(t.svc, (tk.body as { ticket: string }).ticket, 'player', t.clock.t)).toMatchObject({ state: 'PLAYER', role: 'player', userId: u.id });
  });

  it('suspenso → só espectador; banido → não entra (ticket recusado e sessões derrubadas)', async () => {
    const a = await t.account();
    const ctx = { store: t.store, actor: 'cli:teste', now: () => t.clock.t };
    await grantAccess(ctx, a.email);
    await suspend(ctx, a.email, 2, 'flood no chat');
    const tk = await t.auth.ticket(t.req({ role: 'player' }, a.cookies));
    expect(tk.body).toMatchObject({ role: 'spectator', access: { state: 'SUSPENDED' } });
    expect(await join(t.svc, (tk.body as { ticket: string }).ticket, 'player', t.clock.t)).toMatchObject({ state: 'SUSPENDED', role: 'spectator' });
    // suspensão vence → volta a PLAYER sem ação manual
    t.clock.t += 2 * 3600_000 + 1;
    expect((await t.auth.ticket(t.req({}, a.cookies))).body).toMatchObject({ role: 'player' });
    const before = await t.auth.ticket(t.req({}, a.cookies));
    await ban(ctx, a.email, 'ameaça');
    expect((await t.auth.ticket(t.req({}, a.cookies))).status).toBe(401); // sessões revogadas no banimento
    const l = await t.auth.login(t.req({ email: a.email, password: a.password }));
    expect((await t.auth.ticket(t.req({}, t.sid(l)))).body).toMatchObject({ error: 'banido' });
    // ticket emitido ANTES do banimento também não entra
    await expect(join(t.svc, (before.body as { ticket: string }).ticket, 'spectator', t.clock.t)).rejects.toMatchObject({ reason: 'banido' });
    const mods = (await t.store.moderation.forUser((await t.store.users.byEmail(a.email))!.id)).map((m) => m.action);
    expect(mods).toEqual(['GRANT_ACCESS', 'SUSPEND', 'BAN']);
  });

  it('troca de apelido: valida, unicidade, auditada', async () => {
    const a = await t.account('f@exemplo.test', 'Fabi');
    await t.account('g@exemplo.test', 'Gabi');
    expect((await t.auth.changeNickname(t.req({ nickname: 'G4bi' }, a.cookies))).body).toMatchObject({ error: 'apelido_em_uso' });
    expect((await t.auth.changeNickname(t.req({ nickname: 'moderador' }, a.cookies))).body).toMatchObject({ error: 'apelido_reservado' });
    const r = await t.auth.changeNickname(t.req({ nickname: 'Fabiana' }, a.cookies));
    expect((r.body as { me: MeResponse }).me.user?.nickname).toBe('Fabiana');
    expect((await t.store.audit.list())[0]).toMatchObject({ action: 'profile.nickname', meta: { from: 'Fabi', to: 'Fabiana' } });
    expect((await t.auth.changeNickname(t.req({ nickname: 'Fabi' }))).status).toBe(401);
  });
});
