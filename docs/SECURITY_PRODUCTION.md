# Segurança de produção — lado da aplicação (rodada 9.1)

Contrato de infraestrutura (portas, Nginx, systemd, layout, scripts): `deploy/CONTRACT.md`. Este documento cobre o que
o **código** garante e o que o operador precisa configurar. Testes: `tests/productionSafety.test.ts` (unidade) e
`tests/productionServer.test.ts` (processo real: proxy `/game`, protocolo, lotação, SIGTERM, recusa de subir);
reinício com navegador real: `tools/qa/restart_mp.mjs` (**19/19**); telas de produção (cadastro beta, sala cheia,
versão nova, selos BETA): `tools/qa/beta_ui.mjs` (**11/11**); banco real: `server/test/betaApproval.dbtest.ts`.

## Endereços (mesma origem)

| Ambiente | Jogo (Colyseus) | API |
|---|---|---|
| produção (build do Vite) | `wss://<host>/game` (`ws://` se a página for http) — o Nginx remove `/game` e passa a `127.0.0.1:2567` (matchmaking HTTP **e** WebSocket pelo mesmo caminho, com Upgrade) | `/api/...` relativo → `127.0.0.1:2568` |
| desenvolvimento (`vite`) | `ws://<host>:2567` | proxy do Vite (`PV_API`) |
| QA | `?mp=ws://…` vale em qualquer modo | — |

`src/net/endpoint.ts` decide por `import.meta.env.DEV` (constante no build: o ramo de dev some do bundle). O SDK 0.18
aceita endpoint com caminho: `…/game/matchmake/joinOrCreate/…` e `…/game/<processo>/<sala>?sessionId=…` — testado atrás
de um proxy que remove o prefixo, inclusive a **reconexão** (`tests/productionServer.test.ts`).

## Travas de produção (`server/src/prodGuard.ts`)

Com `NODE_ENV=production` o servidor **não sobe** (sai com 1, antes de abrir banco ou porta) se:

- `PV_TEST`, `PV_ALLOW_ANON_PLAYERS` ou `PV_DEV_MAIL` estiverem definidos (qualquer valor) ou `PV_STORE=memory`;
- `PV_SESSION_SECRET` ou `PV_ADMIN_TOKEN` estiverem ausentes, com < 32 caracteres, forem o valor de desenvolvimento /
  de exemplo, tiverem pouca variedade de caracteres, ou forem iguais entre si;
- faltar `DATABASE_URL`, `PV_PUBLIC_ORIGIN` (origem exata, ex. `https://exemplo.com.br`, sem barra) ou
  `PV_REGISTRATION=beta` ou `livre` (não há provedor de e-mail real).

Avisos (sobe, registra): `PV_TRUST_PROXY` ≠ `loopback`, `PV_GRAFFITI_STORE=memory`, origem `http://`.

Mensagens só de teste continuam **inertes** sem `PV_TEST=1` (auditado): `test_tp`, `qa_fx`, `qa_status`
(`PresidenteVargasRoom.r9TestTeleport` / `r9bQa` retornam na primeira linha), `testSpawn`/`testGroup` na entrada,
`bot`/`testUser` (`server/src/presence/testJoin.ts` exige `PV_TEST`/`PV_ALLOW_ANON_PLAYERS`), `PV_COMBAT_ZONES`,
`PV_PROTECT_MS`, `PV_DEBATE_FILE`, `PV_AGENDA_FILE`/`PV_AGENDA_EPOCH` (`server/src/events/agenda.ts`). Como produção
recusa `PV_TEST`, nenhum deles pode ser ligado lá.

Segredos: só no arquivo de ambiente do servidor (`/opt/tretario/shared/env/server.env`, modo 600) — nunca no Git, no
bundle ou em log. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (um para cada).

## Cookies, CORS, Origin

- Sessão `pv_sid`: `HttpOnly; SameSite=Lax; Path=/`, **`Secure` em produção** (`server/src/http/router.ts` `cookie()`,
  único lugar que formata Set-Cookie; auditado em `auth/session.ts`). O banco guarda só o SHA-256 do token.
- CORS: **nunca `*`** na API. `Access-Control-Allow-Origin` só para `PV_PUBLIC_ORIGIN` (com `Vary: Origin`); a
  aplicação é de mesma origem, então normalmente nem é usado. `/metrics` (interno, negado no Nginx) só tem `*` fora de
  produção. O matchmaking do Colyseus (`/game/matchmake/*`) tem CORS próprio do framework e **não usa cookie** (a
  identidade vai no ticket de uso único).
- CSRF: rotas que mudam estado (POST/PUT/PATCH/DELETE) em produção exigem `Origin` = `PV_PUBLIC_ORIGIN`; sem `Origin`,
  `Sec-Fetch-Site` presente tem de ser `same-origin`/`none`; sem nenhum dos dois (curl, CLI) passa — não há navegador
  para forjar. Recusa: `403 origem_invalida` (antes de ler o corpo). Somado ao `SameSite=Lax` e à API só JSON.
- Todas as respostas da API: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

## IP do cliente atrás do proxy (`PV_TRUST_PROXY=loopback`)

`server/src/http/clientIp.ts`: com `loopback`, `X-Real-IP` (ou o **último** item de `X-Forwarded-For` — o que o Nginx
acrescentou; os anteriores vêm do cliente) só valem quando a conexão vem de `127.0.0.1`/`::1`. Sem a variável: sempre o
endereço do socket. Vale para a API (limites de cadastro/login/reset/ticket…) **e** para a entrada no WebSocket (o
`context.ip` do Colyseus confia em cabeçalho de qualquer um e não é usado). O IP só existe em memória, como HMAC com
chave aleatória do processo (`auth/rateLimit.ts`); nunca vai ao banco nem ao log. O Nginx deve mandar
`proxy_set_header X-Real-IP $remote_addr;` e `X-Forwarded-For $proxy_add_x_forwarded_for;`.

## Limites de taxa (memória do processo; zeram ao reiniciar)

| Onde | Chave | Limite | Resposta / log |
|---|---|---|---|
| `POST /api/auth/register` | IP | 10/h | `429 muitas_tentativas {retryAfterS}` · `ratelimit route=register` |
| `POST /api/auth/login` | e-mail **e** IP | backoff: 5 falhas livres por conta (1 s, 2 s, 4 s… até 15 min) e 20 por IP | `429` · `ratelimit route=login`; `auth.suspicious` ao começar o bloqueio e a cada 10 (conta) / 20 (origem) falhas — sem e-mail nem IP |
| `POST /api/auth/forgot` | IP / e-mail | 10/h por IP; 3/h por e-mail (silencioso) | `429` · `ratelimit route=forgot` |
| `POST /api/auth/reset` | e-mail + IP | backoff 5 livres (2 s… até 30 min) + o do IP do login | `429` · `ratelimit route=reset` |
| `POST /api/auth/resend-code` | conta | 1/min e 5/h | `429 aguarde` · `ratelimit route=resend_code` |
| `POST /api/auth/verify-email` | código | 5 tentativas por código, 15 min | `400 codigo_expirado` |
| `GET /api/nickname/available` | IP | 60/min | `429` |
| `PUT /api/me/nickname` | conta | 3/dia | `429 troca_de_apelido_limitada` |
| `PUT /api/me/appearance` · grupo / `PUT /api/me/preferences` | conta | 20/min · 40/min | `429 muitas_alteracoes` |
| `POST /api/session/ticket` **(novo)** | conta | 30/min | `429` · `ratelimit route=ticket` |
| `GET /internal/health` **(novo)** | IP | backoff após 5 tokens errados (2 s… até 10 min) | `401` / `429` |
| entrada no WebSocket (onAuth) **(novo)** | IP · conta | `PV_JOIN_RATE_IP` 120/min (folga para CGNAT) · `PV_JOIN_RATE_USER` 20/min; 0 desliga; desligado por padrão com `PV_TEST=1` | erro `4013 muitas_entradas` · `ratelimit route=ws_join_ip/ws_join_user` |
| mensagens na sala | conexão | `maxMessagesPerSecond = 60` (Colyseus derruba acima) | — |
| chat | conta/conexão | 5 mensagens / 8 s, repetição 30 s, cooldown adaptativo 2 s → 120 s; denúncias 6 / 10 min | `chat_denied` |
| grafite | sessão **e** id do aparelho | cooldown 20 s, 12/h, 6 ativos; denúncias com limiar 3 | `gf_res` |
| matchmaking HTTP (`/game/matchmake/*`) | — | **no Nginx** (`limit_req`, sugestão 30 r/min por IP, burst 10): cada pedido reserva um assento por ~15 s | 429 do Nginx |

Logs de limite são agregados: uma linha por rota a cada 60 s com a contagem (um ataque não inunda o journald).

## Lotação por sala

`MAX_PLAYERS_PER_ROOM` (jogadores, contando quem está em graça de reconexão) e `MAX_SPECTATORS_PER_ROOM` substituem o
`PV_MAX_CLIENTS` (que continua valendo, como antes, quando as duas não estão definidas). Lotado → recusa **imediata** no
`onAuth`: `4011 sala_cheia` (o cliente oferece "Sala cheia — entrar como espectador?") ou `4012 espectadores_lotado`. O
`maxClients` do Colyseus fica em soma + 32 (assentos reservados), para a sala nunca "trancar" antes e o `joinOrCreate`
abrir um segundo mundo. Login duplicado da mesma conta não é barrado pela lotação (a sessão nova substitui a antiga).

## Cadastro beta sem SMTP (`PV_REGISTRATION=beta`)

Ver `docs/AUTH.md` § Produção beta. Resumo: o cadastro cria a conta (sessão aberta) **pendente**; nenhum código é
gerado, enviado, registrado em log ou devolvido; `/api/dev/outbox` não existe (nem com `PV_DEV_MAIL=1`); o cliente
mostra "Cadastro recebido — o acesso beta é liberado pela equipe". A equipe libera com
`npm run prod:approve -- <email> [--grant]` (`docs/ACCESS_CONTROL.md`). Esqueci-a-senha responde igual, mas não envia
nada no beta (ver limitações).

## Cadastro livre sem SMTP (`PV_REGISTRATION=livre`, 20/10/2026 — decisão do dono: "cadastrou, já joga")

Como no beta, nenhum código é gerado nem enviado (não há SMTP), mas sem espera: a conta já nasce verificada e com
concessão de jogador (`DEV_GRANTED` global, sem validade), o mesmo que `prod:approve --grant`, só que automático
(`AuthService.releaseIfFree`). Quem ficou pendente no modo beta é liberado ao voltar (GET /api/me, login ou ticket).
Nunca libera conta banida ou suspensa. Cada liberação grava AuditLog `auth.auto_release` (ator
`system:cadastro-livre`). Consequência: o e-mail **não é comprovado** (qualquer endereço serve) — o controle de abuso
fica no limite de cadastros por IP, na moderação de apelido e em `ban`/`suspend` pela CLI. Esqueci-a-senha continua sem
envio. Voltar ao beta: `PV_REGISTRATION=beta` + restart (contas já liberadas continuam jogando).

## Equipe e administração

Não existe papel "admin" dentro do site nem e-mail/userId fixo no código. Operador = quem tem shell no servidor (CLI)
e o `PV_ADMIN_TOKEN` (`/internal/health`, remoção de grafite pela sala). Conta da equipe: `npm run prod:promote --
<email>` (concessão `STAFF` global, auditada); `npm run prod:demote -- <email>` retira. Na VPS, a CLI precisa do
ambiente do serviço: `sudo -u tretario bash -c 'set -a; . /opt/tretario/shared/env/server.env; set +a; cd
/opt/tretario/current && npm run prod:approve -- pessoa@exemplo.com --grant'`.

## Logs (`PV_LOG_FORMAT=json`, `server/src/log.ts`)

Uma linha JSON por evento `{t, level, evt, msg?, …campos}` (journald → `journalctl -u tretario -o cat | jq`); sem a
variável, saída legível de desenvolvimento como antes. Campos com nome de senha/token/cookie/código/OTP/ticket/e-mail/IP
são **descartados** e qualquer e-mail dentro de texto vira `[email]`; ids só o curto da conexão (`conn`). Conversa de
jogo (entrou no carro, queda, empurrão) só aparece na saída de desenvolvimento.

| `evt` | Quando |
|---|---|
| `startup` | subida (porta, protocolo, versão, banco, cadastro, lotação) e recusas/avisos das travas |
| `shutdown` | SIGTERM/SIGINT: início, `encerrado {ms}` ou prazo estourado |
| `error` | erro de API (rota, método, mensagem), exceção/rejeição não tratada, falhas de gravação |
| `auth.suspicious` | falhas repetidas de login (conta / origem), sem identificar ninguém |
| `auth.pending` | cadastro beta aguardando liberação (contagem; sem e-mail) |
| `ratelimit` | limite atingido (agregado por rota/60 s) |
| `ws.join` / `ws.leave` | conexão entrou/saiu: `conn`, papel, totais de jogadores/espectadores |
| `room.create` · `eventos` · `chat` · `graffiti` · `cleanup` | sala criada; agenda e ciclo dos eventos; denúncias; passada de limpeza |
| `health.degraded` / `health.recovered` | transição de banco fora, event loop p99 > 250 ms ou tick > 150 ms (checado a cada 30 s) |
| `migration` · `backup` | emitidos pelos scripts de deploy/backup (`scripts/`) no mesmo formato |

## Desligamento gracioso (SIGTERM)

`server/src/index.ts`: para de aceitar entradas (`onAuth` → `4014`, `/health/ready` → 503), manda `server_restarting` a
todos (o cliente mostra **SERVIDOR REINICIANDO — RECONECTANDO…**), fecha as salas (o `onDispose` grava progressão,
grafites e telemetria), para a limpeza e os timers, fecha a API e o banco (`$disconnect`) e sai com 0. Prazo
`PV_SHUTDOWN_MS` (14 s; o systemd mata em 20 s) — estourou, sai com 1 e registra. Comportamento do cliente:
`docs/SHARED_WORLD.md` § Reinício do servidor.

## Frontend de produção

- Selo **BETA** discreto: no logotipo do início e no canto inferior direito do HUD (junto da atribuição do mapa).
- Fora dos buscadores durante o beta (decisão): `<meta name="robots" content="noindex,nofollow">` no `index.html` e
  `public/robots.txt` com `Disallow: /`. Retirar os dois no lançamento.
- Sem source maps (`build.sourcemap: false`); `assets/[name]-[hash]` → Nginx: `/assets/` com cache longo `immutable` e
  `index.html` com `no-cache` (ver também `public/_headers`).
- Versão do protocolo: `PROTOCOL_VERSION` (`src/net/protocol.ts`), regra de aumento no próprio arquivo; aba antiga
  com servidor novo vê "Nova versão disponível — recarregar".
- `npm run check:bundle` (depois de `npm run build`): falha se o `dist/` tiver `localhost`/`127.0.0.1`/`0.0.0.0`/
  `:2567`/`:2568`, nome de variável secreta, URL de banco, o segredo de desenvolvimento, chave privada, **os valores**
  de `PV_SESSION_SECRET`/`PV_ADMIN_TOKEN`/`DATABASE_URL` do ambiente e de `server/.env`, `/api/dev/outbox`, source map,
  asset sem hash, ou se faltar o `noindex`/robots. Os dois literais inertes do SDK do Colyseus (`ws://127.0.0.1:2567` sem
  `window.location` e o hostname do Discord) são trocados por `''` no build (`vite.config.ts`).
- `npm run build:version` grava `version.json` `{commit, buildTime}` (recusa árvore suja sem `--allow-dirty`); o
  servidor lê de `<release>/version.json` ou `server/version.json`, senão `PV_BUILD_COMMIT`/`PV_BUILD_TIME`, senão
  `git rev-parse` (só fora de produção).

## Limitações conhecidas

- Sem SMTP: no beta não há recuperação de senha por e-mail (a resposta é a mesma, nada é enviado). Pedido de nova senha
  passa pela equipe (fora do site) até existir um `MailProvider` real.
- Limites de taxa, tickets e lotação vivem em UM processo (vários processos precisariam de Redis).
- O matchmaking HTTP do Colyseus não passa pelo limitador da aplicação: o limite dele é no Nginx.
- O servidor roda com `tsx` (devDependency): a instalação na VPS não pode usar `--omit=dev`.
