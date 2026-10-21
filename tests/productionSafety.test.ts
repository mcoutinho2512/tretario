/**
 * Rodada 9.1 — travas de produção, logs sem dado sensível, IP atrás do proxy, Origin (CSRF), endpoint de produção e
 * cadastro BETA sem SMTP (AuthService sobre MemoryDataStore) + CLI de liberação/equipe (funções de server/src/access/admin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { productionProblems, weakSecret } from '../server/src/prodGuard';
import { formatJson, scrub } from '../server/src/log';
import { clientIp, originAllowed } from '../server/src/http/clientIp';
import { cookie } from '../server/src/http/router';
import { sameOriginEndpoint } from '../src/net/endpoint';
import { MemoryDataStore } from '../server/src/data/memory';
import { TicketService } from '../server/src/identity/tickets';
import { AuthService } from '../server/src/auth/service';
import { BetaHoldMailProvider, devOutboxEnabled, registrationMode } from '../server/src/auth/mail';
import { approveBeta, demoteStaff, promoteStaff, AdminError } from '../server/src/access/admin';
import { SESSION_COOKIE } from '../server/src/auth/session';
import { parseCookies } from '../server/src/http/router';
import { JOIN_ERROR, PROTOCOL_VERSION } from '../src/net/protocol';

const STRONG = 'k3Jq9xP2mV7wR4tY8uZ1aB6cD0eF5gH-';
const STRONG2 = 'Zq8Lm2Nx7Vb4Cw1Rt6Yp9Ke3Hd5Jg0Fs';
const PROD_OK = { NODE_ENV: 'production', PV_SESSION_SECRET: STRONG, PV_ADMIN_TOKEN: STRONG2, DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db', PV_PUBLIC_ORIGIN: 'https://tretario.example', PV_REGISTRATION: 'beta', PV_TRUST_PROXY: 'loopback' };

describe('travas de produção (prodGuard)', () => {
  it('ambiente de produção correto passa sem erro nem aviso', () => {
    expect(productionProblems(PROD_OK)).toEqual({ errors: [], warnings: [] });
  });
  it('fora de produção não trava nada', () => {
    expect(productionProblems({ PV_TEST: '1', PV_STORE: 'memory' }).errors).toEqual([]);
  });
  it.each(['PV_TEST', 'PV_ALLOW_ANON_PLAYERS', 'PV_DEV_MAIL'])('%s proibido (qualquer valor)', (k) => {
    expect(productionProblems({ ...PROD_OK, [k]: '0' }).errors.join()).toContain(k);
  });
  it('PV_STORE=memory, segredos fracos/iguais, sem origem, sem beta → recusa', () => {
    expect(productionProblems({ ...PROD_OK, PV_STORE: 'memory' }).errors.join()).toContain('PV_STORE=memory');
    expect(productionProblems({ ...PROD_OK, PV_SESSION_SECRET: 'dev-only-change-me' }).errors.join()).toContain('PV_SESSION_SECRET');
    expect(productionProblems({ ...PROD_OK, PV_ADMIN_TOKEN: 'curto' }).errors.join()).toContain('PV_ADMIN_TOKEN');
    expect(productionProblems({ ...PROD_OK, PV_ADMIN_TOKEN: STRONG }).errors.join()).toContain('diferentes');
    expect(productionProblems({ ...PROD_OK, PV_PUBLIC_ORIGIN: 'https://x.com/' }).errors.join()).toContain('PV_PUBLIC_ORIGIN');
    expect(productionProblems({ ...PROD_OK, PV_REGISTRATION: 'open' }).errors.join()).toContain('PV_REGISTRATION');
    expect(productionProblems({ ...PROD_OK, DATABASE_URL: '' }).errors.join()).toContain('DATABASE_URL');
    expect(productionProblems({ ...PROD_OK, PV_TRUST_PROXY: '' }).warnings.join()).toContain('PV_TRUST_PROXY');
  });
  it('segredo fraco: curto, de exemplo, repetitivo', () => {
    expect(weakSecret('a'.repeat(40))).toMatch(/variedade/);
    expect(weakSecret('change-me-please-0123456789abcdefgh')).toMatch(/exemplo/);
    expect(weakSecret(STRONG)).toBeNull();
  });
});

describe('logs estruturados', () => {
  it('descarta senha, token, cookie, código, ticket, e-mail e IP; e-mail em texto vira [email]', () => {
    const f = scrub({ password: 'x', senha: 'x', adminToken: 'x', cookie: 'x', code: '123456', ticket: 't', email: 'a@b.com', ip: '1.2.3.4', otpHash: 'h', route: '/api/x', closeCode: 4001, fails: 6, msg: 'falhou para joao@exemplo.com.br' });
    expect(Object.keys(f).sort()).toEqual(['closeCode', 'fails', 'msg', 'route']);
    expect(f.msg).toBe('falhou para [email]');
  });
  it('linha JSON válida com t/level/evt', () => {
    const j = JSON.parse(formatJson('warn', 'auth.suspicious', 'login de x@y.org', { fails: 6, password: 'nunca' }));
    expect(j).toMatchObject({ level: 'warn', evt: 'auth.suspicious', msg: 'login de [email]', fails: 6 });
    expect(j.password).toBeUndefined();
    expect(typeof j.t).toBe('string');
  });
});

describe('IP do cliente atrás do proxy (PV_TRUST_PROXY)', () => {
  const h = { 'x-forwarded-for': '6.6.6.6, 203.0.113.7', 'x-real-ip': '203.0.113.7' };
  it('sem a variável: sempre o socket (cabeçalho forjado ignorado)', () => {
    expect(clientIp(h, '127.0.0.1', undefined)).toBe('127.0.0.1');
    expect(clientIp(h, '198.51.100.2', undefined)).toBe('198.51.100.2');
  });
  it('loopback: confia SÓ quando a conexão vem de 127.0.0.1/::1; X-Real-IP, senão o ÚLTIMO X-Forwarded-For', () => {
    expect(clientIp(h, '127.0.0.1', 'loopback')).toBe('203.0.113.7');
    expect(clientIp({ 'x-forwarded-for': '6.6.6.6, 203.0.113.8' }, '::1', 'loopback')).toBe('203.0.113.8');
    expect(clientIp(h, '198.51.100.2', 'loopback')).toBe('198.51.100.2'); // de fora: forjado ignorado
  });
});

describe('Origin / Sec-Fetch-Site (CSRF em rotas que mudam estado)', () => {
  const env = { NODE_ENV: 'production', PV_PUBLIC_ORIGIN: 'https://tretario.example' };
  it('produção: POST de outra origem recusado; mesma origem e sem cabeçalho (CLI) passam; GET sempre passa', () => {
    expect(originAllowed('POST', { origin: 'https://evil.example' }, env)).toBe(false);
    expect(originAllowed('POST', { origin: 'null' }, env)).toBe(false);
    expect(originAllowed('PUT', { origin: 'https://tretario.example' }, env)).toBe(true);
    expect(originAllowed('POST', { 'sec-fetch-site': 'cross-site' }, env)).toBe(false);
    expect(originAllowed('POST', { 'sec-fetch-site': 'same-origin' }, env)).toBe(true);
    expect(originAllowed('DELETE', {}, env)).toBe(true);
    expect(originAllowed('GET', { origin: 'https://evil.example' }, env)).toBe(true);
  });
  it('desenvolvimento sem PV_PUBLIC_ORIGIN: proxy do Vite, sem checagem', () => {
    expect(originAllowed('POST', { origin: 'http://192.168.0.5:5173' }, { NODE_ENV: 'development' })).toBe(true);
  });
  it('cookie de sessão: HttpOnly + SameSite=Lax sempre; Secure em produção', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try { expect(cookie('pv_sid', 'abc', 60)).toMatch(/HttpOnly; SameSite=Lax; Max-Age=60; Secure$/); } finally { vi.unstubAllEnvs(); }
    expect(cookie('pv_sid', 'abc', 60)).not.toContain('Secure');
  });
});

describe('endpoint e protocolo', () => {
  it('produção: mesma origem /game (wss em https, ws em http)', () => {
    expect(sameOriginEndpoint('https:', 'tretario.example')).toBe('wss://tretario.example/game');
    expect(sameOriginEndpoint('http:', '10.0.0.2:8080')).toBe('ws://10.0.0.2:8080/game');
  });
  it('códigos de recusa distintos (4010 protocolo ≠ 4020 sessão substituída)', () => {
    expect(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 1).toBe(true);
    expect(new Set(Object.values(JOIN_ERROR)).size).toBe(Object.keys(JOIN_ERROR).length);
    expect(JOIN_ERROR.protocol).toBe(4010);
  });
});

describe('cadastro BETA sem SMTP (PV_REGISTRATION=beta)', () => {
  const FAST = { logN: 10, r: 8, p: 1 };
  let store: MemoryDataStore, auth: AuthService, sent: number;
  const req = (body: unknown = {}, cookies: Record<string, string> = {}) => ({ body, cookies, ip: '10.0.0.9', headers: { 'user-agent': 'vitest' } });
  const sid = (res: { cookies?: string[] }) => parseCookies(res.cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0]);
  beforeEach(() => {
    vi.stubEnv('PV_REGISTRATION', 'beta');
    vi.stubEnv('PV_DEV_MAIL', '1');
    store = new MemoryDataStore();
    sent = 0;
    const mail = new BetaHoldMailProvider();
    const orig = mail.send.bind(mail);
    mail.send = async (m) => { sent++; return orig(m); };
    auth = new AuthService({ store, tickets: new TicketService(), mail, secret: 'segredo-de-teste', currentEventId: () => 'manifestacao', scrypt: FAST });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('cadastro cria conta PENDENTE; nenhum código gerado/enviado/devolvido; outbox de dev inexistente', async () => {
    expect(registrationMode()).toBe('beta');
    expect(devOutboxEnabled()).toBe(false); // mesmo com PV_DEV_MAIL=1
    const r = await auth.register(req({ email: 'bia@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Bia_RJ' }));
    expect(r.status).toBe(201);
    const body = JSON.stringify(r.body);
    expect(body).not.toMatch(/\b\d{6}\b/); // nenhum código no corpo
    expect((r.body as { me: { registration?: string; user: { emailVerified: boolean } } }).me).toMatchObject({ registration: 'beta', user: { emailVerified: false } });
    expect(sent).toBe(0);
    const u = await store.users.byEmail('bia@exemplo.test');
    expect(await store.codes.latest(u!.id, 'EMAIL_VERIFY')).toBeNull();
    const c = sid(r);
    expect((await auth.verifyEmail(req({ code: '000000' }, c))).body).toMatchObject({ error: 'aguardando_liberacao' });
    expect((await auth.resendCode(req({}, c))).body).toMatchObject({ error: 'aguardando_liberacao' });
    expect((await auth.ticket(req({ role: 'player' }, c))).body).toMatchObject({ error: 'aguardando_liberacao' });
    // esqueci a senha: mesma resposta genérica, nada sai
    expect((await auth.forgot(req({ email: 'bia@exemplo.test' }))).body).toMatchObject({ ok: true });
    expect(sent).toBe(0);
  });

  it('prod:approve libera (verificado, auditado) e --grant vira PLAYER; promote/demote STAFF', async () => {
    const r = await auth.register(req({ email: 'caio@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Caio_RJ' }));
    const c = sid(r);
    const ctx = { store, actor: 'cli:teste' };
    await expect(approveBeta(ctx, 'ninguem@exemplo.test')).rejects.toBeInstanceOf(AdminError);
    expect(await approveBeta(ctx, 'Caio@Exemplo.test')).toEqual({ verified: true, grantId: null });
    const me1 = (await auth.me(req({}, c))).body as { registration?: string; access: { state: string } };
    expect(me1.registration).toBeUndefined();
    expect(me1.access.state).toBe('REGISTERED');
    expect((await auth.ticket(req({ role: 'player' }, c))).body).toMatchObject({ role: 'spectator' });
    const a2 = await approveBeta(ctx, 'caio@exemplo.test', { grant: true });
    expect(a2.verified).toBe(false); expect(a2.grantId).toBeTruthy();
    expect((await auth.ticket(req({ role: 'player' }, c))).body).toMatchObject({ role: 'player' });
    await promoteStaff(ctx, 'caio@exemplo.test');
    await expect(promoteStaff(ctx, 'caio@exemplo.test')).rejects.toBeInstanceOf(AdminError);
    expect(((await auth.me(req({}, c))).body as { access: { grant: string } }).access.grant).toBe('STAFF');
    expect(await demoteStaff(ctx, 'caio@exemplo.test')).toBe(1);
    const acts = (await store.audit.list()).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['BETA_APPROVE', 'GRANT_ACCESS', 'REVOKE_ACCESS']));
    for (const a of await store.audit.list()) expect(JSON.stringify(a.meta)).not.toMatch(/@|Copacabana/);
  });
});

describe('cadastro LIVRE sem SMTP (PV_REGISTRATION=livre — cadastrou, já joga)', () => {
  const FAST = { logN: 10, r: 8, p: 1 };
  let store: MemoryDataStore, auth: AuthService, sent: number;
  const req = (body: unknown = {}, cookies: Record<string, string> = {}) => ({ body, cookies, ip: '10.0.0.9', headers: { 'user-agent': 'vitest' } });
  const sid = (res: { cookies?: string[] }) => parseCookies(res.cookies?.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0]);
  const mk = () => {
    store = store ?? new MemoryDataStore();
    sent = 0;
    const mail = new BetaHoldMailProvider();
    mail.send = async () => { sent++; };
    auth = new AuthService({ store, tickets: new TicketService(), mail, secret: 'segredo-de-teste', currentEventId: () => 'manifestacao', scrypt: FAST });
  };
  beforeEach(() => { store = undefined as unknown as MemoryDataStore; });
  afterEach(() => vi.unstubAllEnvs());

  it('produção aceita PV_REGISTRATION=livre (e continua recusando open)', () => {
    expect(productionProblems({ ...PROD_OK, PV_REGISTRATION: 'livre' }).errors).toEqual([]);
    expect(productionProblems({ ...PROD_OK, PV_REGISTRATION: 'open' }).errors.join()).toContain('PV_REGISTRATION');
  });

  it('cadastro já sai verificado e PLAYER; ticket de jogador na hora; nenhum código; auditado', async () => {
    vi.stubEnv('PV_REGISTRATION', 'livre'); vi.stubEnv('PV_DEV_MAIL', '1');
    mk();
    expect(registrationMode()).toBe('livre');
    expect(devOutboxEnabled()).toBe(false);
    const r = await auth.register(req({ email: 'dani@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Dani_RJ' }));
    expect(r.status).toBe(201);
    const me = (r.body as { me: { registration?: string; access: { state: string }; user: { emailVerified: boolean } } }).me;
    expect(me.registration).toBeUndefined();
    expect(me.user.emailVerified).toBe(true);
    expect(me.access.state).toBe('PLAYER');
    expect(JSON.stringify(r.body)).not.toMatch(/\b\d{6}\b/);
    expect(sent).toBe(0);
    expect((await auth.ticket(req({ role: 'player' }, sid(r)))).body).toMatchObject({ role: 'player' });
    const audit = (await store.audit.list()).filter((a) => a.action === 'auth.auto_release');
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ verified: true, granted: true });
    // idempotente: login de novo não cria outra concessão
    await auth.login(req({ email: 'dani@exemplo.test', password: 'Copacabana!42' }));
    const u = await store.users.byEmail('dani@exemplo.test');
    expect((await store.access.active(u!.id, null, new Date())).length).toBe(1);
  });

  it('pendente do modo beta é liberado ao voltar (GET /api/me) com o modo livre; banido nunca', async () => {
    vi.stubEnv('PV_REGISTRATION', 'beta');
    mk();
    const r = await auth.register(req({ email: 'edu@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Edu_RJ' }));
    const r2 = await auth.register(req({ email: 'fabi@exemplo.test', password: 'Copacabana!42', confirm: 'Copacabana!42', nickname: 'Fabi_RJ' }));
    expect((await auth.ticket(req({ role: 'player' }, sid(r)))).body).toMatchObject({ error: 'aguardando_liberacao' });
    const fabi = await store.users.byEmail('fabi@exemplo.test');
    await store.users.update(fabi!.id, { status: 'BANNED' });
    vi.stubEnv('PV_REGISTRATION', 'livre'); // a VPS troca o modo e reinicia
    mk();
    const me = (await auth.me(req({}, sid(r)))).body as { access: { state: string }; user: { emailVerified: boolean } };
    expect(me.user.emailVerified).toBe(true);
    expect(me.access.state).toBe('PLAYER');
    expect((await auth.ticket(req({ role: 'player' }, sid(r)))).body).toMatchObject({ role: 'player' });
    const f = await auth.releaseIfFree((await store.users.byEmail('fabi@exemplo.test'))!);
    expect(f.emailVerified).toBe(false);
    expect((await store.access.active(f.id, null, new Date())).length).toBe(0);
    void r2;
  });
});

