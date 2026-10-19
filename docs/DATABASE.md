# Banco de dados (rodada 8)

PostgreSQL 16 **local** em contêiner (`docker-compose.yml`). Modelo: `server/prisma/schema.prisma` + migrations em
`server/prisma/migrations/` (nunca editar uma migration aplicada; criar outra). Acesso: **só** pela interface
`DataStore` (`server/src/data/types.ts`) — `PrismaDataStore` (`data/prisma.ts`) ou `MemoryDataStore` (`data/memory.ts`).

## Preparar o ambiente

```bash
docker compose up -d db                 # PostgreSQL em 127.0.0.1:5433 (usuário pv / senha pv_dev / banco pv3d)
npm --prefix server install             # roda `prisma generate` (cliente em server/src/generated/, fora do git)
cp server/.env.example server/.env      # se ainda não existir (ver variáveis abaixo)
npm --prefix server run db:deploy       # aplica as migrations no schema da DATABASE_URL
npm run server                          # o servidor carrega server/.env e usa o PostgreSQL
```

`server/.env` (fora do git):

```
DATABASE_URL="postgresql://pv:pv_dev@127.0.0.1:5433/pv3d?schema=public"
DATABASE_URL_TEST="postgresql://pv:pv_dev@127.0.0.1:5433/pv3d?schema=test"
PV_SESSION_SECRET="dev-only-change-me"
```

- Escolha do banco (`server/src/services.ts`): Prisma quando há `DATABASE_URL` e `PV_STORE != memory`; senão memória.
  Com Prisma escolhido e o banco fora do ar, o servidor **não sobe** (mensagem clara) — use `PV_STORE=memory` para
  rodar sem banco (nada persiste).
- `?schema=<nome>` na URL é repassado ao adaptador (`@prisma/adapter-pg`): testes e QA usam schemas próprios.
- Na partida, os eventos/grupos de `public/events/*.json` são espelhados em `Event`/`EventGroup`
  (`server/src/events/seed.ts`, idempotente); ids de grupo: `"<evento>:<chave>"`.
- Mudou o schema? `npm --prefix server run db:migrate -- --name <descricao>` (gera migration nova) e
  `npm --prefix server run db:generate`.

## Testes

| Comando | Banco | O que roda |
|---|---|---|
| `npm test` / `npm run verify` | **nenhum** (memória) | contrato do DataStore em memória (`tests/dataStore.test.ts`), segurança de conta, CLI, pagamento mock |
| `npm run test:db` | PostgreSQL local, schema de teste | recria o schema (padrão: o de `DATABASE_URL_TEST`; outro com `PV_TEST_DB_SCHEMA=<nome>`), aplica migrations e roda `server/test/*.dbtest.ts`: o MESMO contrato no `PrismaDataStore` + fluxo de conta com "reinício" |
| `node tools/qa/persistence_e2e.mjs [--port=2710] [--schema=e2e_auth]` | PostgreSQL local, schema próprio | sobe o servidor, cadastro → verificação → concessão (CLI) → joga → **reinicia** → login → mesmo `/api/me` → suspensão derruba (4002) |

Os scripts de teste recusam o schema `public`.

## Mudanças da rodada 8.1 (migrations `20261017115838_hardening_identity_cleanup`, `20261017130000_cleanup_revoked_consumed_idx`)

- **`MuteRelationship`** `(id, ownerUserId, mutedUserId, mutedNicknameAtTime?, createdAt)` — único por par
  `(ownerUserId, mutedUserId)`, índice em `mutedUserId`, `onDelete: Cascade` nas duas contas. A identidade é o
  `userId`; o apelido é só uma cópia para exibir. A migration converteu os mutes antigos por apelido
  (`Profile.preferences.chatMuted`) em linhas desta tabela (apelido → conta pela `nicknameKey`) e removeu a chave.
- **`Report.reportedNicknameAtTime`** — apelido do denunciado no momento da denúncia (revisão); o alvo continua sendo
  `targetUserId`.
- **Índices**: `Session(expiresAt)`, `Session(revokedAt)`, `VerificationCode(expiresAt)`,
  `VerificationCode(consumedAt)` — usados pela limpeza (`BitmapOr`, sem varredura sequencial).
- **DataStore**: `mutes.{list, add, remove}`, `sessions.deleteExpired`, `codes.deleteExpired` (memória e Prisma).

## Mudanças da rodada 9 (migration `20261017134942_round9_progression`)

Progressão de missões/XP (docs/PROGRESSION.md, docs/MISSIONS.md):

- **`PlayerProgress`** `(userId PK, xp, level, data Json, updatedAt)` — `data` = progresso EM ANDAMENTO
  (`{ v, active: MissionProgress[], ach, seen, tracked, evx }`), sem conteúdo privado.
- **`CompletedMission`** `(id, userId, missionId, completedAt)` — único por `(userId, missionId)`.
- **`AchievementUnlock`** `(id, userId, achievementId, unlockedAt)` — único por `(userId, achievementId)`.
- **`RewardGrant`** `(id, userId, item, source, grantedAt)` — único por `(userId, item)`: o mesmo item nunca é concedido
  duas vezes (fonte `mission:<id>` / `achievement:<id>`; títulos como `title:<texto>`).
- Todas com `onDelete: Cascade` na conta.
- **DataStore**: `progression.{load, save}` (memória e Prisma; contrato em `tests/dataStoreContract.ts`). `save` =
  upsert + `createMany(skipDuplicates)` numa transação. Escrita **em lote** pelo `ProgressionService` (a cada
  `PV_PROG_FLUSH_S`, padrão 15 s, e na queda/saída/fim da graça/desligamento) — nunca por evento nem por tick.
- Testes: `server/test/progression.dbtest.ts` (pares únicos recusam duplicata no PostgreSQL, cascata, reinício).

## Mudanças da rodada 10 (migration `20261018220000_round10_supporter_profile`)

Torcida no perfil (docs/SUPPORTER_GROUPS.md). **Expand-first**: só colunas novas NULLABLE em `Profile`, nada existente
muda ou é apagado; código antigo continua funcionando com o banco novo.

- `Profile.supporterGroup String?` — id da torcida (dados `public/gameplay/supporters.json`) ou o id neutro; NULL =
  nunca escolheu.
- `Profile.supporterPending String?` — troca pedida durante evento competitivo, aplicada no fim/saída do evento.
- `Profile.supporterChangedAt DateTime?` — última troca aplicada (cooldown da `changePolicy`).
- **DataStore**: `supporters.{get, set}` (memória e Prisma; contrato em `tests/dataStoreContract.ts`). A migration foi
  escrita no formato do `prisma migrate` e conferida com `prisma generate`; o banco local estava fora do ar nesta rodada
  (`npm run test:db` não rodou — rodar antes do deploy).

## Registros efêmeros e limpeza (rodada 8.1)

Inventário de tudo que vence/expira no servidor e o destino de cada item. **Auditoria nunca é apagada.**

| Registro | Onde | Validade | Destino |
|---|---|---|---|
| `Session` (login) | banco | 30 dias deslizantes; `revokedAt` no logout/reset/ban | **apagada** pelo `CleanupService` quando `expiresAt` ou `revokedAt` < agora − `CLEANUP_SESSION_GRACE_MINUTES` |
| `VerificationCode` (verificação de e-mail, redefinição) | banco | 15 min, uso único | **apagado** quando `expiresAt` ou `consumedAt` < agora − `max(CLEANUP_CODE_GRACE_MINUTES, 15 min)` |
| tickets de entrada na sala (`identity/tickets.ts`) | memória | 60 s, uso único | consumidos somem na hora; os **nunca usados** eram limpos só acima de 1000 → agora também a cada passada do `CleanupService` |
| limites de taxa de autenticação (`auth/rateLimit.ts`: `Backoff`/`Window` de login, cadastro, esqueci-a-senha, reenvio, apelido) | memória | `forgetMs` / janela | antes só limpos acima de 5000 chaves → agora a cada passada (chaves esquecidas/sem evento na janela) |
| limite de gravação de perfil/aparência/grupo (`http/profile.ts`) | memória | janela de 1 min | idem (antes: `clear()` acima de 5000) |
| `AccountAccess` vencida/revogada | banco | `expiresAt`/`revokedAt` | **mantida** (histórico da licença; liga ao `Payment`) |
| `Payment`, `Report`, `ModerationAction`, `AuditLog` | banco | — | **mantidos** (auditoria/financeiro). `ModerationAction.expiresAt` é só o fim da sanção |
| `EventMembership` | banco | duração do evento | **mantida** por ora — retenção pós-evento ainda não implementada (ver `PRIVACY_ARCHITECTURE.md`) |
| `MuteRelationship` | banco | até o dono desfazer | mantido (preferência do usuário; some em cascata com a conta) |
| `PlayerProgress`, `CompletedMission`, `AchievementUnlock`, `RewardGrant` (rodada 9) | banco | até a conta ser apagada | **mantidos** (progresso do jogador); somem em cascata com a conta. Visitantes/anônimos: nunca gravados |
| progresso de visitante/anônimo; estado de progressão de conta sem conexão | memória (`ProgressionService`) | sessão / 30 s após a última conexão | visitante some na saída; conta é gravada e despejada |
| telemetria de gameplay (rodada 9) | memória + `server/data/telemetry.jsonl` | — | **só agregados** (contadores/histogramas por período), sem identificador; arquivo local fora do git |
| cópia de mensagens do chat para denúncia (15 min) | memória (`ChatService`) | 15 min / `keepMax` | autolimpante (poda por idade/quantidade a cada mensagem; limitada por `keepMax`) |
| presença (`presence/PresenceTracker.ts`) | memória | batimento 45 s | sai no `leave` da conexão |
| carência de reconexão (`PresidenteVargasRoom.grace`) | memória | `allowReconnection` | sai ao reconectar/expirar |
| grafites temporários | arquivo JSON + memória | TTL do grafite | `GraffitiService.expire()` a ~1 Hz |
| limites temporários do grafite por autor (`GraffitiService.limits`: chaves `c:<id anônimo>`, `s:<sessão>`, `u:<conta>` — cooldown, criações na janela de 1 h, denúncias na janela de 1 min) | memória (por sala) | cooldown (20 s) / 1 h / 1 min | rodada 9.1: **apagados** a cada passada do `CleanupService` (`GraffitiService.sweep` via `liveMemorySweepers`, conta em `rateLimitKeysDeleted`) só quando nada mais vale (cooldown vencido E nada nas duas janelas); antes cresciam até reiniciar |
| inscrições e estado de eventos agendados (`events/EventRuntime.ts`: chave de participante → sessão, inscritos, estado do runner) | memória (por sala) | duração da instância | rodada 9.1: soltos **no fim** da instância; fica só o resumo (linhas posição/tempo/status, placar, nº de conclusões/inscritos) pela janela recente da agenda (10 min) e depois some. XP/progressão já foi gravado pelo `ProgressionService` |

### CleanupService (`server/src/cleanup/CleanupService.ts`)

- Agendado em `server/src/index.ts` logo após o servidor subir: primeira passada `CLEANUP_FIRST_DELAY_MS` (5 s) depois
  — **não bloqueia** a subida mesmo com banco lento; depois a cada `CLEANUP_INTERVAL_MINUTES`. Timers com `unref`;
  `stop()` no encerramento gracioso do Colyseus (`server.onShutdown`). Também roda nos servidores de teste (`PV_TEST=1`,
  banco em memória).
- Uma passada por vez no processo (chamada concorrente recebe a execução em voo). Entre **instâncias**: cada lote é
  `findMany ids (take: CLEANUP_BATCH)` → `deleteMany` por esses ids; quem chega depois apaga 0 — idempotente, sem
  lock. Lotes repetidos até um apagar 0 ou estourar `CLEANUP_MAX_RUN_MS` (o resto fica para a próxima). Sem
  `pg_advisory_lock`: com pool de conexões o lock de sessão pode ficar preso a outra conexão, e o lote idempotente já
  basta.
- Carência do código ≥ validade do código (15 min): "vale o código mais recente" (`codes.latest`) — apagar o mais
  recente antes de um mais antigo também ter vencido poderia ressuscitar o antigo.
- Sessão apagada = sessão vencida para a autenticação: `byTokenHash` devolve null → `SessionService.resolve` e
  `requireUser` devolvem null (deslogado), sem exceção (teste em `tests/cleanup.test.ts`). A sala não procura a
  sessão de login depois da entrada (ticket → identidade; reconexão usa o token do Colyseus), então a limpeza não
  afeta reconexão.
- Métricas por passada: `{ startedAt, expiredSessionsDeleted, expiredOtpDeleted, expiredTicketsDeleted,
  rateLimitKeysDeleted, batches, durationMs, truncated, error? }` + totais desde a partida. Log de UMA linha só com
  contagens (`[cleanup] sessões −N · códigos −N · tickets −N · limites −N · L lotes · T ms`) — nunca token, hash,
  código, senha ou e-mail. **Não** entra no endpoint público de métricas.
- Mapas em memória de cada sala (`liveMemorySweepers`): anti-flood/denúncias do chat, debate e — rodada 9.1 — limites
  temporários do grafite (`GraffitiService.sweep`). A sala entra no `onCreate` e sai no `onDispose`; tudo passa pelo
  MESMO agendador (nenhum timer próprio) e soma em `rateLimitKeysDeleted`.
- Operador: `npm run dev:cleanup` — uma passada no banco da `DATABASE_URL` (só sessões/códigos: tickets e limites
  vivem na memória do servidor), imprime as métricas em JSON e grava `CLEANUP_RUN` no `AuditLog` (só contagens).

| Variável | Padrão | Uso |
|---|---|---|
| `CLEANUP_INTERVAL_MINUTES` | 10 | intervalo entre passadas; `0` desliga o agendamento |
| `CLEANUP_SESSION_GRACE_MINUTES` | 60 | quanto tempo uma sessão vencida/revogada fica antes de ser apagada |
| `CLEANUP_CODE_GRACE_MINUTES` | 60 | idem para códigos vencidos/usados (mínimo efetivo: 15 min) |
| `CLEANUP_BATCH` | 500 | linhas por lote |
| `CLEANUP_MAX_RUN_MS` | 30000 | teto de tempo de uma passada |
| `CLEANUP_FIRST_DELAY_MS` | 5000 | atraso da primeira passada |

### Índices da limpeza

`Session(expiresAt)`, `Session(revokedAt)`, `VerificationCode(expiresAt)`, `VerificationCode(consumedAt)` (migrations
`20261017115838_hardening_identity_cleanup` e `20261017130000_cleanup_revoked_consumed_idx`). A consulta
`expiresAt < x OR revokedAt < y` vira `BitmapOr` dos dois índices (verificado por `EXPLAIN` em `npm run test:db`).
As colunas são `timestamp` **sem** fuso: SQL manual deve comparar com `LOCALTIMESTAMP`/parâmetro `timestamp`, não
`now()` (timestamptz) — senão o índice não é usado.

Testes: `tests/cleanup.test.ts` (memória: 100 válidos + 100 vencidos, carências, duas passadas, concorrência, tickets,
limites, métricas, log sem segredos, sessão apagada = deslogado) e `server/test/cleanup.dbtest.ts` (PostgreSQL: o
mesmo cenário, dois `PrismaDataStore` concorrentes, `EXPLAIN`).

## Retenção e privacidade

Ver `docs/PRIVACY_ARCHITECTURE.md`: o banco nunca guarda IP, senha, token ou código em claro; e-mail só no `User`.
