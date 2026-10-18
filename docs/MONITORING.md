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

## Memória (rodada 9.1)

Soak de 62 min (`docs/soak/round9_1.json`, 120 bots, `SOAK_R9=1`) mostrava, nos últimos 30 min: heap pós-GC
+0,13 MB/min, livro-razão da GPU +1,0 MB/min e nós do DOM (CDP `Nodes`) +3,7/min. Investigação com o build de
produção (`vite build` + `vite preview`), runs de 16–35 min, snapshots do heap (`HeapProfiler.takeHeapSnapshot`) e o
livro-razão agrupado por tamanho/formato (`SOAK_SNAP`, `tools/qa/heap_diff.mjs`, `tools/qa/leak_track.mjs`).

**Causas encontradas**

| Sintoma | Causa | Evidência | Correção |
|---|---|---|---|
| GPU sobe em degraus de 3 MB | `BillboardSystem` (painéis de LED) guardava para sempre uma CanvasTexture 1024×576 (com mipmaps, ~3 MB) por conteúdo novo — cada AdSlot de evento (nome + horário) é um conteúdo novo | livro-razão `tex:1024x576` 11→14 em 12 min, fora de qualquer material da cena (`unattributedTexMB`); pilha de criação `textCanvas ← BillboardSystem.textureFor` | `src/events/Billboards.ts`: cache LRU — ficam as texturas em uso + `BILLBOARD_KEEP_UNUSED` (6); as demais são descartadas (`dispose`, vídeo pausado). Depois: 8–10, estável. Teste: `tests/billboards.test.ts` |
| registro de QA do chat sem limite | `ChatPanel.events` guardava cada `chat_hello` (vem a cada reconexão, com o histórico inteiro) | `netDrop` a cada ciclo do soak | `src/ui/ChatPanel.ts`: no máximo 40 eventos |

**O que NÃO é vazamento** (explica o resto da inclinação)

- **Nós do DOM**: o crescimento é o log do chat — cada mensagem própria do soak (1 por ciclo de ~3,5 min) vira um
  `<li>` com 5 elementos + 4 textos. O log é limitado a 200 linhas (`MAX_LINES`, ~1800 nós) e estabiliza lá.
  Medido pelo novo campo `hud` das amostras: `hud-slot-chat>chat` +5 elementos por ciclo; o resto do HUD varia com o
  número de remotos (apelidos) e o estado do evento/debate.
- **GPU ±50 MB**: os alvos do pós-processamento (7 texturas RGBA16F + 4 renderbuffers MSAA) acompanham a resolução
  dinâmica (0,55–1 × tela) — ex.: 704×396 ↔ 1280×720. Amostras agora trazem `postMB` e `gpuNoPostMB`.
- **Aquecimento de caches limitados**: texturas das peças de roupa (GLB por estilo, ~33 de 1024²), texturas de design
  (`designTexture`, por design × alvo), pool de personagens remotos (`NetworkClient.pool`, `keep` por corpo; cada um
  com LOD0/LOD1 e um esqueleto + textura de ossos por camada — o GLTFLoader cria um Skeleton por malha).
- **Geometrias/texturas descartadas sem `dispose()`**: zero no rastreador (`gcd`) em todos os runs.

**Antes/depois** (inclinações por minuto, mínimos quadrados, amostra a cada 60 s; GPU = livro-razão)

| Run | Janela | Heap (MB/min) | GPU (MB/min) | GPU sem pós (MB/min) | Nós (/min) |
|---|---|---|---|---|---|
| antes — `round9_1.json` (62 min) | últimos 20 min | +0,053 | +1,335 | — | +3,33 |
| antes | últimos 30 min | +0,131 | +1,023 | — | +3,75 |
| depois — `round9_1_fix.json` (36 min) | últimos 20 min | +0,027 | +0,317 | +0,059 | +3,78 (log do chat) |
| depois | últimos 30 min | +0,073 | +0,759 | +0,241 | +3,76 (log do chat) |

Resíduo depois da correção (GPU sem pós +0,24 MB/min em 30 min): entre os minutos 11 e 35 o livro-razão ganhou 2
texturas de painel (8→10, dentro do limite em uso + 6) e ~40 buffers pequenos de geometria (+0,7 MB). Heap e nós
seguem dentro do ruído do ciclo dos remotos (+0,03–0,07 MB/min). Não houve run > 36 min depois da correção para
confirmar o platô do log do chat e do cache dos painéis.

Ferramentas: `SOAK_SNAP=11,23,35 SOAK_HEAPSNAP=0 SOAK_TRACK=1` (soak.mjs), `GEOM=1 OWNERS=<regex>` (heap_diff.mjs:
geometrias/texturas/materiais/esqueletos por dono do caminho de retenção). Comparar snapshots na MESMA fase do ciclo
dos bots (remotos sobem e descem a cada ~12 min) — senão a variação de remotos/NPCs domina a diferença.
