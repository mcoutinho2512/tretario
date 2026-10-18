#!/usr/bin/env bash
# Rollback do APP (docs/DEPLOYMENT.md). NUNCA reverte o banco. Roda como o administrador:
#
#   scripts/rollback-production.sh [commit] [--force-app-only] [--ready-timeout 90] [--no-smoke] [--url https://dominio]
#
# Sem commit: o release anterior ao atual (ordem do releases.log / data do build). Se o banco tiver migrations que o
# release-alvo não conhece, o código antigo precisa ser compatível com o schema novo (EXPAND → MIGRATE → CONTRACT):
# o script ABORTA, a menos que --force-app-only confirme que você conferiu isso.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/migrations-lib.sh
. "$SCRIPT_DIR/migrations-lib.sh"

TARGET="" FORCE=0 READY_TIMEOUT=90 SMOKE=1 URL=""
while (($#)); do
  case "$1" in
    --force-app-only) FORCE=1; shift ;;
    --ready-timeout) READY_TIMEOUT="${2:?}"; shift 2 ;;
    --no-smoke) SMOKE=0; shift ;;
    --url) URL="${2:?}"; shift 2 ;;
    --url=*) URL="${1#*=}"; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) die "opção desconhecida: $1" ;;
    *) TARGET="$1"; shift ;;
  esac
done
[[ $EUID -ne 0 ]] || die "rode como o usuário administrador, não como root"
T_START=$(date +%s)
exec 9<"$SHARED/deploy.lock"
flock -n 9 || die "outro deploy/rollback em andamento"

CUR="$(current_release)"
[[ -n $CUR ]] || die "não há release atual ($CURRENT)"
mapfile -t ALL < <(as_root find "$RELEASES" -mindepth 2 -maxdepth 2 -name .release-ok -printf '%T@ %h\n' | sort -rn | cut -d' ' -f2- | xargs -rn1 basename)
if [[ -z $TARGET ]]; then
  # anterior = o release do último deploy bem-sucedido diferente do atual; senão o build mais recente diferente
  TARGET="$(as_root grep -E ' result=ok ' "$SHARED/releases.log" 2>/dev/null | sed -E 's/.* commit=([0-9a-f]+) .*/\1/' | tac |
    while read -r c; do [[ $c != "$CUR" ]] && as_root test -f "$RELEASES/$c/.release-ok" && { echo "$c"; break; }; done || true)"
  if [[ -z $TARGET ]]; then for r in "${ALL[@]}"; do [[ $r != "$CUR" ]] && { TARGET="$r"; break; }; done; fi
  [[ -n $TARGET ]] || die "nenhum release anterior disponível"
else
  [[ $TARGET =~ ^[0-9a-f]{7,40}$ ]] || die "commit inválido: $TARGET"
  match=(); for r in "${ALL[@]}"; do [[ $r == "${TARGET:0:12}"* ]] && match+=("$r"); done
  ((${#match[@]} == 1)) || die "release '$TARGET' não encontrado (ou ambíguo) em $RELEASES. Disponíveis: ${ALL[*]}"
  TARGET="${match[0]}"
fi
[[ $TARGET != "$CUR" ]] || die "$TARGET já é o atual"
REL="$RELEASES/$TARGET"

cat >&2 <<EOF
${C_YEL}ROLLBACK É SÓ DO APP: $CUR → $TARGET. O banco NÃO volta.${C_OFF}
Política EXPAND → MIGRATE → CONTRACT: o código antigo continua funcionando com o schema novo enquanto as migrations
forem só aditivas (colunas/tabelas novas opcionais). Se uma migration REMOVEU/RENOMEOU algo que o código antigo usa,
o rollback do app NÃO resolve — veja docs/INCIDENT_RESPONSE.md.
EOF

MIG_ALLOW_DB_AHEAD=1 mig_state "$REL" || exit 1
# o banco precisa ter TODAS as migrations do alvo (prefixo); as extras são as que o código antigo não conhece
if ((${#MIG_PENDING[@]})); then
  die "o banco NÃO tem migrations que o alvo $TARGET espera (${MIG_PENDING[*]}): estado inesperado, rollback recusado"
fi
if ((${#MIG_DB_ONLY[@]})); then
  warn "o banco tem migrations mais novas que $TARGET: ${MIG_DB_ONLY[*]}"
  if ((!FORCE)); then
    loud "Rollback ABORTADO: o código de $TARGET vai rodar num schema mais novo." \
      "Confira que essas migrations são só aditivas (EXPAND) e repita com --force-app-only."
    exit 1
  fi
  warn "--force-app-only: seguindo com o schema mais novo"
fi

as_root ln -sfn "releases/$TARGET" "$TRETARIO_ROOT/current.new"
as_root mv -Tf "$TRETARIO_ROOT/current.new" "$CURRENT"
T_STOP=$(ms_now)
as_root systemctl restart tretario
RESULT=ok
if wait_ready "$TRETARIO_API/health/ready" "$READY_TIMEOUT"; then
  DOWNTIME=$(( $(ms_now) - T_STOP )); ok "pronto em $DOWNTIME ms"
else
  DOWNTIME=$(( $(ms_now) - T_STOP )); RESULT=not_ready
  as_root journalctl -u tretario -n 40 --no-pager >&2 || true
  loud "$TARGET NÃO ficou pronto em $READY_TIMEOUT s (current já aponta para ele)." \
    "Voltar: scripts/rollback-production.sh $CUR --force-app-only   · logs: journalctl -u tretario -n 200"
fi
if [[ $RESULT == ok ]] && ((SMOKE)); then
  URL="${URL:-$(env_get PV_PUBLIC_ORIGIN)}"
  if [[ -n $URL && $URL != *__DOMAIN__* ]]; then "$REL/scripts/smoke-production.sh" "$URL" || RESULT=smoke_failed
  else warn "smoke pulado: sem domínio"; fi
fi
printf '%s action=rollback commit=%s prev=%s result=%s duration_s=%s downtime_ms=%s db_ahead=%s\n' "$(date -Is)" "$TARGET" "$CUR" \
  "$RESULT" "$(( $(date +%s) - T_START ))" "$DOWNTIME" "$(IFS=,; echo "${MIG_DB_ONLY[*]:-none}")" | as_root tee -a "$SHARED/releases.log" >/dev/null
[[ $RESULT == ok ]] || die "rollback terminou com $RESULT"
ok "rollback para $TARGET concluído · indisponibilidade ${DOWNTIME} ms"
