/**
 * Diálogo de conta (rodada 8): CRIAR CONTA, VERIFICAR E-MAIL, ENTRAR, ESQUECI MINHA SENHA (e-mail → código → nova
 * senha). Só chama a API (src/identity/client.ts); a autenticação é do servidor. Acessível: rótulos, foco no
 * primeiro campo, Enter envia, Esc fecha, mensagens em região aria-live. Nada de token no navegador: cookie HttpOnly.
 */
import { accountApi, errorText } from '../identity/client';
import { textModeration, TEXT_LIMITS, type TextRejection } from '../moderation/text';

export type AccountView = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

const NICK_REASON: Record<TextRejection, string> = {
  vazio: 'Escolha um apelido.',
  curto: `Mínimo de ${TEXT_LIMITS.nickname.min} caracteres.`,
  longo: `Máximo de ${TEXT_LIMITS.nickname.max} caracteres.`,
  caracteres: 'Use só letras, números, ponto, hífen ou sublinhado (sem espaços).',
  reservado: 'Este apelido é reservado. Escolha outro.',
  bloqueado: 'Este apelido não é permitido.',
  spam: 'Este apelido não é permitido.',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class AccountDialog {
  readonly root: HTMLElement;
  private card: HTMLElement;
  private view: AccountView = 'login';
  private email = '';
  /** senha do cadastro mantida SÓ em memória até o login automático depois da verificação */
  private pendingPassword = '';
  private lastFocus: Element | null = null;
  private nickTimer = 0;
  private nickSeq = 0;
  private resendAt = 0;
  /** chamado quando a pessoa entrou (sessão criada no servidor) */
  onAuthenticated: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'acct hidden';
    this.root.innerHTML = '<div class="acct-card" role="dialog" aria-modal="true" aria-labelledby="acct-title"></div>';
    this.card = this.root.firstElementChild as HTMLElement;
    parent.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      if (e.key === 'Tab') this.trapTab(e);
    });
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }

  open(view: AccountView, email?: string) {
    if (!this.isOpen) this.lastFocus = document.activeElement;
    if (email !== undefined) this.email = email;
    this.root.classList.remove('hidden');
    this.show(view);
  }

  close() {
    this.root.classList.add('hidden');
    this.pendingPassword = '';
    (this.lastFocus as HTMLElement | null)?.focus?.();
  }

  private trapTab(e: KeyboardEvent) {
    const f = Array.from(this.card.querySelectorAll<HTMLElement>('button, input, a[href]')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ------------------------------------------------------------------ montagem das telas
  private show(view: AccountView, status = '', statusOk = false) {
    this.view = view;
    const em = esc(this.email);
    const pw = (id: string, label: string, auto: string) => `
      <label class="field"><span>${label}</span><div class="pw">
        <input id="${id}" name="${id}" type="password" autocomplete="${auto}" required minlength="8" maxlength="128" />
        <button type="button" data-toggle="${id}" aria-label="Mostrar senha">Mostrar</button></div></label>`;
    const emailField = (auto = 'email') => `<label class="field"><span>E-mail</span><input id="a-email" name="email" type="email" inputmode="email" autocomplete="${auto}" required maxlength="254" value="${em}" /></label>`;
    const devHint = import.meta.env.DEV
      ? '<p class="dev">Desenvolvimento: o código aparece no console do servidor e em <code>GET /api/dev/outbox</code>.</p>' : '';
    const body: Record<AccountView, string> = {
      login: `
        <span class="eyebrow">CONTA</span><h2 id="acct-title">Entrar</h2>
        <p class="lead">Seu personagem, seu grupo e suas preferências voltam em qualquer aparelho.</p>
        <form novalidate>${emailField()}${pw('a-pass', 'Senha', 'current-password')}
          <p class="status" role="alert"></p><button class="submit" type="submit">ENTRAR</button></form>
        <p class="alt"><button type="button" class="home-link" data-go="forgot">ESQUECI MINHA SENHA</button><button type="button" class="home-link" data-go="register">CRIAR CONTA</button></p>`,
      register: `
        <span class="eyebrow">PARTICIPAR</span><h2 id="acct-title">Criar conta</h2>
        <p class="lead">Grátis para criar. Você confirma o e-mail com um código de 6 dígitos.</p>
        <form novalidate>${emailField()}
          <label class="field"><span>Apelido</span><input id="a-nick" name="nickname" autocomplete="nickname" required minlength="3" maxlength="20" spellcheck="false" autocapitalize="off" aria-describedby="a-nick-hint" /></label>
          <p class="hint" id="a-nick-hint" aria-live="polite">Aparece acima do seu personagem. 3 a 20 caracteres.</p>
          ${pw('a-pass', 'Senha', 'new-password')}${pw('a-pass2', 'Confirmar senha', 'new-password')}
          <p class="status" role="alert"></p><button class="submit" type="submit">CRIAR CONTA</button></form>
        <p class="alt"><span>Já possui conta?</span><button type="button" class="home-link" data-go="login">ENTRAR</button></p>`,
      verify: `
        <span class="eyebrow">VERIFICAR E-MAIL</span><h2 id="acct-title">Digite o código</h2>
        <p class="lead">Enviamos um código de 6 dígitos para <b>${em || 'seu e-mail'}</b>.</p>
        <form novalidate>
          <label class="field"><span>Código</span><input id="a-code" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
          <p class="status" role="alert"></p><button class="submit" type="submit">VERIFICAR</button></form>
        <p class="alt"><button type="button" class="home-link" data-act="resend">REENVIAR CÓDIGO</button><button type="button" class="home-link" data-go="login">ENTRAR</button></p>${devHint}`,
      forgot: `
        <span class="eyebrow">ESQUECI MINHA SENHA</span><h2 id="acct-title">Recuperar acesso</h2>
        <p class="lead">Informe o e-mail da conta. Enviaremos um código para criar uma nova senha.</p>
        <form novalidate>${emailField()}<p class="status" role="alert"></p><button class="submit" type="submit">ENVIAR CÓDIGO</button></form>
        <p class="alt"><button type="button" class="home-link" data-go="login">VOLTAR PARA ENTRAR</button></p>`,
      reset: `
        <span class="eyebrow">NOVA SENHA</span><h2 id="acct-title">Criar nova senha</h2>
        <p class="lead">Digite o código enviado para <b>${em}</b> e a nova senha.</p>
        <form novalidate>
          <label class="field"><span>Código</span><input id="a-code" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required /></label>
          ${pw('a-pass', 'Nova senha', 'new-password')}${pw('a-pass2', 'Confirmar nova senha', 'new-password')}
          <p class="status" role="alert"></p><button class="submit" type="submit">SALVAR NOVA SENHA</button></form>
        <p class="alt"><button type="button" class="home-link" data-go="forgot">REENVIAR CÓDIGO</button><button type="button" class="home-link" data-go="login">ENTRAR</button></p>${devHint}`,
    };
    this.card.innerHTML = `<button type="button" class="acct-close" aria-label="Fechar">×</button>${body[view]}`;
    this.card.querySelector('.acct-close')!.addEventListener('click', () => this.close());
    for (const b of this.card.querySelectorAll<HTMLButtonElement>('[data-go]')) b.addEventListener('click', () => { this.keepEmail(); this.show(b.dataset.go as AccountView); });
    for (const b of this.card.querySelectorAll<HTMLButtonElement>('[data-toggle]')) {
      b.addEventListener('click', () => {
        const i = this.card.querySelector<HTMLInputElement>(`#${b.dataset.toggle}`)!;
        const showing = i.type === 'text';
        i.type = showing ? 'password' : 'text';
        b.textContent = showing ? 'Mostrar' : 'Ocultar';
        b.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
      });
    }
    this.card.querySelector('[data-act=resend]')?.addEventListener('click', () => void this.resend());
    const form = this.card.querySelector('form')!;
    form.addEventListener('submit', (e) => { e.preventDefault(); void this.submit(form); });
    const code = this.card.querySelector<HTMLInputElement>('#a-code');
    code?.addEventListener('input', () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6);
      if (code.value.length === 6 && view === 'verify') form.requestSubmit();
    });
    const nick = this.card.querySelector<HTMLInputElement>('#a-nick');
    nick?.addEventListener('input', () => this.checkNick(nick));
    if (status) this.setStatus(status, statusOk);
    const first = this.card.querySelector<HTMLInputElement>('input:not([value]), input[value=""]') ?? this.card.querySelector<HTMLInputElement>('input');
    requestAnimationFrame(() => first?.focus());
  }

  private keepEmail() {
    const e = this.card.querySelector<HTMLInputElement>('#a-email');
    if (e) this.email = e.value.trim();
  }

  private setStatus(msg: string, ok = false) {
    const s = this.card.querySelector<HTMLElement>('.status');
    if (!s) return;
    s.textContent = msg;
    s.classList.toggle('ok', ok);
    s.setAttribute('role', ok ? 'status' : 'alert');
  }

  private busy(on: boolean) {
    const b = this.card.querySelector<HTMLButtonElement>('.submit');
    if (b) b.disabled = on;
  }

  // ------------------------------------------------------------------ apelido: verificação ao vivo
  private checkNick(input: HTMLInputElement) {
    const hint = this.card.querySelector<HTMLElement>('#a-nick-hint')!;
    const set = (msg: string, cls: '' | 'ok' | 'bad') => { hint.textContent = msg; hint.className = `hint ${cls}`; input.setAttribute('aria-invalid', String(cls === 'bad')); };
    clearTimeout(this.nickTimer);
    const v = input.value;
    if (!v) { set('Aparece acima do seu personagem. 3 a 20 caracteres.', ''); return; }
    // prévia local (mesma moderação do servidor); o servidor decide a disponibilidade
    const local = textModeration.check(v, 'nickname');
    if (!local.ok) { set(NICK_REASON[local.reason], 'bad'); return; }
    set('Verificando disponibilidade…', '');
    const seq = ++this.nickSeq;
    this.nickTimer = window.setTimeout(async () => {
      const r = await accountApi.nicknameAvailable(v);
      if (seq !== this.nickSeq) return;
      if (!r.ok || !r.data) { set(r.status === 0 ? 'Não foi possível verificar agora.' : errorText(r.error), r.status === 0 ? '' : 'bad'); return; }
      if (r.data.available) set(`“${v}” está disponível.`, 'ok');
      else set(r.data.reason === 'reservado' || r.data.reason === 'apelido_reservado' ? NICK_REASON.reservado
        : r.data.reason && r.data.reason in NICK_REASON ? NICK_REASON[r.data.reason as TextRejection] : 'Este apelido já está em uso.', 'bad');
    }, 350);
  }

  // ------------------------------------------------------------------ envio
  private val(id: string) { return this.card.querySelector<HTMLInputElement>(`#${id}`)?.value ?? ''; }

  private async submit(form: HTMLFormElement) {
    this.keepEmail();
    const email = this.email;
    const needsEmail = this.view === 'login' || this.view === 'register' || this.view === 'forgot';
    if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.setStatus(errorText('email_invalido')); form.querySelector<HTMLInputElement>('#a-email')?.focus(); return; }
    const pass = this.val('a-pass'), pass2 = this.val('a-pass2'), code = this.val('a-code');
    if ((this.view === 'register' || this.view === 'reset') && pass.length < 8) { this.setStatus(errorText('senha_curta')); return; }
    if ((this.view === 'register' || this.view === 'reset') && pass !== pass2) { this.setStatus('As senhas não conferem.'); form.querySelector<HTMLInputElement>('#a-pass2')?.focus(); return; }
    if ((this.view === 'verify' || this.view === 'reset') && !/^\d{6}$/.test(code)) { this.setStatus('O código tem 6 dígitos.'); return; }
    if (this.view === 'register') {
      const n = textModeration.check(this.val('a-nick'), 'nickname');
      if (!n.ok) { this.setStatus(NICK_REASON[n.reason]); return; }
    }
    this.busy(true);
    this.setStatus('');
    try {
      switch (this.view) {
        case 'login': {
          const r = await accountApi.login(email, pass);
          if (r.ok) return this.done();
          if (r.error === 'email_nao_verificado') { this.pendingPassword = pass; void accountApi.resendCode(email); return this.show('verify', errorText(r.error)); }
          return this.setStatus(errorText(r.error));
        }
        case 'register': {
          const r = await accountApi.register(email, pass, this.val('a-nick'));
          if (!r.ok) return this.setStatus(errorText(r.error));
          this.pendingPassword = pass;
          this.resendAt = Date.now() + 30_000;
          return this.show('verify', 'Conta criada. Confira seu e-mail.', true);
        }
        case 'verify': {
          const r = await accountApi.verifyEmail(email, code);
          if (!r.ok) return this.setStatus(errorText(r.error));
          // a verificação pode já abrir a sessão; senão entra com a senha recém-digitada (só em memória)
          const me = await accountApi.me();
          if (me.data?.authenticated) return this.done();
          if (this.pendingPassword) {
            const l = await accountApi.login(email, this.pendingPassword);
            if (l.ok) return this.done();
          }
          return this.show('login', 'E-mail confirmado. Entre com sua senha.', true);
        }
        case 'forgot': {
          const r = await accountApi.forgot(email);
          // resposta igual para e-mail existente ou não (o servidor não revela contas)
          if (!r.ok && r.status !== 404) return this.setStatus(errorText(r.error));
          return this.show('reset', 'Se o e-mail tiver conta, o código chega em instantes.', true);
        }
        case 'reset': {
          const r = await accountApi.reset(email, code, pass);
          if (!r.ok) return this.setStatus(errorText(r.error));
          return this.show('login', 'Senha alterada. Entre com a nova senha.', true);
        }
      }
    } finally {
      this.busy(false);
    }
  }

  private async resend() {
    const left = Math.ceil((this.resendAt - Date.now()) / 1000);
    if (left > 0) { this.setStatus(`Aguarde ${left} s para pedir outro código.`); return; }
    this.resendAt = Date.now() + 30_000;
    const r = await accountApi.resendCode(this.email);
    this.setStatus(r.ok ? 'Novo código enviado.' : errorText(r.error), r.ok);
  }

  private done() {
    this.pendingPassword = '';
    this.root.classList.add('hidden');
    this.onAuthenticated?.();
  }
}
