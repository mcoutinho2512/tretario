#!/usr/bin/env bash
# Teste de restauração (docs/BACKUP_RESTORE.md): restaura um dump num banco TEMPORÁRIO tretario_restore_test_<ts>
# (NUNCA o de produção), confere _prisma_migrations e as contagens das tabelas principais contra o banco ao vivo
# (e/ou valores esperados), e apaga SÓ esse banco temporário (nome conferido por regex antes do DROP).
#
#   sudo scripts/restore-test.sh <arquivo.dump> [--expect User=12 --expect Report=0 ...] [--strict]
#
#   --strict  exige contagem IGUAL ao vivo nas tabelas não voláteis (use com um dump recém-tirado e sem tráfego)
# Saída 0 = restauração confiável; 1 = falhou (motivo impresso e em shared/logs/restore-test.jsonl).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

DUMP="" STRICT=0
declare -A EXPECT=()
while (($#)); do
  case "$1" in
    --expect) [[ ${2:-} =~ ^([A-Za-z]+)=([0-9]+)$ ]] || die "--expect Tabela=N"; EXPECT[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}; shift 2 ;;
    --strict) STRICT=1; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) die "opção desconhecida: $1" ;;
    *) DUMP="$1"; shift ;;
  esac
done
[[ -n $DUMP && -f $DUMP ]] || as_root test -f "$DUMP" || die "uso: $0 <arquivo.dump>"

TABLES=(User Profile CharacterAppearance PlayerProgress CompletedMission AchievementUnlock RewardGrant MuteRelationship
  Report ModerationAction EventMembership Event EventGroup AccountAccess Payment AuditLog Session VerificationCode)
VOLATILE=" Session VerificationCode AuditLog " # mudam sozinhas (login, limpeza, auditoria)

PROD_DB="$(env_get DATABASE_URL | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')"
[[ -n $PROD_DB ]] || die "não achei o banco de produção em $ENV_FILE"
TMPDB="tretario_restore_test_$(date +%Y%m%d%H%M%S)"

pg() { as_user postgres "$@"; }
q() { pg psql -X -q -v ON_ERROR_STOP=1 -tA -d "$1" -c "$2"; }
drop_tmp() { # guarda de nome: só apaga o temporário deste teste
  if [[ $TMPDB =~ ^tretario_restore_test_[0-9]{14}$ && $TMPDB != "$PROD_DB" ]]; then
    pg dropdb --if-exists "$TMPDB" && log "banco temporário $TMPDB apagado"
  else
    loud "RECUSEI apagar '$TMPDB' (nome fora do padrão do teste)"
  fi
}

T0=$(ms_now) RESULT=ok REASONS=()
bad() { RESULT=failed; REASONS+=("$1"); printf '%s[falha]%s %s\n' "$C_RED" "$C_OFF" "$1" >&2; }

if as_root test -f "$DUMP.sha256"; then
  # shellcheck disable=SC2016 # $1/$2 expandem no bash -c
  as_root bash -c 'cd "$1" && sha256sum -c --quiet "$2"' _ "$(dirname "$DUMP")" "$(basename "$DUMP").sha256" ||
    die "SHA-256 do dump não confere"
  ok "sha256 confere"
else
  warn "sem $DUMP.sha256: integridade só pelo pg_restore"
fi

trap drop_tmp EXIT
pg createdb "$TMPDB"
log "restaurando em $TMPDB (produção: $PROD_DB — não é tocada)"
# o dump é lido pelo root e entregue ao postgres via stdin (o diretório de backups é do usuário do app)
as_root cat "$DUMP" | pg pg_restore --no-owner --no-acl --exit-on-error -d "$TMPDB" ||
  { bad "pg_restore falhou"; }

if [[ $RESULT == ok ]]; then
  if [[ $(q "$TMPDB" "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") != t ]]; then
    bad "_prisma_migrations ausente"
  else
    applied=$(q "$TMPDB" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
    broken=$(q "$TMPDB" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")
    last=$(q "$TMPDB" "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")
    log "_prisma_migrations: $applied aplicadas (última $last), $broken incompletas"
    ((applied > 0)) || bad "nenhuma migration aplicada no dump"
    ((broken == 0)) || bad "$broken migration(s) incompleta(s) no dump"
  fi
  printf '\n%-22s %12s %12s %10s\n' TABELA RESTAURADO "AO VIVO" ESPERADO
  for t in "${TABLES[@]}"; do
    live=$(q "$PROD_DB" "SET default_transaction_read_only=on; SELECT CASE WHEN to_regclass('public.\"$t\"') IS NULL THEN -1 ELSE (SELECT count(*) FROM \"$t\") END" | tail -1)
    rest=$(q "$TMPDB" "SELECT CASE WHEN to_regclass('public.\"$t\"') IS NULL THEN -1 ELSE (SELECT count(*) FROM \"$t\") END")
    exp="${EXPECT[$t]:-}"
    printf '%-22s %12s %12s %10s\n' "$t" "$rest" "$live" "${exp:--}"
    if ((rest < 0 && live >= 0)); then bad "tabela $t ausente no dump"; continue; fi
    if [[ -n $exp && $rest != "$exp" ]]; then bad "$t: $rest linhas, esperado $exp"; fi
    if [[ $t == User ]] && ((rest == 0 && live > 0)); then bad "User vazio no dump com $live contas ao vivo"; fi
    if ((STRICT)) && [[ $VOLATILE != *" $t "* ]] && ((rest != live)); then bad "$t: $rest no dump × $live ao vivo (--strict)"; fi
  done
  echo
fi

mkdir -p "$LOG_DIR" 2>/dev/null || true
printf '{"ts":"%s","dump":"%s","tmpdb":"%s","result":"%s","duration_ms":%s,"reasons":"%s"}\n' "$(date -Is)" "$DUMP" "$TMPDB" \
  "$RESULT" "$(( $(ms_now) - T0 ))" "${REASONS[*]:-}" | as_root tee -a "$LOG_DIR/restore-test.jsonl" >/dev/null
if [[ $RESULT == ok ]]; then ok "restore-test OK ($(( $(ms_now) - T0 )) ms)"; else die "restore-test FALHOU: ${REASONS[*]}"; fi
