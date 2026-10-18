# Resposta a incidentes

Primeiro passo em qualquer caso: `cd /opt/tretario/current && scripts/server-status.sh` e anotar a hora. Regras que
valem para todos: **nunca** `prisma migrate reset`, `db push --accept-data-loss`, `DROP DATABASE/SCHEMA`, apagar
`/var/lib/postgresql`, sobrescrever `server.env`, abrir 5432, force push. Na dúvida, `scripts/maintenance.sh on`
compra tempo sem perder dados. Runbook diário: [OPERATIONS.md](OPERATIONS.md).

## API fora (HTTP 502/504 em `/api/`, `/health/ready` falhando)

- **Detecção**: `shared/monitor/alert` (`/health/ready falhou`), smoke falhando, jogadores sem login.
- **Imediato**: `systemctl status tretario`; `journalctl -u tretario -n 200`; `curl -s http://127.0.0.1:2568/health/live`
  (vivo mas não pronto → olhar o banco, seção Postgres). Processo morto em loop → `systemctl show tretario -p NRestarts`.
- **Recuperação**: reinício (`sudo systemctl restart tretario`). Começou depois de um deploy →
  `scripts/rollback-production.sh` (só o app). Erro de configuração no env → corrigir `server.env` e reiniciar.
- **Não fazer**: editar código dentro de `releases/`; desligar o health ou a manutenção “para parar o alerta”.

## WebSocket fora (página abre, jogo não conecta)

- **Detecção**: smoke falha em `handshake WebSocket /game/` ou `entrou como espectador`; clientes com “falha ao conectar”.
- **Imediato**: `curl -s http://127.0.0.1:2567/` direto (Colyseus vivo?); `sudo tail -50 /var/log/nginx/error.log`
  (upstream recusado/timeout); `sudo nginx -t`. Muitos jogadores → `worker_connections` (8192) / `LimitNOFILE`
  (65536) — `ss -s`.
- **Recuperação**: `sudo systemctl reload nginx` (não derruba conexões) ou restart do app. Cliente de versão
  diferente recebe close `4010` ("Nova versão disponível — recarregar") — esperado logo após um deploy que muda
  `PROTOCOL_VERSION`.
- **Não fazer**: abrir 2567 no firewall para “testar direto”.

## PostgreSQL fora

- **Detecção**: alerta `PostgreSQL não responde`; `/health/ready` 503; logs `[services] banco inacessível`.
- **Imediato**: `systemctl status postgresql@16-main`; `sudo tail -100 /var/log/postgresql/postgresql-16-main.log`;
  `df -h` (disco cheio derruba o Postgres); `free -h` (OOM? `journalctl -k | grep -i oom`).
- **Recuperação**: `sudo systemctl start postgresql`; o app reconecta (se não, `sudo systemctl restart tretario`).
  Disco cheio → seção Disco. Não sobe por corrupção → seção Banco corrompido.
- **Não fazer**: apagar arquivos em `/var/lib/postgresql` (nem `pg_wal`!), `pg_resetwal`, reinstalar o pacote.

## Disco > 90 %

- **Detecção**: alerta `disco / em N%`.
- **Imediato**: `sudo du -xh --max-depth=2 / | sort -h | tail -20`. Suspeitos: `journalctl --disk-usage`,
  `/opt/tretario/releases` (5 × ~600 MB), `shared/backups`, `/var/log/nginx`, caches `~/.npm`.
- **Recuperação**: `sudo journalctl --vacuum-size=500M`; apagar releases antigos que NÃO sejam o atual nem o
  anterior (`readlink /opt/tretario/current`); `npm cache clean --force` (admin); mover backups antigos para fora
  da VPS antes de apagá-los; aumentar o disco.
- **Não fazer**: apagar backups sem cópia externa; apagar `pg_wal`; apagar o release atual/anterior.

## RAM > 90 %

- **Detecção**: alerta `RAM em N%`; `journalctl -k | grep -i oom`.
- **Imediato**: `systemctl status tretario` (linha Memory; teto `MemoryMax=3G`), `ps aux --sort=-rss | head`.
  App perto do teto com poucos jogadores = vazamento → anotar `/internal/health` (heap/RSS) e reiniciar fora do pico.
- **Recuperação**: `sudo systemctl restart tretario`; se for build de deploy concorrendo, esperar terminar (o deploy
  roda com `nice`/`ionice`, mas `npm ci`/testes usam RAM).
- **Não fazer**: subir `MemoryMax` além de ~4 GB (o Postgres precisa do resto); desligar o swap.

## CPU 100 %

- **Detecção**: alerta de load; tick alto; `htop`.
- **Imediato**: quem consome? `top -o %CPU`. É o `node` do app (carga de jogadores), um deploy em andamento
  (`npm`/`vitest`), ou outro processo?
- **Recuperação**: carga real → reduzir `MAX_PLAYERS_PER_ROOM`/`MAX_SPECTATORS_PER_ROOM` no `server.env` e reiniciar
  fora do pico; deploy → esperar/adiar deploys para horários vazios.
- **Não fazer**: matar o PostgreSQL; `kill -9` no app (perde o desligamento gracioso e o flush de progresso).

## Tick alto (servidor do jogo atrasando)

- **Detecção**: alerta `tick alto` / `event loop lag`; jogadores relatam “teleportes”.
- **Imediato**: `/internal/health` (jogadores, salas, tick, lag); `journalctl -u tretario | grep -i warn`;
  CPU da máquina (seção CPU).
- **Recuperação**: limitar entrada (reduzir `MAX_PLAYERS_PER_ROOM`), reiniciar em horário vazio, registrar números
  para o benchmark da VPS ([PRODUCTION.md](PRODUCTION.md#capacidade-preencher-com-o-benchmark-na-vps-real)).
- **Não fazer**: reinícios repetidos durante um evento ao vivo sem ver a causa.

## Migration falhou

- **Detecção**: o deploy para com “MIGRATION FALHOU”; `releases.log` `result=migration_failed`; o código NÃO foi
  trocado (o release anterior continua no ar).
- **Imediato**: ler o erro; `cd /opt/tretario/releases/<novo>/server && sudo -u tretario bash -c 'set -a; . /opt/tretario/shared/env/server.env; npx prisma migrate status'`.
  Ver o backup `predeploy` citado na mensagem.
- **Recuperação**: migrations do Postgres rodam em transação — na maioria dos casos nada ficou pela metade e a linha
  em `_prisma_migrations` fica com `finished_at` nulo. Corrigir a migration num **commit novo** e, depois de
  entender o estado, marcar com `npx prisma migrate resolve --rolled-back <nome>` e fazer deploy de novo. Se dados
  foram afetados: restauração com confirmação ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).
- **Não fazer**: `migrate reset`; editar uma migration já aplicada; `resolve --applied` sem conferir o schema; deploy
  com `--allow-destructive` para “passar”.

## Deploy falhou

- **Detecção**: mensagem do script; `releases.log` (`build_failed`, `backup_failed`, `migration_blocked`,
  `migration_failed`, `rolled_back`, `smoke_failed`).
- **Imediato/recuperação** por resultado:
  - `build_failed`: nada mudou em produção. Corrigir e novo commit. Teste com tempo estourado sob carga (o build roda na
    VPS com o jogo no ar) → repetir o deploy em horário vazio.
  - `migration_blocked`: guarda de migration destrutiva — seguir EXPAND → MIGRATE → CONTRACT ([DEPLOYMENT.md](DEPLOYMENT.md)).
  - `rolled_back`: o novo release não ficou pronto em 90 s e o app voltou sozinho para o anterior. O banco NÃO voltou
    (migrations aplicadas ficam). `journalctl -u tretario -n 300` para a causa.
  - `smoke_failed`: o release novo está no ar; decidir rollback (`scripts/rollback-production.sh`) ou correção.
- **Não fazer**: apagar `shared/deploy.lock` com outro deploy rodando; mexer no symlink `current` à mão.

## Certificado falhou (renovação/expiração)

- **Detecção**: smoke `certificado vence em N dias`; navegador com erro de certificado.
- **Imediato**: `sudo certbot certificates`; `sudo certbot renew --dry-run`; `systemctl status certbot.timer`;
  porta 80 aberta? DNS ainda aponta para a VPS? `/.well-known/acme-challenge/` servido de `/var/www/letsencrypt`.
- **Recuperação**: `sudo certbot renew` (o hook recarrega o Nginx). Domínio novo → `sudo scripts/provision-vps.sh --domain ... --email ...`.
- **Não fazer**: tirar o HSTS ou servir o jogo em HTTP “temporariamente” (o HSTS já gravado nos navegadores
  impede de qualquer forma); usar certificado autoassinado em produção.

## Banco corrompido

- **Detecção**: erros de leitura no log do Postgres (`invalid page`, `could not read block`), restore-test do
  último dump OK mas o vivo falhando, contagens absurdas.
- **Imediato**: `scripts/maintenance.sh on`; `sudo systemctl stop tretario`; **não** reiniciar o Postgres em loop;
  copiar o diretório de dados para outro disco se houver espaço (`sudo systemctl stop postgresql` antes da cópia).
- **Recuperação**: restauração REAL com confirmações ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)) num banco novo +
  troca de nome; o corrompido fica guardado como `tretario_old_<ts>`.
- **Não fazer**: `pg_resetwal`, `DROP`, restaurar por cima do banco atual, apagar o corrompido antes de terminar.

## Backup falhou

- **Detecção**: `systemctl status tretario-backup.service` falho; alerta `último backup há N h`;
  `backup.jsonl` com `status: failed|warn|remote_failed`.
- **Imediato**: `journalctl -u tretario-backup -n 50`; disco cheio? Postgres fora? senha do env mudou?
- **Recuperação**: corrigir a causa e `sudo systemctl start tretario-backup.service`; conferir com
  `sudo scripts/restore-test.sh <novo dump>`. `warn` de tamanho caindo pela metade: conferir se houve limpeza
  legítima (sessões/códigos) ou perda de dados.
- **Não fazer**: deploy com migration enquanto não houver backup bom (o deploy aborta sozinho se o backup falhar).

## Conta de administrador comprometida

(admin = usuário SSH com sudo, ou vazamento de `PV_ADMIN_TOKEN`/`PV_SESSION_SECRET`.)

- **Detecção**: logins SSH estranhos (`last`, `journalctl -u ssh`), `sudo` inesperado (`journalctl _COMM=sudo`),
  arquivos mudados em `/etc` ou `/opt/tretario`, token usado de onde não devia.
- **Imediato**: pelo console do provedor (fora do SSH): trocar a senha/remover chaves suspeitas de
  `~/.ssh/authorized_keys`; `scripts/maintenance.sh on`; `sudo ss -tnp` (sessões abertas) e `pkill -KILL -u <usuário>`
  para sessões do invasor; guardar `journalctl` e `/var/log/auth.log` em outro lugar.
- **Recuperação**: girar segredos no `server.env` (editar valores existentes com cópia de segurança, nunca recriar o
  arquivo do zero): `PV_ADMIN_TOKEN` e `PV_SESSION_SECRET` (`openssl rand -hex 32`; trocar o segredo de sessão
  desloga todos), senha do banco (`ALTER ROLE tretario PASSWORD ...` + `DATABASE_URL`); reiniciar o app; revogar a
  deploy key do Git e criar outra; `sudo scripts/provision-vps.sh --harden-ssh`. Suspeita de root comprometido →
  VPS nova a partir do backup (provision + restauração com confirmação), não “limpar” a antiga.
- **Não fazer**: apagar logs; continuar usando a mesma chave/token; restaurar backup sem antes confirmar que ele é
  de antes da invasão.
