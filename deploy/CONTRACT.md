# Contrato de produção (rodada 9.1) — fonte única para código, Nginx, systemd e scripts

Produção BETA real. **Dados de produção não são descartáveis.** Nunca: `prisma migrate reset`, `DROP DATABASE/SCHEMA`,
apagar volume/diretório de dados do PostgreSQL, sobrescrever o env de produção, secrets no Git, force push, Postgres
público, deploy com testes falhando. Migration com risco de perda de dados: PARAR e documentar.

## Processo e portas (tudo em 127.0.0.1; só o Nginx é público)

| Serviço | Endereço | Observação |
|---|---|---|
| Nginx | :80 → redireciona 443; :443 HTTPS | único exposto (além do SSH :22) |
| Jogo (Colyseus, WebSocket + matchmaking HTTP) | 127.0.0.1:`PORT` (2567) | Nginx `location /game/` → `http://127.0.0.1:2567/` (prefixo removido), com Upgrade |
| API + health | 127.0.0.1:`PORT+1` (2568) | Nginx `/api/` e `/health/` → `http://127.0.0.1:2568` (sem remover prefixo) |
| PostgreSQL 16 | 127.0.0.1:5432 (nativo do SO) ou socket | nunca exposto; usuário/banco próprios |
| Frontend | arquivos estáticos `current/dist` | servidos pelo Nginx |

- Cliente em produção: **mesma origem**. Endpoint do jogo = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/game`
  (Colyseus SDK aceita endpoint com caminho); API = `/api/...` relativo. Em desenvolvimento continua `ws://<host>:2567` e
  proxy do Vite. Nenhum `localhost` no bundle de produção.
- Um processo Node (`tretario.service`, systemd) roda jogo + API (como hoje: `server/src/index.ts`).

## Rotas novas

| Rota | Público? | Conteúdo |
|---|---|---|
| `GET /health/live` | sim | `{ok:true}` — processo vivo |
| `GET /health/ready` | sim | `{ok:true|false}` — banco respondendo (`SELECT 1`, timeout 2 s) e sala/servidor aceitando; 503 se não |
| `GET /api/status` | sim | `{online, protocol, version}` (version = commit curto); nada de infraestrutura |
| `GET /internal/health` | **não** (Nginx nega; exige header `x-admin-token` = `PV_ADMIN_TOKEN`) | uptime, version/commit/buildTime, DB, players, spectators, rooms, tick, event loop lag, memória (heap/RSS), WebSockets |
| `GET /metrics` (existente, PORT+1) | **não** (Nginx nega) | métricas existentes |

## Protocolo cliente/servidor

- `PROTOCOL_VERSION` (inteiro) em `src/net/protocol.ts`. Cliente manda `pv: PROTOCOL_VERSION` nas opções de entrada;
  servidor recusa incompatível com `onAuth` → erro/close `4010` (`protocolo`). Cliente mostra "Nova versão disponível —
  recarregar" (botão), sem erro misterioso. `/api/status` também traz `protocol`.

## Variáveis de ambiente (servidor; arquivo `/opt/tretario/shared/env/server.env`, modo 600, dono `tretario`)

| Variável | Produção | Obs. |
|---|---|---|
| `NODE_ENV` | `production` | cookies `Secure`, sem rotas de teste |
| `PORT` / `HOST` | `2567` / `127.0.0.1` | |
| `PV_PUBLIC_ORIGIN` | `https://<domínio>` | CORS/Origin permitido (sem `*`), checagem de Origin nas rotas que mudam estado |
| `PV_TRUST_PROXY` | `loopback` | só confia em `X-Forwarded-For`/`X-Real-IP` vindos de 127.0.0.1 |
| `DATABASE_URL` | `postgresql://tretario:<senha>@127.0.0.1:5432/tretario` | |
| `PV_SESSION_SECRET` | 32+ bytes aleatórios | |
| `PV_ADMIN_TOKEN` | 32+ bytes aleatórios | `/internal/health`, admin de grafite |
| `PV_REGISTRATION` | `beta` | sem SMTP: cadastro cria conta PENDENTE; código de verificação NUNCA aparece ao visitante; o administrador libera pela CLI (`npm run prod:approve -- <email>`); `open`/`dev` só em desenvolvimento |
| `MAX_PLAYERS_PER_ROOM` | ex. 150 (definido pelo benchmark da VPS) | lotado → recusa clara "Sala cheia" e oferece espectador |
| `MAX_SPECTATORS_PER_ROOM` | ex. 300 | |
| `PV_GRAFFITI_FILE` | `/opt/tretario/shared/data/graffiti.json` | fora do release |
| `PV_TELEMETRY_FILE` | `/opt/tretario/shared/data/telemetry.jsonl` | |
| `PV_LOG_FORMAT` | `json` | logs estruturados (journald) |
| `PV_BUILD_COMMIT` / `PV_BUILD_TIME` | lidos de `current/version.json` | gerado pelo deploy |
| `CLEANUP_*` | padrões | rodada 8.1 |
| PROIBIDOS em produção | `PV_TEST`, `PV_ALLOW_ANON_PLAYERS`, `PV_DEV_MAIL`, `PV_STORE=memory` | o servidor deve RECUSAR subir com eles se `NODE_ENV=production` |

## Layout no servidor

```
/opt/tretario/
  releases/<commit>/        código + node_modules + dist + version.json (imutável depois de pronto)
  current -> releases/<commit>
  shared/
    env/server.env          secrets (600)
    data/                   graffiti.json, telemetry.jsonl
    backups/{daily,weekly}/ pg_dump -Fc
    deploy.lock, releases.log
/var/www/tretario-maintenance/index.html   página de manutenção (Nginx)
```

- Usuário do sistema `tretario` (sem shell de login, sem sudo) roda o app; deploy feito por usuário administrativo
  com sudo (SSH por chave). `tretario.service` (systemd): `Restart=always`, `KillSignal=SIGTERM`, `TimeoutStopSec=20`,
  `EnvironmentFile=/opt/tretario/shared/env/server.env`, `WorkingDirectory=/opt/tretario/current/server`,
  limites de memória (`MemoryMax`), logs no journald.
- Manutenção: arquivo-flag `/opt/tretario/shared/maintenance.on` → Nginx serve a página 503 (exceto `/health/live`).

## Scripts (`scripts/`)

`provision-vps.sh` (idempotente; Ubuntu 24.04 LTS) · `deploy-production.sh` · `rollback-production.sh` ·
`backup-db.sh` (diário 7 + semanal 4) · `restore-test.sh` (restaura num banco TEMPORÁRIO e confere tabelas/contagens;
nunca por cima da produção) · `maintenance.sh on|off` · `smoke-production.sh <url>`.
