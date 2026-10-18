#!/usr/bin/env bash
# Backup do PostgreSQL de produção (docs/BACKUP_RESTORE.md): pg_dump -Fc → shared/backups/<tipo>/, SHA-256, conferência
# do arquivo (pg_restore --list + tamanho), retenção e uma linha JSON por execução em shared/logs/backup.jsonl.
#
#   scripts/backup-db.sh [--kind daily|predeploy|manual] [--label <texto>]
#
#   daily      (timer tretario-backup, 04:30) mantém 7; aos domingos copia para weekly/ (mantém 4)
#   predeploy  (deploy-production.sh, antes de qualquer migration) mantém 5
#   manual     mantém 10
# Cópia fora da VPS (DESLIGADA por padrão): BACKUP_REMOTE=<destino rsync "user@host:/dir/"> ou "rclone:<remoto>:<dir>"
# no server.env. Sem ela, os backups morrem junto com o disco da VPS (limitação documentada).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

KIND=manual LABEL=""
while (($#)); do
  case "$1" in
    --kind) KIND="${2:?}"; shift 2 ;;
    --kind=*) KIND="${1#*=}"; shift ;;
    --label) LABEL="${2:?}"; shift 2 ;;
    --label=*) LABEL="${1#*=}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1" ;;
  esac
done
case "$KIND" in daily) KEEP=7 ;; predeploy) KEEP=5 ;; manual) KEEP=10 ;; *) die "--kind inválido: $KIND" ;; esac
[[ $LABEL =~ ^[A-Za-z0-9._-]*$ ]] || die "--label só com [A-Za-z0-9._-]"

# o env (DATABASE_URL) é 600 do usuário do app: quem não é ele roda através dele
if [[ $(id -un) != "$TRETARIO_USER" && -z ${DATABASE_URL:-} ]]; then
  as_app "$SCRIPT_DIR/backup-db.sh" --kind "$KIND" ${LABEL:+--label "$LABEL"}
  exit $?
fi
if [[ -z ${DATABASE_URL:-} ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi
[[ -n ${DATABASE_URL:-} ]] || die "DATABASE_URL vazia"

DIR="$SHARED/backups/$KIND"
mkdir -p "$DIR" "$LOG_DIR"
exec 8>"$SHARED/backups/.lock"
flock -w 600 8 || die "outro backup em andamento há mais de 10 min"

TS="$(date +%Y%m%dT%H%M%S)"
NAME="tretario-$TS${LABEL:+-$LABEL}.dump"
OUT="$DIR/$NAME"
T0=$(ms_now)
STATUS=ok NOTE="" REMOTE=off SHA="" BYTES=0

jlog() { # uma linha JSON por execução (sem segredo: nada da URL do banco)
  printf '{"ts":"%s","kind":"%s","file":"%s","bytes":%s,"sha256":"%s","duration_ms":%s,"status":"%s","remote":"%s","note":"%s"}\n' \
    "$(date -Is)" "$KIND" "$OUT" "$BYTES" "$SHA" "$(( $(ms_now) - T0 ))" "$STATUS" "$REMOTE" "$NOTE" >>"$LOG_DIR/backup.jsonl"
}
fail() { STATUS=failed NOTE="$1"; jlog; rm -f "$OUT.partial"; die "backup falhou: $1"; }

umask 027
pg_dump --format=custom --compress=6 --no-password --dbname="$(pg_url "$DATABASE_URL")" --file="$OUT.partial" 2>"$OUT.err" ||
  fail "pg_dump: $(tr '\n"' ' ' <"$OUT.err" | cut -c1-200)"
rm -f "$OUT.err"
pg_restore --list "$OUT.partial" >/dev/null 2>&1 || fail "arquivo ilegível (pg_restore --list)"
BYTES=$(stat -c %s "$OUT.partial")
((BYTES > 1024)) || fail "arquivo pequeno demais ($BYTES bytes)"
# encolheu mais da metade em relação ao anterior do mesmo tipo → avisa (pode ser limpeza legítima ou perda de dados)
PREV="$(find "$DIR" -maxdepth 1 -name 'tretario-*.dump' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"
if [[ -n $PREV ]]; then
  PB=$(stat -c %s "$PREV")
  if ((BYTES * 2 < PB)); then STATUS=warn NOTE="tamanho caiu de $PB para $BYTES bytes"; warn "$NOTE"; fi
fi
mv "$OUT.partial" "$OUT"
SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"
printf '%s  %s\n' "$SHA" "$NAME" >"$OUT.sha256"

if [[ $KIND == daily && $(date +%u) == 7 ]]; then
  mkdir -p "$SHARED/backups/weekly"
  ln -f "$OUT" "$SHARED/backups/weekly/$NAME" 2>/dev/null || cp -p "$OUT" "$SHARED/backups/weekly/$NAME"
  cp -p "$OUT.sha256" "$SHARED/backups/weekly/$NAME.sha256"
  prune_weekly=1
fi

prune() { # prune <dir> <quantos manter>
  find "$1" -maxdepth 1 -name 'tretario-*.dump' -printf '%T@ %p\n' | sort -rn | tail -n +"$(($2 + 1))" | cut -d' ' -f2- |
    while read -r f; do rm -f -- "$f" "$f.sha256"; log "retenção: removido $(basename "$f")"; done
}
prune "$DIR" "$KEEP"
[[ ${prune_weekly:-0} == 1 ]] && prune "$SHARED/backups/weekly" 4

if [[ -n ${BACKUP_REMOTE:-} ]]; then
  REMOTE=failed
  if [[ $BACKUP_REMOTE == rclone:* ]]; then
    rclone copy "$DIR" "${BACKUP_REMOTE#rclone:}/$KIND" --include 'tretario-*' && REMOTE=ok
  else
    rsync -a --timeout=120 "$OUT" "$OUT.sha256" "$BACKUP_REMOTE" && REMOTE=ok
  fi
  [[ $REMOTE == ok ]] || { STATUS=remote_failed NOTE="cópia externa falhou"; }
fi

jlog
ok "backup $KIND: $OUT ($(numfmt --to=iec "$BYTES"), sha256 ${SHA:0:12}…, $(( $(ms_now) - T0 )) ms, status $STATUS)"
[[ $STATUS == remote_failed ]] && exit 3
exit 0
