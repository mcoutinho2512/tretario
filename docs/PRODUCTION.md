# Produção BETA (rodada 9.1)

Fonte única de portas, rotas, env e layout: [`deploy/CONTRACT.md`](../deploy/CONTRACT.md). Este documento descreve a
arquitetura e os componentes; o passo a passo está em [DEPLOYMENT.md](DEPLOYMENT.md), a operação diária em
[OPERATIONS.md](OPERATIONS.md), backup em [BACKUP_RESTORE.md](BACKUP_RESTORE.md), monitoração em
[MONITORING.md](MONITORING.md) e incidentes em [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

**Dados de produção não são descartáveis.** Nada de `prisma migrate reset`, `db push --accept-data-loss`,
`DROP DATABASE/SCHEMA`, apagar `/var/lib/postgresql`, sobrescrever `server.env`, segredo no Git, force push, 5432
público ou deploy com `verify` falhando. Os scripts recusam esses caminhos.

## Arquitetura

```
                 Internet
                    │  só 22022 (SSH, chave), 80 e 443 abertos (ufw) · fail2ban no sshd
                    ▼
        ┌───────────────────────── VPS Ubuntu 24.04 (8 GB) ──────────────────────────┐
        │  Nginx :80 → 301 https   :443 tretario.com.br (TLS LE, HSTS, CSP; www→301)  │
        │     │                                │                                      │
        │     │   /            /assets/ …  ────┼──► arquivos /opt/tretario/current/dist│
        │     │   /game/  (WebSocket) ─────────┼──► 127.0.0.1:2567  Colyseus (sala)   │
        │     │   /api/  /health/  ────────────┼──► 127.0.0.1:2568  API + health      │
        │     │   /internal/  /metrics ── 403 de fora (só 127.0.0.1)                  │
        │     │   shared/maintenance.on existe → 503 (página estática), exceto        │
        │     │                                  /health/live                         │
        │                                                                             │
        │  tretario.service (systemd, usuário tretario, sem shell)                    │
        │     node --import tsx server/src/index.ts  ── um processo: jogo + API       │
        │     env: /opt/tretario/shared/env/server.env (600)                          │
        │            │                                                                │
        │            ▼                                                                │
        │  PostgreSQL 16 nativo, 127.0.0.1:5432 (role/banco tretario)                 │
        │                                                                             │
        │  timers: tretario-backup (04:30, pg_dump -Fc) · tretario-health (1 min)     │
        │          certbot.timer (renovação) · unattended-upgrades (só segurança)     │
        └─────────────────────────────────────────────────────────────────────────────┘
```

## Componentes

| Componente | Onde | Configuração versionada |
|---|---|---|
| Nginx 1.24 (Ubuntu) | `/etc/nginx/sites-available/tretario.conf` + `snippets/tretario-{headers,proxy}.conf` | `deploy/nginx/` (modelo com `__DOMAIN__`); antes do certificado: `tretario-bootstrap.conf` (só ACME + manutenção em :80) |
| Página de manutenção | `/var/www/tretario-maintenance/index.html` | `deploy/maintenance/index.html` (autocontida) |
| App (jogo + API) | `/opt/tretario/current` → `releases/<commit>` | `deploy/systemd/tretario.service` |
| Node 20 (binário oficial, SHA-256 conferido) | `/usr/local/lib/nodejs/node-v20.20.2-linux-*` | `provision-vps.sh --node-version` |
| PostgreSQL 16 | pacote do Ubuntu, dados em `/var/lib/postgresql/16/main` | `deploy/postgres/90-tretario.conf` (conf.d) |
| Segredos | `/opt/tretario/shared/env/server.env` (600, `tretario`) | modelo sem segredo: `deploy/server.env.example` |
| Dados do app fora do release | `shared/data/` (graffiti.json, telemetry.jsonl) | — |
| Backups | `shared/backups/{daily,weekly,predeploy}` | `scripts/backup-db.sh`, `deploy/systemd/tretario-backup.*` |
| Saúde | `shared/monitor/{status,alert}`, `shared/logs/health.log` | `scripts/health-check.sh`, `deploy/systemd/tretario-health.*` |
| Logs | journald (limite 1 GB, 1 mês) + logrotate de `shared/logs/` | `deploy/system/` |
| Espelho git usado pelo deploy | `/opt/tretario/repo.git` (`git clone --mirror`, dono = administrador) | — |

Por que `tsx` e não JS compilado: `server/tsconfig.json` é `noEmit` com imports `.ts` e o servidor importa módulos
de `src/` (cliente) por caminho relativo; compilar exigiria outro tsconfig/bundler. `node --import tsx` roda no
mesmo processo (o SIGTERM do systemd chega direto ao Colyseus) e a partida medida no container foi registrada em
[DEPLOYMENT.md](DEPLOYMENT.md#validação-local).

## Memória (VPS de 8 GB)

| Peça | Reserva |
|---|---|
| PostgreSQL | `shared_buffers` 1 GB, `work_mem` 8 MB × `max_connections` 50, `effective_cache_size` 3 GB (dica ao planejador) |
| App | `MemoryHigh` 2,5 GB / `MemoryMax` 3 GB (systemd), heap V8 `--max-old-space-size=2048` |
| Nginx, SO, cache de página | o resto (~3 GB) |
| Swap | 2 GB em arquivo (só rede de segurança para o build do deploy) |

## Capacidade (PREENCHER com o benchmark na VPS real)

Os números abaixo são **lacunas**: só valem medidos na VPS de produção (CPU, rede e disco reais). O container
local não serve de referência (outra CPU/arquitetura, sem rede real).

| Medida | Valor | Como medir |
|---|---|---|
| CPU / vCPUs / modelo | _a medir_ | `lscpu` |
| Jogadores simultâneos com tick < 40 ms | _a medir_ | `tools/qa/load_bench.mjs` apontando para `wss://<domínio>/game` |
| Espectadores simultâneos | _a medir_ | idem, `role: 'spectator'` |
| RSS do processo com N jogadores | _a medir_ | `scripts/server-status.sh` (`MemoryCurrent`) |
| Banda de saída por jogador | _a medir_ | `nload`/`vnstat` durante o benchmark |
| `MAX_PLAYERS_PER_ROOM` / `MAX_SPECTATORS_PER_ROOM` | 150 / 300 (provisório) | ajustar no `server.env` após o benchmark |
| Indisponibilidade de um deploy (restart → ready) | _a medir_ (container: ver DEPLOYMENT.md) | linha `downtime_ms` do `releases.log` |
