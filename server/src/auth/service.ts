/**
 * Autenticação e sessão (rodada 8) — lógica dos endpoints /api/auth/*, /api/me, /api/session/ticket e apelido.
 * Independente de HTTP (recebe o pedido já lido, devolve status/corpo/cookies), para testar sem rede.
 *
 * Regras de segurança (docs/AUTH.md):
 *  - mensagens genéricas no login ("credenciais_invalidas") e no esqueci-a-senha (sempre a mesma resposta)
 *  - força bruta: backoff exponencial por e-mail e por IP (HMAC em memória — IP nunca vai ao banco)
 *  - senhas só como scrypt; códigos e tokens só como hash
 *  - o cliente nunca vira PLAYER sozinho: o estado vem de AccountAccess (só a CLI de operador concede nesta rodada)
 */
import { autonomousNicknameTaken } from '../autonomous/names'; // rodada 12 — apelidos reservados dos autônomos
import type { ApiRequest, ApiResponse } from '../http/router';
import type { DataStore, UserRecord } from '../data/types';
import type { TicketService } from '../identity/tickets';
import type { AccessGrant, MeResponse, PlayerPreferences } from '../../../src/identity/types';
import { bestGrant, can, deriveAccessState, resolveRole } from '../../../src/access/policy';
import { textModeration, type TextRejection } from '../../../src/moderation/text';
import { checkPasswordPolicy, DEFAULT_SCRYPT, type ScryptParams } from './password';
import { EmailPasswordProvider, normalizeEmail } from './providers';
import { SessionService, type ActiveSession } from './session';
import { CodeService } from './codes';
import { codeMail, isProduction, registrationMode, type MailProvider } from './mail';
import { Backoff, ipKey, Window } from './rateLimit';
import { log } from '../log';

type Req = Pick<ApiRequest, 'body' | 'cookies' | 'ip' | 'headers'> & { query?: URLSearchParams };

export interface AuthConfig {
  store: DataStore;
  tickets: TicketService;
  mail: MailProvider;
  /** segredo do servidor (HMAC dos códigos) */
  secret: string;
  currentEventId: () => string;
  scrypt?: ScryptParams;
  now?: () => number;
}

const NICK_ERRORS: Record<TextRejection, string> = {
  vazio: 'apelido_vazio', curto: 'apelido_curto', longo: 'apelido_longo', bloqueado: 'apelido_bloqueado',
  spam: 'apelido_bloqueado', caracteres: 'apelido_caracteres', reservado: 'apelido_reservado',
};

const err = (status: number, error: string, extra: Record<string, unknown> = {}, cookies?: string[]): ApiResponse => ({ status, body: { error, ...extra }, cookies });
const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const str = (x: unknown) => (typeof x === 'string' ? x : '');

/** segredo do servidor: obrigatório e forte em produção; padrão fixo só em desenvolvimento */
export function serverSecret(): string {
  const s = process.env.PV_SESSION_SECRET ?? '';
  if (isProduction() && (s.length < 32 || s.startsWith('dev-only'))) throw new Error('PV_SESSION_SECRET ausente ou fraco em produção');
  return s || 'dev-only-change-me';
}

export class AuthService {
  readonly sessions: SessionService;
  readonly codes: CodeService;
  readonly email: EmailPasswordProvider;
  private now: () => number;
  // limites (memória do processo)
  private loginEmail = new Backoff({ free: 5, baseMs: 1000, maxMs: 15 * 60_000, forgetMs: 60 * 60_000 });
  private loginIp = new Backoff({ free: 20, baseMs: 1000, maxMs: 15 * 60_000, forgetMs: 60 * 60_000 });
  private resetEmail = new Backoff({ free: 5, baseMs: 2000, maxMs: 30 * 60_000, forgetMs: 60 * 60_000 });
  private registerIp = new Window({ max: 10, windowMs: 60 * 60_000 });
  private forgotIp = new Window({ max: 10, windowMs: 60 * 60_000 });
  private forgotEmail = new Window({ max: 3, windowMs: 60 * 60_000 });
  private resendQuick = new Window({ max: 1, windowMs: 60_000 });
  private resendHour = new Window({ max: 5, windowMs: 60 * 60_000 });
  private nickProbe = new Window({ max: 60, windowMs: 60_000 });
  private nickChange = new Window({ max: 3, windowMs: 24 * 60 * 60_000 });
  /** rodada 9.1 — tickets de entrada por conta (cada entrada/reentrada pede um; 30/min cobre reconexões com folga) */
  private ticketUser = new Window({ max: 30, windowMs: 60_000 });

  constructor(private c: AuthConfig) {
    this.now = c.now ?? Date.now;
    this.sessions = new SessionService(c.store, this.now);
    this.codes = new CodeService(c.store, c.secret, this.now);
    this.email = new EmailPasswordProvider(c.store, c.scrypt ?? DEFAULT_SCRYPT);
  }

  private get store() { return this.c.store; }

  /** limpeza dos limites em memória (CleanupService): chaves esquecidas/sem evento na janela. Devolve quantas */
  sweepLimits(now = this.now()): number {
    let n = 0;
    for (const b of [this.loginEmail, this.loginIp, this.resetEmail]) n += b.sweep(now);
    for (const w of [this.registerIp, this.forgotIp, this.forgotEmail, this.resendQuick, this.resendHour, this.nickProbe, this.nickChange, this.ticketUser]) n += w.sweep(now);
    return n;
  }

  // ------------------------------------------------------------------ cadastro livre (PV_REGISTRATION=livre)

  /**
   * Cadastro livre: conta ativa sai verificada e com concessão de jogador (DEV_GRANTED global, sem validade), como o
   * `prod:approve --grant` da equipe, só que automático — no cadastro, no login e quando um pendente antigo volta
   * (GET /api/me, ticket). Idempotente; nunca mexe em conta banida/suspensa; grava AuditLog `auth.auto_release`.
   */
  async releaseIfFree(user: UserRecord): Promise<UserRecord> {
    if (registrationMode() !== 'livre' || user.status !== 'ACTIVE') return user;
    const now = new Date(this.now());
    let u = user;
    const verified = !u.emailVerified;
    if (verified) u = await this.store.users.update(u.id, { emailVerified: true });
    const grants = (await this.store.access.active(u.id, null, now)).map((g) => g.grant);
    const granted = bestGrant(grants) === 'NONE';
    if (granted) await this.store.access.grant({ userId: u.id, grant: 'DEV_GRANTED', eventId: null, source: 'auto:cadastro-livre', expiresAt: null });
    if (verified || granted) await this.store.audit.append({ actor: 'system:cadastro-livre', action: 'auth.auto_release', targetType: 'user', targetId: u.id, meta: { verified, granted } });
    return u;
  }

  // ------------------------------------------------------------------ DTO do próprio usuário

  async accessOf(user: UserRecord) {
    const grants: AccessGrant[] = (await this.store.access.active(user.id, this.c.currentEventId(), new Date(this.now()))).map((g) => g.grant);
    return { state: deriveAccessState({ status: user.status, suspendedUntil: user.suspendedUntil, grants }, this.now()), grant: bestGrant(grants) };
  }

  /** MeResponse: só dados do PRÓPRIO usuário (sem e-mail, sem ids internos) */
  async meOf(user: UserRecord): Promise<MeResponse> {
    const eventId = this.c.currentEventId();
    const [profile, app, mem, access] = await Promise.all([
      this.store.profiles.byUserId(user.id), this.store.appearances.get(user.id), this.store.events.membership(user.id, eventId), this.accessOf(user),
    ]);
    // `chatMuted` (mute por apelido, antes da 8.1) é ignorado: os mutes vivem em MuteRelationship
    const { chatMuted: _old, ...preferences } = (profile?.preferences ?? {}) as PlayerPreferences & { chatMuted?: unknown };
    return {
      authenticated: true,
      user: { nickname: profile?.nickname ?? null, emailVerified: user.emailVerified, status: user.status, createdAt: user.createdAt.toISOString() },
      access,
      appearance: (app?.data as MeResponse['appearance']) ?? null,
      preferences,
      membership: mem ? { eventId: mem.eventId, groupKey: mem.groupId.slice(mem.groupId.indexOf(':') + 1) } : null,
      // rodada 9.1 — cadastro beta: conta pendente até a equipe liberar (o cliente explica; nada de código)
      ...(!user.emailVerified && registrationMode() === 'beta' ? { registration: 'beta' as const } : {}),
    };
  }

  static readonly visitor: MeResponse = { authenticated: false, access: { state: 'VISITOR', grant: 'NONE' } };

  /** sessão do cookie (para outros módulos da API: perfil, aparência, grupo…) */
  session(req: Pick<Req, 'cookies'>): Promise<ActiveSession | null> { return this.sessions.resolve(req.cookies); }

  // ------------------------------------------------------------------ apelido

  /** valida apelido (moderação central) e unicidade pela chave normalizada (acentos/maiúsculas/leet/símbolos) */
  async checkNickname(raw: unknown, exceptUserId?: string): Promise<{ ok: true; nickname: string; key: string } | { ok: false; error: string }> {
    const v = textModeration.check(typeof raw === 'string' ? raw.trim() : '', 'nickname');
    if (!v.ok) return { ok: false, error: NICK_ERRORS[v.reason] };
    const key = textModeration.nicknameKey(v.text);
    // rodada 12 — apelido em uso por um personagem autônomo vivo: reservado (ninguém se confunde com um autônomo)
    if (autonomousNicknameTaken(key)) return { ok: false, error: 'apelido_em_uso' };
    const owner = await this.store.profiles.byNicknameKey(key);
    if (owner && owner.userId !== exceptUserId) return { ok: false, error: 'apelido_em_uso' };
    return { ok: true, nickname: v.text, key };
  }

  async nicknameAvailable(req: Req): Promise<ApiResponse> {
    if (!this.nickProbe.hit(ipKey(req.ip), this.now())) { log.rate('nickname_available'); return err(429, 'muitas_tentativas', { retryAfterS: 60 }); }
    const r = await this.checkNickname(req.query?.get('n') ?? '');
    return { body: r.ok ? { available: true, nickname: r.nickname } : { available: false, reason: r.error } };
  }

  async changeNickname(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (!s) return err(401, 'sem_sessao');
    const { state } = await this.accessOf(s.user);
    if (!can(state, 'profile.edit')) return err(403, 'sem_permissao');
    const r = await this.checkNickname(req.body?.nickname, s.user.id);
    if (!r.ok) return err(400, r.error);
    const cur = await this.store.profiles.byUserId(s.user.id);
    if (cur?.nickname === r.nickname) return { body: { ok: true, me: await this.meOf(s.user) } };
    // troca rara: dificulta "pular" de nome em nome para se passar por outra pessoa
    if (!this.nickChange.hit(s.user.id, this.now())) { log.rate('nickname_change'); return err(429, 'troca_de_apelido_limitada'); }
    try {
      if (cur) await this.store.profiles.update(s.user.id, { nickname: r.nickname, nicknameKey: r.key });
      else await this.store.profiles.create({ userId: s.user.id, nickname: r.nickname, nicknameKey: r.key });
    } catch (e) { if (isUnique(e)) return err(409, 'apelido_em_uso'); throw e; }
    await this.store.audit.append({ actor: `user:${s.user.id}`, action: 'profile.nickname', targetType: 'user', targetId: s.user.id, meta: { from: cur?.nickname ?? null, to: r.nickname } });
    return { body: { ok: true, me: await this.meOf(s.user) }, cookies: s.refresh ? [s.refresh] : undefined };
  }

  // ------------------------------------------------------------------ cadastro / verificação

  async register(req: Req): Promise<ApiResponse> {
    const b = req.body ?? {};
    if (!this.registerIp.hit(ipKey(req.ip), this.now())) return log.rate('register'), err(429, 'muitas_tentativas', { retryAfterS: Math.ceil(this.registerIp.retryIn(ipKey(req.ip), this.now()) / 1000) });
    const email = normalizeEmail(b.email);
    if (!email) return err(400, 'email_invalido');
    if (str(b.password) !== str(b.confirm)) return err(400, 'senhas_diferentes');
    const pw = checkPasswordPolicy(b.password, { email, nickname: str(b.nickname) });
    if (pw) return err(400, pw);
    const nick = await this.checkNickname(b.nickname);
    if (!nick.ok) return err(nick.error === 'apelido_em_uso' ? 409 : 400, nick.error);

    let user = await this.store.users.byEmail(email);
    const passwordHash = await this.email.hash(b.password);
    if (user) {
      // cadastro incompleto (conta sem perfil e não verificada — ex.: corrida no apelido): pode ser retomado
      if (user.emailVerified || (await this.store.profiles.byUserId(user.id))) return err(409, 'email_em_uso');
      user = await this.store.users.update(user.id, { passwordHash });
    } else {
      try { user = await this.store.users.create({ email, passwordHash }); }
      catch (e) { if (isUnique(e)) return err(409, 'email_em_uso'); throw e; }
    }
    try { await this.store.profiles.create({ userId: user.id, nickname: nick.nickname, nicknameKey: nick.key }); }
    catch (e) { if (isUnique(e)) return err(409, 'apelido_em_uso'); throw e; }

    await this.sendCode(user, 'EMAIL_VERIFY');
    await this.store.audit.append({ actor: `user:${user.id}`, action: 'auth.register', targetType: 'user', targetId: user.id, meta: {} });
    user = await this.releaseIfFree(user); // cadastro livre: já entra jogando
    const sess = await this.sessions.create(user.id, req.headers?.['user-agent']);
    return { status: 201, body: { ok: true, me: await this.meOf(user) }, cookies: [sess.cookie] };
  }

  private async sendCode(user: UserRecord, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET') {
    // rodada 9.1 — beta sem SMTP: nenhum código é gerado (ninguém o receberia; nunca aparece ao visitante)
    if (registrationMode() === 'livre') return; // sem SMTP e sem espera: a conta já foi liberada (releaseIfFree)
    if (registrationMode() === 'beta') { log.info('auth.pending', purpose === 'EMAIL_VERIFY' ? 'cadastro aguardando liberação da equipe' : 'pedido de nova senha sem e-mail (beta)', { purpose }); return; }
    const code = await this.codes.issue(user.id, purpose);
    try { await this.c.mail.send(codeMail(user.email, purpose, code)); }
    catch (e) { log.error('error', 'falha ao enviar e-mail', { err: e as Error }); }
  }

  async verifyEmail(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (!s) return err(401, 'sem_sessao');
    if (s.user.emailVerified) return { body: { ok: true, me: await this.meOf(s.user) } };
    if (registrationMode() === 'beta') return err(403, 'aguardando_liberacao'); // rodada 9.1: não há código no beta
    const r = await this.codes.check(s.user.id, 'EMAIL_VERIFY', req.body?.code);
    if (r === 'expirado') return err(400, 'codigo_expirado');
    if (r === 'invalido') return err(400, 'codigo_invalido');
    const user = await this.store.users.update(s.user.id, { emailVerified: true });
    await this.store.audit.append({ actor: `user:${user.id}`, action: 'auth.email_verified', targetType: 'user', targetId: user.id, meta: {} });
    return { body: { ok: true, me: await this.meOf(user) } };
  }

  async resendCode(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (!s) return err(401, 'sem_sessao');
    if (s.user.emailVerified) return err(400, 'ja_verificado');
    if (registrationMode() === 'beta') return err(403, 'aguardando_liberacao');
    const now = this.now();
    if (!this.resendQuick.hit(s.user.id, now)) return log.rate('resend_code'), err(429, 'aguarde', { retryAfterS: Math.ceil(this.resendQuick.retryIn(s.user.id, now) / 1000) });
    if (!this.resendHour.hit(s.user.id, now)) return log.rate('resend_code'), err(429, 'aguarde', { retryAfterS: Math.ceil(this.resendHour.retryIn(s.user.id, now) / 1000) });
    await this.sendCode(s.user, 'EMAIL_VERIFY');
    return { body: { ok: true } };
  }

  // ------------------------------------------------------------------ login / logout / me

  async login(req: Req): Promise<ApiResponse> {
    const email = normalizeEmail(req.body?.email) ?? '';
    const ek = `e:${email}`, ik = ipKey(req.ip), now = this.now();
    const wait = Math.max(this.loginEmail.wait(ek, now), this.loginIp.wait(ik, now));
    if (wait > 0) { log.rate('login'); return err(429, 'muitas_tentativas', { retryAfterS: Math.ceil(wait / 1000) }); }
    const password = str(req.body?.password);
    const user = email && password && password.length <= 128 ? await this.email.authenticate(email, password) : null;
    if (!user) {
      this.loginEmail.fail(ek, now); this.loginIp.fail(ik, now);
      // rodada 9.1 — login suspeito: ao começar o bloqueio e a cada 10 falhas seguidas (sem e-mail nem IP no log)
      const fe = this.loginEmail.count(ek), fi = this.loginIp.count(ik);
      if (fe === 6 || (fe > 6 && fe % 10 === 0)) log.warn('auth.suspicious', 'falhas repetidas de login na mesma conta', { scope: 'conta', fails: fe });
      if (fi === 21 || (fi > 21 && fi % 20 === 0)) log.warn('auth.suspicious', 'falhas repetidas de login do mesmo endereço', { scope: 'origem', fails: fi });
      return err(401, 'credenciais_invalidas');
    }
    this.loginEmail.reset(ek);
    const u = await this.releaseIfFree(await this.store.users.update(user.id, { lastLoginAt: new Date(now) }));
    const sess = await this.sessions.create(u.id, req.headers?.['user-agent']);
    return { body: { ok: true, me: await this.meOf(u) }, cookies: [sess.cookie] };
  }

  async logout(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (s) await this.sessions.revoke(s.session.id);
    return { body: { ok: true }, cookies: [this.sessions.clearCookie()] };
  }

  async me(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (!s) return { body: AuthService.visitor, cookies: req.cookies?.pv_sid ? [this.sessions.clearCookie()] : undefined };
    const user = s.user.emailVerified ? s.user : await this.releaseIfFree(s.user); // pendente que voltou (cadastro livre)
    return { body: await this.meOf(user), cookies: s.refresh ? [s.refresh] : undefined };
  }

  // ------------------------------------------------------------------ esqueci a senha

  /** SEMPRE a mesma resposta, exista ou não a conta (não revela cadastro) */
  async forgot(req: Req): Promise<ApiResponse> {
    const now = this.now();
    if (!this.forgotIp.hit(ipKey(req.ip), now)) return log.rate('forgot'), err(429, 'muitas_tentativas', { retryAfterS: Math.ceil(this.forgotIp.retryIn(ipKey(req.ip), now) / 1000) });
    const same: ApiResponse = { body: { ok: true, message: 'Se houver uma conta com este e-mail, enviamos um código.' } };
    const email = normalizeEmail(req.body?.email);
    if (!email) return same;
    if (!this.forgotEmail.hit(email, now)) return same; // limite silencioso por e-mail
    const user = await this.store.users.byEmail(email);
    if (user && user.status !== 'BANNED') await this.sendCode(user, 'PASSWORD_RESET');
    return same;
  }

  async reset(req: Req): Promise<ApiResponse> {
    const b = req.body ?? {};
    const email = normalizeEmail(b.email) ?? '';
    const ek = `r:${email}`, ik = ipKey(req.ip), now = this.now();
    const wait = Math.max(this.resetEmail.wait(ek, now), this.loginIp.wait(ik, now));
    if (wait > 0) { log.rate('reset'); return err(429, 'muitas_tentativas', { retryAfterS: Math.ceil(wait / 1000) }); }
    if (b.confirm !== undefined && str(b.password) !== str(b.confirm)) return err(400, 'senhas_diferentes');
    const pw = checkPasswordPolicy(b.password, { email });
    if (pw) return err(400, pw);
    const user = email ? await this.store.users.byEmail(email) : null;
    const r = user ? await this.codes.check(user.id, 'PASSWORD_RESET', b.code) : 'invalido';
    if (!user || r !== 'ok') {
      this.resetEmail.fail(ek, now); this.loginIp.fail(ik, now);
      return err(400, 'codigo_invalido'); // genérico: não diz se a conta existe
    }
    this.resetEmail.reset(ek);
    // provou acesso à caixa de e-mail → e-mail verificado; todas as sessões antigas caem
    await this.store.users.update(user.id, { passwordHash: await this.email.hash(b.password), emailVerified: true });
    const revoked = await this.store.sessions.revokeAllForUser(user.id);
    await this.store.audit.append({ actor: `user:${user.id}`, action: 'auth.password_reset', targetType: 'user', targetId: user.id, meta: { sessionsRevoked: revoked } });
    return { body: { ok: true }, cookies: [this.sessions.clearCookie()] };
  }

  // ------------------------------------------------------------------ ticket de entrada na sala

  /** exige sessão válida; o papel pedido é só um teto — a sala decide (resolveIdentity) */
  async ticket(req: Req): Promise<ApiResponse> {
    const s = await this.session(req);
    if (!s) return err(401, 'sem_sessao');
    if (!this.ticketUser.hit(s.user.id, this.now())) { log.rate('ticket'); return err(429, 'muitas_tentativas', { retryAfterS: Math.ceil(this.ticketUser.retryIn(s.user.id, this.now()) / 1000) }); }
    if (!s.user.emailVerified) s.user = await this.releaseIfFree(s.user); // cadastro livre: pendente antigo é liberado aqui
    if (!s.user.emailVerified) return err(403, registrationMode() === 'beta' ? 'aguardando_liberacao' : 'email_nao_verificado');
    const access = await this.accessOf(s.user);
    const requested = req.body?.role === 'spectator' ? 'spectator' : 'player';
    const role = resolveRole(access.state, requested);
    if (!role) return err(403, 'banido');
    const ticket = this.c.tickets.issue({ userId: s.user.id, authSessionId: s.session.id, role: requested }, this.now());
    return { body: { ticket, expiresInS: 60, role, access }, cookies: s.refresh ? [s.refresh] : undefined };
  }
}
