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

## Retenção e privacidade

Ver `docs/PRIVACY_ARCHITECTURE.md`: o banco nunca guarda IP, senha, token ou código em claro; e-mail só no `User`.
