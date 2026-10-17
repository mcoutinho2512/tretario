# Autenticação e sessão (rodada 8)

Código: `server/src/auth/` (lógica em `service.ts`, rotas em `routes.ts`). Caminhos: `API` em `src/identity/types.ts`.
Testes: `tests/auth.test.ts` (segurança), `tests/accessAdmin.test.ts`, `tools/qa/persistence_e2e.mjs` (ponta a ponta).

## Arquitetura

| Peça | Arquivo | Observação |
|---|---|---|
| `AuthProvider` / `EmailPasswordProvider` | `auth/providers.ts` | e-mail + senha (único ativo) |
| `OAuthProvider` (Google etc.) | `auth/providers.ts` | **só interface**; sem implementação nem credencial. Precisará de migration (`ExternalIdentity { provider, subject, userId }`) e fluxo com `state` + PKCE |
| Senhas | `auth/password.ts` | scrypt (`node:crypto`), sal de 16 bytes por usuário, formato `scrypt$<log2 N>$<r>$<p>$<sal>$<hash>`, comparação em tempo constante, rehash no login se os parâmetros mudarem (padrão N=2^15, r=8, p=1) |
| Sessões | `auth/session.ts` | token aleatório de 32 bytes no cookie `pv_sid`; banco guarda só SHA-256 |
| Códigos por e-mail | `auth/codes.ts` | 6 dígitos, 15 min, máx. 5 tentativas, só o mais recente vale; banco guarda HMAC(segredo, finalidade:usuário:código) |
| E-mail | `auth/mail.ts` | `MailProvider`; só `DevelopmentMailProvider` (console + caixa de saída em memória). **Recusa produção** |
| Limites de taxa | `auth/rateLimit.ts` | só memória; IP vira HMAC com chave aleatória do processo |
| Pagamento | `payments/provider.ts` | `PaymentProvider` + `MockPaymentProvider` (só testes). Sem PSP real nem rota pública |

`auth()` (em `auth/routes.ts`) é o serviço único do processo. **Outros módulos da API obtêm a sessão com
`await auth().session(req)`** (devolve `{ session, user, refresh? }` ou `null`) e o estado de acesso com
`auth().accessOf(user)`; o DTO do próprio usuário é `auth().meOf(user)`. Ninguém lê o cookie por conta própria.

## Endpoints

Todas as respostas são JSON com `Cache-Control: no-store`. Erro: `{ "error": "<codigo>", ...extra }`.

| Método e rota | Corpo | Sucesso | Erros |
|---|---|---|---|
| `POST /api/auth/register` | `{ email, password, confirm, nickname }` | `201 { ok, me }` + cookie de sessão; envia código | `400 email_invalido · senhas_diferentes · senha_curta · senha_longa · senha_comum · apelido_vazio · apelido_curto · apelido_longo · apelido_caracteres · apelido_reservado · apelido_bloqueado`; `409 email_em_uso · apelido_em_uso`; `429 muitas_tentativas {retryAfterS}` (10/h por IP) |
| `POST /api/auth/verify-email` | `{ code }` (sessão) | `{ ok, me }` | `401 sem_sessao`; `400 codigo_invalido · codigo_expirado` (vencido, usado ou 5 tentativas) |
| `POST /api/auth/resend-code` | — (sessão) | `{ ok }` | `401 sem_sessao`; `400 ja_verificado`; `429 aguarde {retryAfterS}` (1/min, 5/h) |
| `POST /api/auth/login` | `{ email, password }` | `{ ok, me }` + cookie | `401 credenciais_invalidas` (sempre genérico); `429 muitas_tentativas {retryAfterS}` |
| `POST /api/auth/logout` | — | `{ ok }` + cookie apagado | — |
| `GET /api/me` | — | `MeResponse` (+ cookie renovado se tocou a sessão) | sem sessão: `{ authenticated:false, access:{ state:'VISITOR', grant:'NONE' } }` |
| `POST /api/auth/forgot` | `{ email }` | **sempre** `{ ok, message }` | `429 muitas_tentativas` (10/h por IP, igual para qualquer e-mail); por e-mail: 3/h, limite silencioso |
| `POST /api/auth/reset` | `{ email, code, password, confirm? }` | `{ ok }` + cookie apagado; revoga **todas** as sessões; marca e-mail verificado | `400 codigo_invalido` (genérico, também p/ e-mail inexistente) · regras de senha · `senhas_diferentes`; `429 muitas_tentativas` |
| `POST /api/session/ticket` | `{ role?: 'player'\|'spectator' }` (sessão) | `{ ticket, expiresInS: 60, role, access }` — `role` é o papel que a sala dará | `401 sem_sessao`; `403 email_nao_verificado · banido` |
| `GET /api/nickname/available?n=` | — | `{ available: true, nickname }` ou `{ available: false, reason }` | `429` (60/min por IP) |
| `PUT /api/me/nickname` | `{ nickname }` (sessão) | `{ ok, me }`; auditado (`profile.nickname`) | `401 sem_sessao`; `403 sem_permissao`; `400/409` erros de apelido; `429 troca_de_apelido_limitada` (3/dia) |
| `PUT /api/me/appearance` | `{ appearance }` (sessão) | `{ ok, appearance }` | `401`, `403`, `400 aparencia_invalida` — **mínimo**, para o E2E (`server/src/profile/appearanceMinimal.ts`); o módulo de perfil pode substituir |
| `GET /api/dev/outbox?email=` | — | `{ messages: [{ to, kind, code, at }] }` | rota **só existe** com `NODE_ENV != production` e `PV_DEV_MAIL=1` |

`MeResponse` (tipo em `src/identity/types.ts`): `user { nickname, emailVerified, status, createdAt }`, `access
{ state, grant }` (para o evento atual), `appearance`, `preferences`, `membership`. Sem e-mail, sem ids.

## Fluxo de sessão e entrada na sala

1. Cadastro ou login → `Set-Cookie: pv_sid=<32 bytes base64url>; HttpOnly; SameSite=Lax; Max-Age=2592000` (+ `Secure`
   em produção). O Vite faz proxy de `/api` → mesma origem, sem CORS.
2. Ao recarregar a página o cliente chama `GET /api/me`: a sessão é restaurada pelo cookie.
3. Expiração deslizante: 30 dias a partir do último uso, mas o banco só é tocado se o último toque tiver ≥ 10 min.
4. Para entrar no mundo: `POST /api/session/ticket` → ticket de uso único (60 s, memória) → `joinOrCreate(..., { ticket,
   role })`. A sala (`resolveIdentity`) consome o ticket, relê conta/licença/grupo e decide o papel — o pedido só
   rebaixa. Sem ticket = visitante espectador.
5. Logout revoga a sessão (`revokedAt`); redefinição de senha e banimento revogam todas.
6. Limpeza (rodada 8.1, `server/src/cleanup/CleanupService.ts`): sessões vencidas ou revogadas há mais de
   `CLEANUP_SESSION_GRACE_MINUTES` (60) e códigos vencidos/usados há mais de `CLEANUP_CODE_GRACE_MINUTES` (60, mínimo
   15) são **apagados** a cada `CLEANUP_INTERVAL_MINUTES` (10); tickets nunca usados e chaves de limite de taxa
   esquecidas saem da memória na mesma passada. Um cookie de sessão apagada tem o mesmo resultado de uma vencida
   (`GET /api/me` → visitante, rotas → `401 sem_sessao`). Detalhes e inventário: `docs/DATABASE.md`.

Ciclo de vida de uma sessão: `create` (cadastro/login) → uso com toque a cada ≥ 10 min (expiração +30 dias) →
`revokedAt` (logout, reset, ban) **ou** `expiresAt` passa → inválida imediatamente → apagada pela limpeza depois da
carência.

## Força bruta e enumeração

- Login: backoff exponencial por e-mail (5 falhas livres; depois 1 s, 2 s, 4 s… até 15 min) **e** por IP (20 livres).
  Mesmo erro e mesmo custo de scrypt para conta inexistente.
- Esqueci a senha: resposta idêntica com ou sem conta. Redefinição com código errado/conta inexistente: mesmo erro.
- O **cadastro** responde `email_em_uso` (compromisso de usabilidade; limitado a 10/h por IP).
- CSRF: cookie `SameSite=Lax` (não vai em POST entre sites) e API só JSON.

## Configuração

| Variável | Uso |
|---|---|
| `PV_SESSION_SECRET` | HMAC dos códigos. Obrigatório (≥ 32 caracteres, não `dev-only…`) em produção — senão o servidor não sobe |
| `PV_DEV_MAIL=1` | expõe `/api/dev/outbox` (testes automatizados). Ignorado em produção |
| `PV_SCRYPT_LOGN` | custo do scrypt (padrão 15). Mudar faz rehash no próximo login |
| `PV_IDENTITY_RECHECK_MS` | intervalo da releitura de identidades na sala (padrão 15000) |
| `CLEANUP_INTERVAL_MINUTES` · `CLEANUP_SESSION_GRACE_MINUTES` · `CLEANUP_CODE_GRACE_MINUTES` · `CLEANUP_BATCH` | limpeza de sessões/códigos/tickets vencidos (`docs/DATABASE.md`) |

## Limitações (rodada 8)

- Sem e-mail real: o código aparece no console do servidor (e na caixa de saída de dev). `NODE_ENV=production` recusa o
  provedor de desenvolvimento — é preciso implementar um `MailProvider` SMTP antes de qualquer produção.
- Limites de taxa e tickets vivem na memória de UM processo (reiniciar zera; vários processos precisariam de Redis).
- Cadastro incompleto (conta sem perfil, não verificada — só por corrida no apelido) pode ser retomado com o mesmo e-mail.
- Login social: apenas a interface.
