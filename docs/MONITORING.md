# Monitoração (produção BETA)

**Sem serviço externo por enquanto**: nada avisa por e-mail/telefone. A monitoração é local (timer a cada minuto +
arquivos de estado) e alguém precisa olhar (`scripts/server-status.sh`). Um monitor externo de disponibilidade
(ex.: checagem HTTP de fora a cada minuto em `https://<domínio>/health/ready`) é o próximo passo recomendado — é o
único jeito de saber que a VPS inteira caiu.

## Fontes

| Fonte | O que dá | Acesso |
|---|---|---|
| `GET /health/live` | processo vivo | público (Nginx), também durante a manutenção |
| `GET /health/ready` | banco respondendo (`SELECT 1`, 2 s) e servidor aceitando; 503 se não | público |
| `GET /api/status` | `{online, protocol, version}` | público |
| `GET /internal/health` | uptime, versão/commit/build, DB, jogadores, espectadores, salas, tick, lag do event loop, heap/RSS, WebSockets | **só** 127.0.0.1:2568 com `x-admin-token: $PV_ADMIN_TOKEN` (o Nginx devolve 403 de fora) |
| `GET /metrics` (PORT+1) | métricas existentes do servidor | só local |
| `journalctl -u tretario` | logs do app (`PV_LOG_FORMAT=json`) | admin |
| `shared/monitor/status` | última checagem (1 linha chave=valor) | admin (sem sudo) |
| `shared/monitor/alert` | existe **só** enquanto há problema (motivos, um por linha) | admin |
| `shared/logs/health.log` | histórico de `ALERT` e `RECOVERED` | admin |
| `shared/logs/backup.jsonl`, `restore-test.jsonl` | resultado de cada backup/teste | sudo |
| `shared/releases.log` | deploys/rollbacks: commit, resultado, duração, `downtime_ms`, migrations | sudo |

## Checagem a cada minuto (`tretario-health.timer` → `scripts/health-check.sh`, usuário `tretario`)

| Critério | Alerta quando | Variável (no `server.env`) |
|---|---|---|
| Serviço | `systemctl is-active tretario` ≠ `active` | — |
| App pronto | `/health/ready` sem `"ok":true` em 3 s | — |
| PostgreSQL | `pg_isready` falha em 3 s | — |
| Disco (`/` e `/opt/tretario`) | > 85 % | `HC_DISK_PCT` |
| RAM (1 − MemAvailable/MemTotal) | > 90 % | `HC_MEM_PCT` |
| Load (1 min) | > 2 × nº de CPUs | `HC_LOAD_PER_CPU` |
| Tick do servidor | > 40 ms (o patch é a cada 50 ms) | `HC_TICK_MS` |
| Lag do event loop | > 100 ms | `HC_LAG_MS` |
| Último backup (daily/predeploy) | mais velho que 26 h, ou nenhum | `HC_BACKUP_MAX_H` |

Tick, lag e jogadores vêm de `/internal/health`; o script lê os campos de forma tolerante (`tick.avgMs`, `tickMs`,
`eventLoopLagMs`…) e escreve `?` se o campo não existir — conferir os nomes reais na VPS após o primeiro deploy.
Com alerta: grava `alert`, uma linha `ALERT` no `health.log`, mensagem no journald (`journalctl -u tretario-health`)
e a unit termina com erro (aparece em `systemctl --failed`). Ao normalizar: apaga `alert` e grava `RECOVERED`.

Certificado: `scripts/smoke-production.sh` falha se faltarem menos de 14 dias; o `certbot.timer` renova sozinho
(a partir de 30 dias do fim). Cert vencendo = renovação quebrada → [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## Rotina sugerida

- **Diário** (2 min): `scripts/server-status.sh`; ver `shared/monitor/alert`; `journalctl -u tretario -p err --since yesterday`.
- **Semanal**: `sudo scripts/restore-test.sh <último daily>`; `sudo certbot certificates`; `df -h`; copiar um
  `weekly` para fora da VPS (até existir `BACKUP_REMOTE`).
- **Depois de cada deploy**: conferir `downtime_ms` e `result=ok` no `releases.log`; `journalctl -u tretario -p warning --since -10min`.

## O que ainda falta (sem serviço externo)

- Aviso ativo (e-mail/Telegram/página de status) e monitor externo de disponibilidade.
- Séries históricas (Prometheus/Grafana ou similar) — hoje só o instantâneo do minuto e os logs.
- Alerta de certificado independente do smoke.
