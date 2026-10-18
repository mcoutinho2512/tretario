# Backup e restauração (produção)

Scripts: `scripts/backup-db.sh`, `scripts/restore-test.sh`. Timer: `tretario-backup.timer`. Layout e env:
[`deploy/CONTRACT.md`](../deploy/CONTRACT.md).

## Agenda e retenção

| Tipo | Quando | Onde | Mantém |
|---|---|---|---|
| `daily` | `tretario-backup.timer`, 04:30 (+ até 10 min aleatórios; `Persistent=true` roda na volta se a VPS estava desligada) | `shared/backups/daily/` | 7 |
| `weekly` | o `daily` de domingo é ligado (hard link) em | `shared/backups/weekly/` | 4 |
| `predeploy` | `deploy-production.sh`, sempre, ANTES de `migrate status`/`migrate deploy` | `shared/backups/predeploy/` | 5 |
| `manual` | `scripts/backup-db.sh --kind manual [--label motivo]` | `shared/backups/manual/` | 10 |

Cada execução: `pg_dump -Fc -Z6` → arquivo `.partial` → `pg_restore --list` (legível?) → tamanho > 1 KB e aviso se
caiu mais da metade em relação ao anterior do mesmo tipo → `mv` atômico → `<arquivo>.sha256` → retenção → uma
linha JSON em `shared/logs/backup.jsonl` (`ts, kind, file, bytes, sha256, duration_ms, status ok|warn|failed|remote_failed,
remote, note`; nunca a URL do banco). Trava (`flock`) impede dois backups ao mesmo tempo (timer × deploy).

```bash
sudo systemctl start tretario-backup.service      # backup diário agora (mesmo caminho do timer)
scripts/backup-db.sh --kind manual --label antes-de-x   # o administrador roda; o script entra como tretario
sudo tail -n 3 /opt/tretario/shared/logs/backup.jsonl
systemctl list-timers tretario-backup.timer
```

### Cópia fora da VPS — LIMITAÇÃO ATUAL

Ainda **não existe armazenamento externo**: os backups ficam no mesmo disco da VPS. Perder o disco/a VPS = perder
banco **e** backups. Até haver destino externo:

- copie periodicamente à mão: `scp admin@vps:/opt/tretario/shared/backups/weekly/*.dump .` (precisa de `sudo` para ler;
  ex.: `ssh admin@vps 'sudo tar -C /opt/tretario/shared/backups -cf - weekly' > weekly.tar`);
- guarde também uma cópia do `server.env` (segredos) num cofre fora da VPS — sem ele as sessões existentes caem e o
  token de admin muda, mas os dados não se perdem.

Quando existir destino: `BACKUP_REMOTE=user@host:/caminho/` (rsync por SSH, chave do usuário `tretario` em
`shared/home/.ssh`) ou `BACKUP_REMOTE=rclone:<remoto>:<pasta>` (rclone instalado e configurado em
`shared/home/.config/rclone`) no `server.env`. Falha na cópia externa → `status: remote_failed`, saída 3 (unit
falha e o health-check acusa backup ruim pelo `systemctl --failed`). **Desligado por padrão.**

## Teste de restauração (fazer toda semana e depois de cada mudança de schema)

```bash
sudo ls -lt /opt/tretario/shared/backups/daily | head -3
sudo scripts/restore-test.sh /opt/tretario/shared/backups/daily/tretario-AAAAMMDDTHHMMSS.dump
# opcional: --expect User=123 --expect Report=4 (valores conhecidos) · --strict (dump recém-tirado, sem tráfego)
```

O que faz: confere o `.sha256`; cria `tretario_restore_test_<AAAAMMDDHHMMSS>` (banco NOVO, nunca o de produção);
`pg_restore --no-owner --no-acl --exit-on-error`; exige `_prisma_migrations` com migrations aplicadas e nenhuma
incompleta; compara contagens de `User, Profile, CharacterAppearance, PlayerProgress, CompletedMission,
AchievementUnlock, RewardGrant, MuteRelationship, Report, ModerationAction, EventMembership, Event, EventGroup,
AccountAccess, Payment, AuditLog, Session, VerificationCode` com o banco ao vivo (consulta somente leitura); falha se
uma tabela some, se `User` vem vazio com contas ao vivo, se um `--expect` não bate ou (com `--strict`) se uma tabela
não volátil difere. No fim apaga **só** o banco temporário — o nome é conferido por regex
(`^tretario_restore_test_[0-9]{14}$` e diferente do banco de produção) antes do `dropdb`, inclusive em erro (trap).
Resultado em `shared/logs/restore-test.jsonl`.

Diferenças normais no modo padrão: o ao vivo cresce depois do dump; `Session`/`VerificationCode` encolhem com a
limpeza (`CleanupService`) e `AuditLog` cresce.

## Restauração REAL (perda/corrupção do banco) — passo a passo com confirmações

Princípio: **nunca restaurar por cima**. Restaura-se num banco novo, confere-se, e só então troca-se o NOME; o banco
antigo fica guardado até decisão explícita. Nenhum passo usa `DROP`.

1. **Decidir o dump.** `sudo ls -lt /opt/tretario/shared/backups/*/` — o mais recente ANTES do problema (anote o
   horário: tudo depois dele se perde).
2. **Testar o dump:** `sudo scripts/restore-test.sh <dump>` → precisa terminar `restore-test OK`.
3. **Parar a entrada de jogadores, não o banco:**
   ```bash
   scripts/maintenance.sh on "restauração do banco"
   sudo systemctl stop tretario          # PostgreSQL continua no ar
   ```
4. **Guardar o estado atual** (mesmo corrompido, pode ser preciso depois):
   `scripts/backup-db.sh --kind manual --label antes-da-restauracao` (se o pg_dump falhar por corrupção, siga: o
   banco antigo não será apagado no passo 7).
5. **Restaurar num banco novo** (confirme o nome do arquivo duas vezes):
   ```bash
   TS=$(date +%Y%m%d%H%M%S); NOVO=tretario_restored_$TS
   sudo -u postgres createdb -O tretario "$NOVO"
   sudo cat <dump> | sudo -u postgres pg_restore --no-owner --role=tretario --exit-on-error -d "$NOVO"
   sudo -u postgres psql -d "$NOVO" -c 'SELECT count(*) FROM "User"' -c 'SELECT migration_name FROM _prisma_migrations ORDER BY 1 DESC LIMIT 3'
   ```
6. **Conferir** as contagens com o que se espera (usuários, relatórios, progresso). Não continue com dúvida.
7. **Trocar os nomes** (o app está parado; ninguém conectado). Digite os nomes à mão, sem copiar e colar às cegas:
   ```bash
   sudo -u postgres psql -c "SELECT datname, numbackends FROM pg_stat_database WHERE datname LIKE 'tretario%'"
   sudo -u postgres psql -c "ALTER DATABASE tretario RENAME TO tretario_old_$TS"
   sudo -u postgres psql -c "ALTER DATABASE $NOVO RENAME TO tretario"
   ```
   (`numbackends` precisa ser 0 no `tretario`; se não for, descubra quem está conectado antes.)
8. **Subir e conferir:**
   ```bash
   sudo systemctl start tretario
   curl -s http://127.0.0.1:2568/health/ready
   scripts/smoke-production.sh https://<domínio>
   scripts/maintenance.sh off
   ```
9. **Banco antigo** `tretario_old_<TS>`: fica guardado (ocupa disco). Apagar é uma decisão separada, dias depois, com
   um backup novo e testado em mãos, conferindo o nome exato: `sudo -u postgres dropdb tretario_old_<TS>`. Nunca
   `tretario`.

Restaurar exige versão de `pg_restore` ≥ a do `pg_dump` (ambos 16 na VPS).
