# Deploy de produção

Contrato (portas, rotas, env, layout): [`deploy/CONTRACT.md`](../deploy/CONTRACT.md). Arquitetura:
[PRODUCTION.md](PRODUCTION.md). Operação: [OPERATIONS.md](OPERATIONS.md).

| Script | Quem / onde | Faz |
|---|---|---|
| `scripts/provision-vps.sh` | admin com sudo, uma vez (e depois de mudar `deploy/`) | pacotes, usuário `tretario`, layout, Node, PostgreSQL, env, Nginx/HTTPS, ufw, fail2ban, journald/logrotate, unattended-upgrades, units systemd, espelho git, SSH (opcional) |
| `scripts/deploy-production.sh [commit\|branch]` | admin (não root) | build verificado → backup → guarda de migration → migrate → troca atômica → restart → ready → smoke |
| `scripts/rollback-production.sh [commit]` | admin | volta o APP para outro release (o banco nunca volta) |
| `scripts/smoke-production.sh https://dominio` | qualquer máquina | checagem de fora |

Todos usam `set -euo pipefail`, são idempotentes e passam no `shellcheck`.

## 1. Pré-requisitos

- VPS Ubuntu 24.04 LTS (8 GB), acesso por SSH com **chave** para um usuário administrador com `sudo`
  (não usar root direto). Produção prevista: `143.95.164.238`, SSH na porta **22022**, domínio **tretario.com.br**
  (+ `www`). A versão do Ubuntu ainda não foi auditada: o `provision-vps.sh` **recusa** rodar fora do 24.04.
- DNS: registro A (e AAAA, se houver IPv6) de `tretario.com.br` e `www.tretario.com.br` apontando para a VPS —
  necessário para o Let's Encrypt. O `www` só redireciona (301) para o domínio principal (origem única da CSP/CORS).
- Acesso de leitura ao repositório a partir da VPS. Repositório privado: criar uma **deploy key só-leitura**
  (`ssh-keygen -t ed25519 -f ~/.ssh/tretario_deploy` na conta do admin; chave pública em GitHub → Settings → Deploy
  keys) e usar a URL SSH (`git@github.com:mcoutinho2512/tretario.git`), com
  `Host github.com\n  IdentityFile ~/.ssh/tretario_deploy` no `~/.ssh/config` do admin.

## 2. Provisionar (uma vez)

```bash
ssh -p 22022 admin@143.95.164.238
git clone git@github.com:mcoutinho2512/tretario.git ~/tretario && cd ~/tretario
sudo scripts/provision-vps.sh --repo git@github.com:mcoutinho2512/tretario.git --ssh-port 22022 \
     --domain tretario.com.br --with-www --email <e-mail-do-responsável> --admin-ip <seu-ip-fixo>
```

- `--ssh-port 22022`: é a porta liberada no ufw (antes de ativá-lo) e vigiada pelo fail2ban. O script lê a porta real
  do `sshd -T` e **recusa** se ela for diferente da informada (nunca abre o ufw sem a porta do SSH). A 22 não é aberta.

- Sem `--domain`: tudo é instalado, mas o Nginx só responde a página de manutenção em :80 (o jogo nunca sai em HTTP
  puro). Rodar de novo com `--domain/--email` quando o DNS existir: o script emite o certificado (webroot), troca para
  a config completa e preenche só o marcador `__DOMAIN__` do `server.env` (cópia `.bak-*` ao lado).
- `server.env` é criado **uma vez** a partir de `deploy/server.env.example` com senha do banco, `PV_SESSION_SECRET`
  e `PV_ADMIN_TOKEN` gerados (`openssl rand`); nunca é sobrescrito. **Guarde uma cópia fora da VPS.**
- Node: binário oficial `v20.20.2` (mesmo major do desenvolvimento) com SHA-256 conferido; outro:
  `--node-version`. Node 20 saiu de suporte (abril/2026) — migrar para o 22/24 LTS é pendência do projeto.
- SSH: o script **não** desliga senha sozinho. Depois de confirmar numa SEGUNDA sessão que a chave entra,
  `sudo scripts/provision-vps.sh --harden-ssh` (pede para digitar `SIM`; recusa se `authorized_keys` estiver vazio;
  testa `sshd -t` e desfaz se falhar).
- O fim imprime o que falta (domínio, certificado, espelho git, primeiro deploy).

## 3. Primeiro deploy

```bash
cd ~/tretario
scripts/deploy-production.sh master          # ou um commit publicado
```

O primeiro deploy aplica todas as migrations no banco vazio (o backup pré-deploy de um banco vazio também é feito)
e liga o serviço. Depois: criar/aprovar contas (`npm run prod:approve`, ver [OPERATIONS.md](OPERATIONS.md)).

## 4. Deploy normal

```bash
cd /opt/tretario/current        # scripts do release no ar (ou o clone do admin atualizado)
scripts/deploy-production.sh master
```

Passos (qualquer falha antes da troca **não altera produção**):

1. `flock` em `shared/deploy.lock` (um deploy/rollback por vez).
2. `git fetch` no espelho `/opt/tretario/repo.git`; o commit precisa existir e estar em algum branch do origin.
3. Build em `releases/.build-<commit>` a partir de um checkout limpo (`git clone --shared` + `checkout --detach`),
   com `nice`/`ionice` (o jogo continua no ar): `npm ci` (raiz + server) → `npm run verify` (**aborta se falhar**) →
   `npm run build` → checkout ainda limpo (`git status --porcelain` vazio) → `npm run build:version`
   (`PV_BUILD_COMMIT`/`PV_BUILD_TIME`; se o script não existir/gerar nada, o deploy escreve `version.json`) →
   **sem** `npm prune --omit=dev` (o servidor roda com `tsx` e a CLI usa `prisma`, ambos devDependencies) → remove `.git` → `.release-ok` → dono `root`, sem escrita → `mv` para
   `releases/<commit12>`. Release já construído e verificado é reaproveitado.
4. **Backup** (`backup-db.sh --kind predeploy`) — falhou, aborta.
5. Estado das migrations (`_prisma_migrations` × pasta do release): migration incompleta no banco → aborta; banco com
   migration que o release não conhece → aborta (é downgrade: use rollback). `prisma migrate status` impresso.
6. **Guarda destrutiva** nas pendentes (abaixo) + `prisma migrate diff` (banco → schema do release) informativo.
7. `prisma migrate deploy` (só se houver pendentes). Falhou → para, o app antigo continua, mensagem com o backup.
8. Troca atômica: `ln -s releases/<commit> current.new && mv -T current.new current`.
9. `systemctl restart tretario` (SIGTERM, até 20 s) e espera `/health/ready` (90 s, `--ready-timeout`).
   Não ficou pronto → `current` volta ao release anterior + restart + mensagem destacada (**o banco não é tocado**).
10. Smoke de fora (`PV_PUBLIC_ORIGIN` ou `--url`); falha → aviso destacado, `result=smoke_failed`, sem rollback automático.
11. Linha no `shared/releases.log`: `action, commit, ref, prev, result, duration_s, downtime_ms, migrations=y(...)|n, backup`.
12. Poda: mantém os 5 releases mais novos (`KEEP_RELEASES`), nunca o atual nem o anterior.
13. Imprime a indisponibilidade medida (restart → ready).

## 5. Migrations: EXPAND → MIGRATE → CONTRACT

O deploy migra **antes** de trocar o código, com o release antigo no ar; o rollback nunca desfaz migrations. Logo,
toda migration precisa funcionar com o código **anterior e o novo** ao mesmo tempo:

1. **EXPAND** (um deploy): só acrescentar — tabela nova, coluna nova opcional ou com default, índice. O código novo
   passa a escrever nos dois formatos (ou no novo, lendo os dois).
2. **MIGRATE** (dados): preencher o novo a partir do antigo em lotes (script/CLI ou migration de `UPDATE`
   idempotente), com o código já tolerante.
3. **CONTRACT** (deploy posterior, quando nenhum release guardado usa o antigo): remover coluna/tabela, apertar
   `NOT NULL`, trocar tipo.

A guarda do deploy procura nas migrations **pendentes** (comentários `--` ignorados): `DROP TABLE|SCHEMA|DATABASE|TYPE|VIEW|SEQUENCE`,
`DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, `ALTER COLUMN … [SET DATA] TYPE` (troca/estreitamento de tipo), `RENAME
COLUMN|TO`. Achou → **aborta antes de migrar** listando as linhas. Só passa com
`--allow-destructive=<nome_da_migration>` (uma por migration, nunca padrão), depois de: conferir que nenhum release
que pode voltar ao ar usa o que será removido, ter o backup pré-deploy testado (`restore-test.sh`) e aceitar que o
rollback de app deixa de ser possível para antes do CONTRACT.

Nunca: editar migration aplicada, `prisma migrate dev`/`reset`/`db push` em produção.

## 6. Rollback

```bash
scripts/rollback-production.sh                 # o anterior (último deploy ok diferente do atual)
scripts/rollback-production.sh <commit>        # um release guardado (ls /opt/tretario/releases)
```

Só troca `current` e reinicia; **o banco não volta**. Confere que todas as migrations do release-alvo estão
aplicadas (prefixo); se o banco tiver migrations mais novas que o alvo, imprime o aviso EXPAND/CONTRACT e
**aborta**, a menos que `--force-app-only` (você conferiu que as migrations extras são aditivas). Depois:
`/health/ready`, smoke e linha `action=rollback` no `releases.log`.

## 7. Releases

```
/opt/tretario/releases/<commit12>/   código + node_modules completos (raiz e server: tsx e prisma CLI)
                                     + dist + version.json + .release-ok (dono root, imutável)
/opt/tretario/current -> releases/<commit12>
/opt/tretario/shared/releases.log    histórico de deploys/rollbacks
```

Tamanho medido no container: ~690 MB por release com a raiz podada (`server/node_modules` 444 MB, raiz 113 MB); sem a
poda (atual) a raiz completa tem ~220 MB (medido no Mac de desenvolvimento) → estimativa ~800 MB por release, 5
releases ≈ 4 GB (não medido no Linux). Medir na VPS (`du -sh /opt/tretario/releases/*`) e baixar `KEEP_RELEASES` se o disco for pequeno.

## Validação local

**Validado localmente em container** (2026-10-18), sem VPS: Ubuntu 24.04 (`ubuntu:24.04`, arm64) com **systemd como
PID 1** (`--privileged --cgroupns=host`), no Docker do Mac de desenvolvimento. Rede, CPU e disco não representam a
VPS. O container, a imagem e a origem git de teste foram descartados no fim; o banco de desenvolvimento `pv3d-db` não
foi tocado.

O código do app (rotas `/health/*`, `/api/status`, `/internal/health`, endpoint same-origin do cliente,
`build:version`, checagens de env) está sendo feito em paralelo (P2). Para exercitar os scripts, a origem git do
container recebeu um commit **só de teste** com um shim mínimo dessas rotas em `server/src/index.ts` (não está no
repositório). Os números de "pronto" abaixo são com esse shim (o `/health/ready` real também consulta o banco).

| Item | Resultado |
|---|---|
| `provision-vps.sh` sem domínio | ok em 34 s (apt completo): pacotes, usuário `tretario` (nologin), layout/permissões do contrato, Node 20.20.2 (SHA-256 ok), PG16 com `shared_buffers=1GB`, `effective_cache_size=3GB`, `work_mem=8MB`, `max_connections=50`, `listen_addresses=localhost` (`ss`: só 127.0.0.1/::1:5432), role/banco criados, `server.env` 600; Nginx bootstrap (`:80` → 503 manutenção); timers ativos |
| de novo com `--domain` (certificado autoassinado de uma CA local no caminho do Let's Encrypt) | marcador `__DOMAIN__` preenchido, config completa ativa, `nginx -t` ok |
| 3ª e 4ª execução | 0 arquivos reinstalados, `server.env` com o mesmo SHA-256 |
| `--harden-ssh` sem `authorized_keys` | recusado ("você ficaria trancado"); nenhum arquivo em `sshd_config.d` |
| journald / logrotate / unattended-upgrades / Nginx | `SystemMaxUse=1G`, `MaxRetentionSec=1month`; `logrotate -d` lê os logs; `Automatic-Reboot "false"`; `worker_connections 8192` |
| fail2ban (sshd) | com `ignoreself` desligado só em execução: 7 senhas erradas → `Ban 172.17.0.2`; `fail2ban-client set sshd unbanip` → 0 banidos. Achado corrigido: no Ubuntu 24.04 a unit é `ssh.service`, então o jail casa por `_COMM=sshd` |
| deploy 1 (banco vazio) | build + `npm ci` + `verify` (62 arquivos / 587 testes) + build em 82 s; backup pré-deploy; 5 migrations aplicadas; pronto em **815 ms** |
| deploy 2 (migration aditiva de teste) | backup 42 KB (50 contas sintéticas); `migrate status` → 1 pendente; diff sem destrutivo; aplicada; pronto em **1095 ms**; smoke 16/16 |
| sonda de fora a cada 100 ms durante o deploy 2 | 9 respostas 502 seguidas (~1 s), o resto 200 |
| deploy 3 (`DROP TABLE` de teste) | **abortado** antes de migrar: `[destrutiva] … 2:DROP TABLE "OpsProbe";` (linha de comentário ignorada); release mantido; com `--allow-destructive=<nome>`: release reaproveitado, migration aplicada, pronto em 1115 ms |
| ref inexistente | "commit/branch 'nao-existe' não existe no origin" |
| rollback sem argumento (banco mais novo que o alvo) | **abortado** com o aviso EXPAND/CONTRACT; com `--force-app-only`: pronto em 822 ms, smoke ok |
| rollback para um commit (prefixo `81c9048`) | pronto em 1068 ms (smoke falhou porque o smoke DAQUELE release tinha um bug já corrigido — o smoke roda do release-alvo) |
| redeploy de `master` | release reaproveitado, 0 pendentes, pronto em 827 ms |
| SIGTERM / partida | parada graciosa em 13 ms (sem jogadores); `Started` → `[pv3d-server] ws://…` em 0,89 s com `node --import tsx`; RSS ~250 MB ocioso |
| `verify` dentro do deploy com o container vendo 15 CPUs e o Mac carregado (load 20–24 de outros agentes) | 4 de 7 execuções falharam por **testes com tempo estourado (5 s)** → o deploy abortou corretamente ("NADA foi alterado"). Nessas, a sonda viu 6 respostas do jogo > 1 s durante o build |
| container restrito a 4 CPUs (`--cpuset-cpus 0-3`, perto de uma VPS de 4 vCPU) | 2 de 2 deploys passaram: `npm ci` 7–15 s, `verify` 72–73 s, build 5–7 s, release pronto em 87–98 s; poda com `KEEP_RELEASES=2` removeu os 2 mais velhos (nunca atual/anterior). Sonda a cada 100 ms pelo Nginx durante o build inteiro: `/health/ready` p50 4 ms, p99 10 ms, máx. 31 ms; no restart, 7 respostas 502 em 664 ms; indisponibilidade medida pelo script: 807 ms |
| Nginx (HTTPS, cabeçalhos) | smoke: TLS válido, `:80` → 301, HSTS, CSP, nosniff, `X-Robots-Tag: noindex`, index `no-cache`, `/assets` imutável, `/world/chunk_*` imutável, `manifest.json` `no-cache`, gzip em JS, `/internal/health` e `/metrics` 403 de fora, `/_headers` e `/.env` 404, corpo de 300 KB → 413 |
| `X-Forwarded-For` | `curl -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 7.7.7.7'` chegou ao backend como `172.17.0.2` nos dois |
| limites de taxa | 40× `POST /api/auth/login` → 11 passam, 29 × 429; 30× `/api/session/ticket` → 11 passam, 19 × 429; 20× `POST /game/matchmake/joinOrCreate/…` → 11 × 200, 9 × 429 (zona `tretario_matchmake`, 30/min, burst 10: o app não limita o matchmaking) |
| `www` e porta SSH | `https://www.tretario.test/x?y=1` → 301 `https://tretario.test/x?y=1`; `http://www…` → 301 https; `--ssh-port 22022` com o sshd em 22 → recusado sem alterar nada; com a porta certa → `port = 22` no jail do fail2ban |
| WebSocket | handshake `101` em `/game/`; entrada REAL na sala como espectador pelo Nginx (`ws-join-check.mjs`, SDK Colyseus): ~100–160 ms |
| Chrome headless pela proxy (`--host-resolver-rules`, CSP real) | página 200, mundo visível em 4,7 s, **0 violações de CSP**, 0 erros de página, WebSocket `wss://tretario.test/game/…`, HUD "Multiplayer conectado (wss://tretario.test/game)" — com `?mp=wss://<host>/game` (cliente atual ainda usa `ws://host:2567`; sem o parâmetro a CSP bloqueia `connect-src http://tretario.test:2567/matchmake/…`, como deve) |
| manutenção | `on` → `/`, `/api/status`, `/health/ready`, `/game/` = 503 com a página própria (`Retry-After: 120`, `no-store`); `/health/live` = 200; `off` → 200. Achado corrigido: o `map` precisa de `volatile` (senão o redirecionamento interno do `error_page` caía no 503 padrão) |
| backup pelo systemd | `tretario-backup.service` → `Result=success`, linha JSON, `.sha256` |
| restore-test | `--strict` + `--expect` (User=50, Report=3, MuteRelationship=2, PlayerProgress=20, CompletedMission=10): ok em 1,7 s, 7 migrations, temporário apagado; expectativa errada → falha e o temporário também é apagado; dump adulterado → "SHA-256 do dump não confere" |
| health-check | `tretario` parado → `alert` com "serviço tretario: inactive" + "/health/ready falhou", unit falha; de volta → `alert` some, `RECOVERED` no `health.log` |

Achados para o app (fora dos scripts), observados com `NODE_ENV=production` no container antes do trabalho do P2:
`GET /api/me` → 500 (`DevelopmentMailProvider recusado em produção`), o que também derruba `POST /api/auth/*`; e o
cliente ainda conecta em `ws://<host>:2567` (bloqueado pela CSP de produção, como deve). Ambos são escopo da rodada
9.1 do app (`PV_REGISTRATION=beta`, endpoint same-origin) e precisam ser revalidados com o smoke depois do merge.

Deploy com o app do P2 (branch `worktree-agent-ad0e70d537dd9dcb9`, commit `306e830`, sem o shim) no mesmo container:
o `verify` falhou **2 de 2** vezes, sempre em `tests/productionServer.test.ts` › "SIGTERM: … sai com 0" (`expected
null to be +0`): no Linux o `npx` que o teste usa morre pelo próprio sinal (código `null`), no macOS passa. O deploy
abortou antes de tocar no banco, como deve. Precisa de correção no teste (ou rodar o servidor sem o `npx` no meio)
antes do primeiro deploy real; enquanto isso as rotas reais do P2 não foram exercitadas pelos scripts. O
`health-check.sh` e o `server-status.sh` já leem os campos do `/internal/health` do P2 (`tick.avgMs`,
`eventLoop.p99Ms`, `players`, `memory.rssMB`…; conferido com o código, não em execução).

### Falta validar na VPS real

- Emissão/renovação real do Let's Encrypt (`certbot certonly --webroot`, `renew --dry-run`, hook de reload) e o
  redirecionamento 80→443 com DNS de verdade.
- ufw ativo (22/80/443) e o ban do fail2ban bloqueando de fato (no container o ufw não foi ligado); `--harden-ssh`
  com uma segunda sessão real.
- Swap de 2 GB, `sysctl`, unattended-upgrades num ciclo real, journald sob volume.
- Clone do espelho com deploy key do GitHub (privado).
- Tempo de `npm ci` + `verify` + build na CPU da VPS e com o jogo no ar; impacto no tick durante o build.
- Indisponibilidade de deploy com jogadores conectados (o desligamento gracioso com sessões e o flush de progresso
  levam mais que os 13 ms medidos sem ninguém).
- Rotas reais do P2 (`/health/ready` com `SELECT 1`, `/internal/health` com tick/lag) e os nomes dos campos lidos
  pelo `health-check.sh`/`server-status.sh`.
- Benchmark de capacidade ([PRODUCTION.md](PRODUCTION.md#capacidade-preencher-com-o-benchmark-na-vps-real)) e
  `MemoryMax`.
