# Operação diária (runbook)

Na VPS, como o usuário administrador (SSH por chave), a partir de `/opt/tretario/current` (os scripts do release
no ar): `cd /opt/tretario/current`. Contexto: [PRODUCTION.md](PRODUCTION.md). Incidentes:
[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

| Pergunta | Comando |
|---|---|
| **Está no ar?** | `scripts/server-status.sh` (tudo de uma vez) · de fora: `scripts/smoke-production.sh https://<domínio>` · rápido: `curl -s http://127.0.0.1:2568/health/ready` |
| **Reiniciar o jogo** | `sudo systemctl restart tretario` (SIGTERM gracioso, até 20 s; jogadores reconectam) — conferir `curl -s http://127.0.0.1:2568/health/ready` |
| **Logs** | `journalctl -u tretario -f` · últimos erros: `journalctl -u tretario -p err -n 100` · desde o último deploy: `journalctl -u tretario --since "$(sudo tail -1 /opt/tretario/shared/releases.log \| cut -d' ' -f1)"` · Nginx: `/var/log/nginx/{access,error}.log` · Postgres: `/var/log/postgresql/postgresql-16-main.log` |
| **CPU / RAM / disco** | `scripts/server-status.sh` · `htop` · `systemctl status tretario` (linha `Memory:`) · `df -h /` · `du -sh /opt/tretario/{releases,shared/backups}` |
| **Jogadores online** | `scripts/server-status.sh` (seção health: lê `/internal/health` com o `PV_ADMIN_TOKEN` do env) · ou `cat /opt/tretario/shared/monitor/status` (atualizado a cada minuto) |
| **Fazer backup agora** | `scripts/backup-db.sh --kind manual --label motivo` ([BACKUP_RESTORE.md](BACKUP_RESTORE.md)) |
| **Testar um backup** | `sudo scripts/restore-test.sh /opt/tretario/shared/backups/daily/<arquivo>.dump` |
| **Restaurar** | só pelo procedimento com confirmações de [BACKUP_RESTORE.md](BACKUP_RESTORE.md#restauração-real-perdacorrupção-do-banco--passo-a-passo-com-confirmações) |
| **Deploy** | `scripts/deploy-production.sh [commit\|branch]` ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| **Rollback** | `scripts/rollback-production.sh [commit]` (só o app; o banco nunca volta) |
| **Manutenção ligar/desligar** | `scripts/maintenance.sh on "motivo"` · `scripts/maintenance.sh off` · `scripts/maintenance.sh status` (vale na hora, sem reload do Nginx; `/health/live` continua respondendo; WebSockets abertos continuam até reconectar) |
| **Commit no ar** | `readlink /opt/tretario/current` · `cat /opt/tretario/current/version.json` · de fora: `curl -s https://<domínio>/api/status` |
| **Parar o jogo sem parar o Postgres** | `scripts/maintenance.sh on "parado"` e `sudo systemctl stop tretario` (o PostgreSQL é outro serviço e continua). Voltar: `sudo systemctl start tretario` e `scripts/maintenance.sh off`. `Restart=always` não religa um stop manual. |
| **SSH** | `ssh -p 22022 admin@143.95.164.238` (porta 22022; a 22 não é aberta no ufw) |
| **Desbanir IP no fail2ban** | `sudo fail2ban-client status sshd` (lista) · `sudo fail2ban-client set sshd unbanip <IP>` · nunca banir: `--admin-ip <IP>` no `provision-vps.sh` (vira `ignoreip`) |
| **Aprovar conta (beta, sem SMTP)** | `cd /opt/tretario/current && sudo -u tretario bash -c 'set -a; . /opt/tretario/shared/env/server.env; npm run prod:approve -- <email>'` (script do app, rodada 9.1) |
| **Releases guardados** | `ls -lt /opt/tretario/releases` · histórico: `sudo cat /opt/tretario/shared/releases.log` |
| **Alerta ativo?** | `cat /opt/tretario/shared/monitor/alert` (só existe enquanto algo está ruim) · histórico: `/opt/tretario/shared/logs/health.log` |
| **Certificado** | `sudo certbot certificates` · renovação: `systemctl list-timers certbot.timer` · teste: `sudo certbot renew --dry-run` |
| **Atualizações do SO** | segurança: automáticas (`unattended-upgrades`, sem reboot). Reboot pendente? `cat /var/run/reboot-required` → agendar em horário vazio, com `scripts/maintenance.sh on` antes |

## Regras

- Não editar arquivos dentro de `releases/<commit>` (imutáveis; donos `root`). Mudança = commit + deploy.
- `server.env`: editar com `sudo -u tretario` ou `sudo` + conferir `600 tretario:tretario`; depois
  `sudo systemctl restart tretario`. Nunca colar segredo em issue, chat ou commit.
- Mudou algo em `deploy/` (Nginx, systemd, Postgres)? Rodar `sudo scripts/provision-vps.sh --domain <domínio>` a
  partir do release novo (idempotente; o deploy avisa quando as units diferem das instaladas).
- Nunca abrir 5432 no ufw. Acesso ao banco: `ssh -L 5433:127.0.0.1:5432 admin@vps` e cliente local, ou
  `sudo -u postgres psql tretario` na VPS (cuidado: superusuário).
