# Controle de acesso (rodada 8)

Política central: `src/access/policy.ts` (`deriveAccessState`, `can`, `resolveRole`). Concessões: tabela
`AccountAccess`. Administração: `server/src/access/admin.ts` + CLI `server/tools/admin.ts`.

## Como alguém vira PLAYER

| Estado | Como chega | O que pode |
|---|---|---|
| VISITOR | sem conta | assistir, ler o chat geral |
| REGISTERED | conta ativa, sem concessão | perfil, avatar, grupo, denunciar; entra só como espectador |
| PLAYER | conta ativa + concessão ativa (`DEV_GRANTED`, `PAID` ou `STAFF`) global ou do evento atual | jogar |
| SUSPENDED | `status=SUSPENDED` e `suspendedUntil` no futuro (vencida = volta sozinha) | assistir, editar perfil |
| BANNED | `status=BANNED` | nada; ticket recusado, sessões revogadas |

O cliente **não tem como** subir de nível: campos extras no cadastro (`grant`, `state`…) são ignorados; o papel pedido
no ticket/entrada só rebaixa; não há botão nem rota HTTP que conceda acesso. Nesta rodada, só a CLI do operador grava
`DEV_GRANTED`; `PAID` só nasce de um webhook confirmado por um `PaymentProvider` (hoje apenas o mock dos testes).

## Capacidades da rodada 9 (debate)

| Capacidade | Quem | Onde |
|---|---|---|
| `debate.speak` | PLAYER **no mundo** (espectador nunca, qualquer que seja a conta) — SUSPENDED/BANNED/REGISTERED/VISITOR não | entrar na fila (`dbt_queue`) e falar no turno (`dbt_say`); também o canal do pipeline de texto (`ChatService.screen`) |
| `debate.react` | PLAYER, inclusive assistindo como espectador | reações da plateia (`dbt_react`), com limite por minuto dos dados |
| `report.create` | conta ativa (REGISTERED/PLAYER) | denúncia de fala (`dbt_report` → Report `DEBATE_LINE`) |

Suspensão/banimento feitos pela CLI chegam pela releitura periódica das identidades: o runner consulta a identidade
ATUAL a cada mensagem e tira do palco o orador que perdeu `debate.speak` no segundo seguinte (`docs/DEBATES.md`).

## CLI do operador

Lê `DATABASE_URL` de `server/.env` (só PostgreSQL). Recusa `NODE_ENV=production` sem `--operador-confirmado`.

```
npm run dev:grant-access -- <email> [--event=<id>] [--hours=N]   # DEV_GRANTED global ou do evento; expiração opcional
npm run dev:revoke-access -- <email> [--event=<id>]              # revoga DEV_GRANTED ativas
npm run dev:suspend -- <email> --hours=N --reason="..."
npm run dev:unsuspend -- <email>
npm run dev:ban -- <email> --reason="..."                        # também revoga todas as sessões
npm run dev:unban -- <email>
npm run dev:reports [-- --status=OPEN] [--limit=50]
npm run dev:remove-graffiti -- <id> [--reason="..."]
```

Toda ação grava **AuditLog** (`actor = cli:<usuário do SO>`, sem senha/token/código) e, quando é concessão ou sanção,
**ModerationAction** (`GRANT_ACCESS`, `REVOKE_ACCESS`, `SUSPEND`, `UNSUSPEND`, `BAN`, `UNBAN`, `REMOVE_GRAFFITI`).

`remove-graffiti`: com o servidor no ar, envia `gf_admin` à sala (exige o mesmo `PV_ADMIN_TOKEN` no servidor e na CLI;
`PORT` indica a sala); com o servidor parado, remove direto do arquivo local (`PV_GRAFFITI_FILE`, padrão
`server/data/graffiti.json`). Nunca edite o arquivo com o servidor no ar — ele regravaria o grafite.

## Produção beta (rodada 9.1)

Comandos feitos PARA produção — rodam com `NODE_ENV=production` sem `--operador-confirmado` (os `dev:*` continuam
exigindo). Na VPS, carregue o ambiente do serviço antes (`docs/SECURITY_PRODUCTION.md` § Equipe e administração).

```
npm run prod:approve -- <email> [--grant] [--hours=N]   # cadastro beta pendente → e-mail verificado; --grant: DEV_GRANTED global (PLAYER)
npm run prod:promote -- <email>                          # equipe: concessão STAFF global (PLAYER; recusa se já é STAFF)
npm run prod:demote -- <email>                           # retira STAFF
```

Auditoria: `BETA_APPROVE` (AuditLog, `meta {verified, grant}`), `GRANT_ACCESS`/`REVOKE_ACCESS` com `grant: 'STAFF'`
(AuditLog + ModerationAction). Não há papel "admin" no site nem conta fixa no código: administrar = CLI no servidor +
`PV_ADMIN_TOKEN`. `STAFF` hoje dá o mesmo que uma licença (jogar); capacidades próprias da equipe, se vierem, entram na
política central (`src/access/policy.ts`), nunca por e-mail/userId.

## Mudanças com jogadores conectados

A CLI roda em outro processo. A sala relê, a cada `PV_IDENTITY_RECHECK_MS` (15 s), a conta de cada conexão
autenticada (`server/src/identity/recheck.ts`):

- banida/apagada → identidade marcada BANNED (gate nega tudo) e desconexão com código **4003**;
- jogador que perdeu `world.play` (suspensão, concessão revogada) → desconexão com **4002**: o cliente deve pedir ticket
  novo e voltar como espectador;
- outras mudanças (ex.: espectador suspenso, concessão nova para espectador) → estado atualizado no lugar.

Concessão nova não promove ninguém no meio da sessão: vale na próxima entrada. Sessão de login revogada (logout em
outro aparelho, redefinição de senha) não derruba a conexão já aberta — só impede tickets novos.

## Pagamento (preparado, não ativo)

`server/src/payments/provider.ts`: `PaymentProvider { createCharge, getCharge, handleWebhook, refund }`,
`MockPaymentProvider` (recusa produção) e `PaymentService` (checkout → webhook assinado → confirma com `getCharge` →
`AccountAccess PAID` idempotente por `paymentId`; reembolso/cancelamento revoga). Sem rota HTTP, sem PSP real, sem fluxo
comercial público. Teste: `tests/accessAdmin.test.ts`.
