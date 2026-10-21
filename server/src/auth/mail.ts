/**
 * E-mail transacional (rodada 8) atrás de uma INTERFACE. Provedores: DESENVOLVIMENTO (abaixo), beta (descarta) e
 * Resend (produção, 20/10/2026 — ResendMailProvider no fim do arquivo). Desenvolvimento:
 * escreve o código no console do servidor e guarda uma caixa de saída em memória que os testes automatizados leem
 * (GET /api/dev/outbox, só com NODE_ENV != production e PV_DEV_MAIL=1). Um SMTP real entra depois como outra
 * implementação de MailProvider — nenhum outro arquivo muda. Sem serviço externo.
 */

export type MailKind = 'EMAIL_VERIFY' | 'PASSWORD_RESET';

export interface MailMessage {
  to: string;
  kind: MailKind;
  /** código de uso único (só vai no e-mail; o banco guarda o hash) */
  code: string;
  subject: string;
  text: string;
}

export interface MailProvider {
  readonly name: string;
  send(m: MailMessage): Promise<void>;
}

export function isProduction(): boolean { return process.env.NODE_ENV === 'production'; }

/**
 * modo de cadastro (rodada 9.1, PV_REGISTRATION): `beta` (padrão em produção — sem SMTP: a conta fica PENDENTE, nenhum
 * código é gerado nem mostrado, a equipe libera pela CLI `npm run prod:approve`) · `open` (padrão em dev: código pelo
 * provedor de e-mail) · `dev` (igual a open; nome antigo) · `livre` (20/10/2026, pedido do dono: sem SMTP e SEM espera —
 * a conta já nasce verificada e com concessão de jogador; quem estava pendente é liberado ao voltar; ver
 * AuthService.releaseIfFree). Produção só sobe com `beta` ou `livre` (server/src/prodGuard.ts).
 */
export type RegistrationMode = 'beta' | 'open' | 'livre';
export function registrationMode(): RegistrationMode {
  const v = process.env.PV_REGISTRATION;
  if (v === 'beta') return 'beta';
  if (v === 'livre') return 'livre';
  if (v === 'open' || v === 'dev') return 'open';
  return isProduction() ? 'beta' : 'open';
}

/** caixa de saída de DEV legível por HTTP (testes de QA) — nunca em produção nem no modo beta */
export function devOutboxEnabled(): boolean { return !isProduction() && process.env.PV_DEV_MAIL === '1' && registrationMode() === 'open'; }

/** modo beta: NENHUM e-mail sai e nada é registrado (nem endereço, nem código) — só a contagem no log */
export class BetaHoldMailProvider implements MailProvider {
  readonly name = 'beta';
  async send(_m: MailMessage) { /* descartado de propósito */ }
}

export class DevelopmentMailProvider implements MailProvider {
  readonly name = 'dev';
  private box: (MailMessage & { at: number })[] = [];

  constructor(private log = true) {
    // nunca em produção: códigos no console seriam um vazamento
    if (isProduction()) throw new Error('DevelopmentMailProvider recusado em produção — configure um MailProvider real');
  }

  async send(m: MailMessage) {
    this.box.push({ ...m, at: Date.now() });
    if (this.box.length > 200) this.box.splice(0, this.box.length - 200);
    if (this.log) console.log(`[mail:dev] ${m.kind} para ${m.to}: código ${m.code}`);
  }

  /** mensagens mais recentes primeiro (filtro por destinatário) */
  outbox(to?: string): (MailMessage & { at: number })[] {
    return this.box.filter((m) => !to || m.to === to).reverse();
  }
}

export function codeMail(to: string, kind: MailKind, code: string): MailMessage {
  const subject = kind === 'EMAIL_VERIFY' ? 'Porrada na Presidente Vargas — confirme seu e-mail' : 'Porrada na Presidente Vargas — redefinir senha';
  const what = kind === 'EMAIL_VERIFY' ? 'confirmar seu e-mail' : 'redefinir sua senha';
  return { to, kind, code, subject, text: `Seu código para ${what}: ${code}\nVale por 15 minutos. Se não foi você, ignore este e-mail.` };
}

/**
 * Provedor REAL (20/10/2026): Resend (https://resend.com), domínio tretario.com.br verificado (SPF/DKIM no Registro.br).
 * Ligado só com RESEND_API_KEY no server.env (chave de envio restrita ao domínio); remetente PV_MAIL_FROM (padrão
 * "Porrada na Presidente Vargas <nao-responda@tretario.com.br>"). Falha de rede/HTTP vira exceção — quem chama registra
 * e responde igual (a resposta ao usuário nunca revela se o e-mail existe). O código vai só no corpo do e-mail.
 */
export class ResendMailProvider implements MailProvider {
  readonly name = 'resend';
  constructor(private apiKey: string, private from: string, private fetchFn: typeof fetch = fetch) {}

  async send(m: MailMessage) {
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">`
      + `<p>${m.kind === 'PASSWORD_RESET' ? 'Você pediu para redefinir a senha no <b>Porrada na Presidente Vargas</b>.' : 'Confirme seu e-mail no <b>Porrada na Presidente Vargas</b>.'}</p>`
      + `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:18px 0">${m.code}</p>`
      + `<p>O código vale por 15 minutos. Se não foi você, ignore este e-mail.</p>`
      + `<p style="color:#666;font-size:12px">tretario.com.br</p></div>`;
    const r = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html }),
    });
    if (!r.ok) throw new Error(`resend ${r.status}`);
  }
}

/** provedor real configurado? (RESEND_API_KEY no ambiente) */
export function realMailConfigured(): boolean { return !!process.env.RESEND_API_KEY; }

