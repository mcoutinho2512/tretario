/**
 * E-mail transacional (rodada 8) atrás de uma INTERFACE. Nesta rodada só existe o provedor de DESENVOLVIMENTO:
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
  const subject = kind === 'EMAIL_VERIFY' ? 'Presidente Vargas 3D — confirme seu e-mail' : 'Presidente Vargas 3D — redefinir senha';
  const what = kind === 'EMAIL_VERIFY' ? 'confirmar seu e-mail' : 'redefinir sua senha';
  return { to, kind, code, subject, text: `Seu código para ${what}: ${code}\nVale por 15 minutos. Se não foi você, ignore este e-mail.` };
}
