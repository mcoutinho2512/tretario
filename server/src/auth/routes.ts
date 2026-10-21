/**
 * Rotas HTTP de conta/sessão (rodada 8). Caminhos: `API` em src/identity/types.ts. Outros módulos da API (perfil,
 * aparência, grupo…) obtêm a sessão por `auth().session(req)` — nunca leem o cookie por conta própria.
 */
import { router } from '../http/router';
import { services } from '../services';
import { API } from '../../../src/identity/types';
import { AuthService, serverSecret } from './service';
import { BetaHoldMailProvider, DevelopmentMailProvider, ResendMailProvider, devOutboxEnabled, realMailConfigured, registrationMode, type MailProvider } from './mail';
import { log } from '../log';
import { currentEventId } from '../events/seed';

let instance: AuthService | null = null;
let devMail: DevelopmentMailProvider | null = null;

/** provedor de e-mail: beta (rodada 9.1) não envia nada; senão o de desenvolvimento (recusa produção — ver mail.ts) */
let betaMail: BetaHoldMailProvider | null = null;
let realMail: ResendMailProvider | null = null;
function mailProvider(): MailProvider {
  if (realMailConfigured()) return (realMail ??= new ResendMailProvider(process.env.RESEND_API_KEY!, process.env.PV_MAIL_FROM || 'Porrada na Presidente Vargas <nao-responda@tretario.com.br>'));
  if (registrationMode() !== 'open') return (betaMail ??= new BetaHoldMailProvider()); // beta/livre sem chave: nada sai
  devMail ??= new DevelopmentMailProvider();
  return devMail;
}

/** serviço de autenticação único do processo (criado na primeira requisição, depois de initServices) */
export function auth(): AuthService {
  if (!instance) {
    const s = services();
    instance = new AuthService({ store: s.store, tickets: s.tickets, mail: mailProvider(), secret: serverSecret(), currentEventId });
  }
  return instance;
}

/** limpeza periódica dos limites (CleanupService); 0 se o serviço ainda não foi criado (nenhuma requisição) */
export function sweepAuthLimits(now = Date.now()): number { return instance ? instance.sweepLimits(now) : 0; }

router.add('POST', API.register, (r) => auth().register(r));
router.add('POST', API.verifyEmail, (r) => auth().verifyEmail(r));
router.add('POST', API.resendCode, (r) => auth().resendCode(r));
router.add('POST', API.login, (r) => auth().login(r));
router.add('POST', API.logout, (r) => auth().logout(r));
router.add('POST', API.forgot, (r) => auth().forgot(r));
router.add('POST', API.reset, (r) => auth().reset(r));
router.add('GET', API.me, (r) => auth().me(r));
router.add('PUT', API.nickname, (r) => auth().changeNickname(r));
router.add('GET', API.nicknameAvailable, (r) => auth().nicknameAvailable(r));
router.add('POST', API.joinTicket, (r) => auth().ticket(r));

// caixa de saída de DESENVOLVIMENTO (testes automatizados leem o código). Fora de dev: a rota nem existe.
if (devOutboxEnabled()) {
  router.add('GET', '/api/dev/outbox', (r) => {
    auth();
    const to = (r.query.get('email') ?? '').trim().toLowerCase();
    return { body: { messages: (devMail?.outbox(to || undefined) ?? []).slice(0, 20).map((m) => ({ to: m.to, kind: m.kind, code: m.code, at: m.at })) } };
  });
  log.info('auth', 'caixa de saída de desenvolvimento ATIVA em /api/dev/outbox (PV_DEV_MAIL=1)');
}
