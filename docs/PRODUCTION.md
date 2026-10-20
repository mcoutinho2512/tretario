# Produção BETA (rodada 9.1; rodada 10 no mesmo layout)

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

## Memória (dimensionada para 8 GB; a VPS real tem 11 GB, compartilhados)

| Peça | Reserva |
|---|---|
| PostgreSQL | `shared_buffers` 1 GB, `work_mem` 8 MB × `max_connections` 50, `effective_cache_size` 3 GB (dica ao planejador) |
| App | `MemoryHigh` 2,5 GB / `MemoryMax` 3 GB (systemd), heap V8 `--max-old-space-size=2048` |
| Nginx, SO, cache de página | o resto (~3 GB) |
| Swap | 2 GB em arquivo (só rede de segurança para o build do deploy) |

## Capacidade (medida na VPS de produção, 18/10/2026)

VPS: Ubuntu 22.04.5, **4 vCPU AMD EPYC 9J45, 11 GB RAM, 295 GB** (compartilhada com outros sistemas — GymTeam em
produção). Método: instância de TESTE isolada do servidor (mesmo release, `PV_TEST=1`, banco em memória, só
127.0.0.1:2667) + bots no Mac por túnel SSH (`PV_LOADTEST_EXTERNAL=1 server/tools/loadtest.ts`), cenário realista
da rodada 9 em área DENSA (pior caso de AOI): 20 % ações sociais, grupos, 30 msgs/min de chat, 8 % em confronto.
Saúde do GymTeam conferida a cada 5 s durante o teste (sempre 200, 0,10–0,17 s). Dados: `docs/screenshots/loadtest_vps_*.json`.

| Bots | Tick médio / máx | CPU do processo (1 núcleo) | Event loop (ELU) | Banda por jogador | Saída total | Load da VPS |
|---|---|---|---|---|---|---|
| 50 | 1,0 / 2,7 ms | 7,5 % | 0,09 | 5,7 KB/s | 0,29 MB/s | 0,1 |
| 100 | 1,8 / 5,5 ms | 12,5 % | 0,13 | 7,8 KB/s | 0,78 MB/s | 0,1 |
| 250 | 4,9 / 10,4 ms | 26,5 % | 0,26 | 12,8 KB/s | 3,2 MB/s | 0,3 |
| 500 | 13,5 / 33,7 ms | 56 % | 0,52 | 20,9 KB/s | 10,5 MB/s (~84 Mbit/s) | 0,8 |

**Limite beta: `MAX_PLAYERS_PER_ROOM=250`, `MAX_SPECTATORS_PER_ROOM=300`** (configurado em `server.env`). Margem de 2×
até o ponto medido de 500 (ELU 0,26 vs 0,52; tick 4,9 ms vs 13,5 ms), máquina dividida com outros sistemas e banda
real da VPS desconhecida (a 500 o servidor envia ~84 Mbit/s). Subir o limite só depois de medir a banda disponível
(`vnstat`/`nload`) e com o tick máximo < 40 ms. Lotado → recusa clara "Sala cheia" e oferta de entrar como espectador.

| Outras medidas | Valor |
|---|---|
| RSS do processo ocioso / com 500 bots | ~260 MB / 381 MB |
| Indisponibilidade de um deploy (restart → ready) | 0,8–1,5 s (`releases.log`); rollback 1,5 s |
| Deploy completo (npm ci + verify 619 testes + build) | 111–123 s |
| Primeira visita: home / espectador no mundo / jogador no mundo | 0,2 s / 3,2 s / 6,9 s (Chrome desktop, rede doméstica) |

## Rodada 10 (19/10/2026)

- Mesmo layout, mesmos serviços e mesmo pipeline. Nenhuma porta, rota ou variável de ambiente nova.
- **Migration** `20261018220000_round10_supporter_profile`: só `ALTER TABLE "Profile" ADD COLUMN` de três colunas
  NULLABLE (`supporterGroup`, `supporterPending`, `supporterChangedAt`) — EXPAND puro, instantâneo no PostgreSQL 16
  (sem reescrita da tabela), compatível com o release anterior (o rollback do app para a 9.1 continua seguro).
- **Rotas novas** atrás do mesmo `/api/`: `GET/PUT /api/me/supporter`; mensagem de sala `user_report` (denúncia de
  jogador) e `sup` (torcida de visitante sem conta, só em memória).
- **Áudio**: 100 % gerado no navegador (Worker + WebAudio); nenhum arquivo de som servido, CSP inalterada.
- **Capacidade** (mesma máquina de desenvolvimento, 9.1 × 10, `docs/bench/round10_compare_*.json`): servidor igual
  dentro do ruído (500 bots densos: tick 8,9 → 9,1 ms, CPU 35 → 37 %; 50 veículos ativos: tick 0,87 → 0,84 ms). O
  limite beta de 250 por sala continua.

## Rodada 11

- Mesmo layout, serviços, portas e pipeline; nenhuma variável de ambiente nova; CSP inalterada (nenhum asset externo).
- **Migration** `20261019120000_round11_profile_title`: `ALTER TABLE "Profile" ADD COLUMN "titleKey" TEXT` (NULLABLE)
  — EXPAND puro, instantâneo, compatível com o release anterior (rollback do app para a rodada 10 continua seguro).
- **Rotas/mensagens novas** atrás do mesmo `/api/`: `GET/PUT /api/me/title` (validado contra os títulos ganhos);
  `PUT /api/me/appearance` aceita `strict` (403 `bloqueado` com a lista do que não é da conta); mensagem de sala
  `title`. Perfil público (`/api/profile/:nickname`) ganha `level` e `title` (dados públicos; ver PRIVACY_ARCHITECTURE).
- **Rede**: `NetPlayer.lvl` (u8, 1 Hz) e `NetPlayer.title` (≤ 48 caracteres) — banda por cliente igual dentro do ruído.
- **Capacidade** (mesma máquina, 10 × 11, `docs/bench/round11_compare_*.json`): servidor igual (500 densos: tick
  7,5 → 7,6 ms, CPU 32 → 30 %; 50 veículos: 0,41 → 0,38 ms). Limite beta de 250 por sala mantido.

## Rodada 12

- Mesmo layout, serviços, portas e pipeline; CSP inalterada. **Nenhuma migration** (nada novo persiste: autônomos,
  veículos pessoais e eventos dinâmicos vivem só na sala).
- **Variáveis opcionais** (sem valor = padrão de produção; não é preciso mexer no `server.env`):
  `PV_AUTONOMOUS` — quantidade de personagens autônomos (padrão `population.maxActive` de
  `public/gameplay/autonomous.json` = 220, −3 por humano, mínimo 60; `off` desliga); `PV_PVEH_IDLE_MS` — tempo até
  recolher um veículo pessoal abandonado (padrão 45 s). Com `PV_TEST=1` os autônomos começam desligados.
- **Autônomos não ocupam vaga**: a lotação (`MAX_PLAYERS_PER_ROOM` = 250) conta `state.players - autônomos`; eles
  nunca entram em `/api/metrics/public`, no contador da home nem no telão. `/metrics` (interno) ganhou `aiMs`,
  `aiDecideMs/MoveMs/SocialMs`, `aiDecisionsPerSec`, `autonomousPopulation/Active/Near/Mid/Far/Dormant`,
  `collisionMs`, `collisionBodies`, `neighborQueries`, `bodyCorrections`, `unstucks`.
- **Mensagens novas** da sala: `pveh_req` (veículo pessoal; taxa e validação no servidor), `unstuck` (o servidor
  escolhe o ponto livre), `dyn` (servidor → cliente: focos dinâmicos para minimapa/áudio). `qa_dyn` só existe com
  `PV_TEST=1`. **Rede**: `NetPlayer.kind` (0 humano · 1 autônomo · 2 bot de carga), `look`, `tag`; `NetVehicle.owner`.
- **Capacidade** (mesma máquina, 11 × 12, `docs/bench/round12_compare_*.json`): mesma carga, servidor igual (500
  densos tick 7,55 → 7,27 ms, CPU 33 → 32 %). Com os 220 autônomos: 500 densos tick 9,5 ms, CPU 34 %; pico de RSS
  ~400–470 MB com 500 (antes ~300 MB) — folga ampla nos 11 GB da VPS. Limite beta de 250 por sala mantido.

