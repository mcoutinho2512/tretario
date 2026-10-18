#!/usr/bin/env bash
# Deploy de produção (docs/DEPLOYMENT.md). Roda NA VPS como o usuário administrador (com sudo), nunca como root:
#
#   scripts/deploy-production.sh [commit|branch] [--allow-destructive=<migration>]... [--url https://dominio]
#                                [--ready-timeout 90] [--no-smoke]
#
# Ordem: trava (flock) → espelho git (fetch; só commit publicado no origin) → build em releases/<commit> (checkout
# limpo, npm ci, npm run verify, npm run build, npm run build:version) → BACKUP do banco → migrate status + guarda de
# migration destrutiva → prisma migrate deploy → troca atômica de `current` → restart (SIGTERM gracioso) →
# /health/ready (falhou: volta o APP para o release anterior; o banco nunca é revertido) → smoke → releases.log → poda.
#
# --allow-destructive=<nome_da_migration>  libera UMA migration pendente com DROP/TRUNCATE/DELETE/troca de tipo/RENAME.
#   Nunca é padrão. Só depois de seguir EXPAND → MIGRATE → CONTRACT (docs/DEPLOYMENT.md) e conferir o backup.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=scripts/migrations-lib.sh
. "$SCRIPT_DIR/migrations-lib.sh"

REF="" URL="" READY_TIMEOUT=90 SMOKE=1 KEEP="${KEEP_RELEASES:-5}" # releases guardados (atual e anterior nunca saem)
ALLOW=()
while (($#)); do
  case "$1" in
    --allow-destructive=*) ALLOW+=("${1#*=}"); shift ;;
    --url) URL="${2:?}"; shift 2 ;;
    --url=*) URL="${1#*=}"; shift ;;
    --ready-timeout) READY_TIMEOUT="${2:?}"; shift 2 ;;
    --no-smoke) SMOKE=0; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) die "opção desconhecida: $1" ;;
    *) [[ -z $REF ]] || die "só um commit/branch"; REF="$1"; shift ;;
  esac
done
[[ $EUID -ne 0 ]] || die "rode como o usuário administrador (sudo é chamado só onde precisa), não como root"
[[ -d $MIRROR ]] || die "espelho git $MIRROR ausente (scripts/provision-vps.sh)"
[[ $(stat -c %U "$MIRROR") == "$(id -un)" ]] || die "o espelho $MIRROR pertence a $(stat -c %U "$MIRROR"); rode como esse usuário"

T_START=$(date +%s)
exec 9<"$SHARED/deploy.lock"
flock -n 9 || die "outro deploy/rollback em andamento ($SHARED/deploy.lock)"

relog() { # uma linha por deploy em shared/releases.log
  printf '%s action=deploy commit=%s ref=%s prev=%s result=%s duration_s=%s downtime_ms=%s migrations=%s backup=%s\n' \
    "$(date -Is)" "${SHORT:-?}" "${REF:-?}" "${PREV:-none}" "$1" "$(( $(date +%s) - T_START ))" "${DOWNTIME:--}" \
    "${MIG_APPLIED:-n}" "${BACKUP_FILE:--}" | as_root tee -a "$SHARED/releases.log" >/dev/null
}

# ------------------------------------------------------------------ 1. commit publicado no origin
g() { git -C "$MIRROR" "$@"; }
log "git: atualizando o espelho"
g fetch --prune --quiet origin
REF="${REF:-$(g symbolic-ref --short HEAD)}"
SHA="$(g rev-parse --verify --quiet "$REF^{commit}")" || die "commit/branch '$REF' não existe no origin"
[[ -n $(g branch --contains "$SHA") ]] || die "$SHA não está em nenhum branch do origin (só deploy de commit publicado)"
SHORT="${SHA:0:12}"
REL="$RELEASES/$SHORT"
PREV="$(current_release)"
log "deploy de $REF → $SHORT (atual: ${PREV:-nenhum})"
[[ $PREV != "$SHORT" ]] || warn "$SHORT já é o release atual: refaz banco/restart com o mesmo código"

# ------------------------------------------------------------------ 2. build (só se o release ainda não existe)
if as_root test -f "$REL/.release-ok"; then
  ok "release $SHORT já construído e verificado: reaproveitado"
else
  BUILD="$RELEASES/.build-$SHORT"
  as_root rm -rf "$BUILD"
  as_root install -d -o "$(id -un)" -g "$(id -gn)" "$BUILD"
  T_BUILD=$(date +%s)
  git clone --quiet --shared --no-checkout "$MIRROR" "$BUILD"
  git -C "$BUILD" checkout --quiet --detach "$SHA"
  (
    # prioridade baixa de CPU/disco: o jogo continua no ar nesta mesma máquina durante o build e os testes
    renice -n 10 -p "$BASHPID" >/dev/null 2>&1 || true
    ionice -c 3 -p "$BASHPID" >/dev/null 2>&1 || true
    cd "$BUILD"
    export CI=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PUPPETEER_SKIP_DOWNLOAD=1 npm_config_audit=false npm_config_fund=false
    # o build não fala com o banco; prisma.config.ts só exige que a variável exista
    export DATABASE_URL="postgresql://build:build@127.0.0.1:1/build"
    unset NODE_ENV
    log "npm ci (raiz + server)"
    npm ci --no-audit --no-fund --loglevel=error
    npm --prefix server ci --no-audit --no-fund --loglevel=error
    log "npm run verify (typecheck + testes + build + servidor)"
    npm run --silent verify || { echo "verify FALHOU" >&2; exit 1; }
    log "npm run build"
    npm run --silent build
    [[ -z $(git status --porcelain) ]] || { git status --short >&2; echo "o build alterou arquivos versionados" >&2; exit 1; }
    if node -e 'process.exit(require("./package.json").scripts?.["build:version"] ? 0 : 1)'; then
      PV_BUILD_COMMIT="$SHA" PV_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" npm run --silent build:version
    fi
    if [[ ! -f version.json ]]; then
      echo "[aviso] npm run build:version não gerou version.json: gerado pelo deploy" >&2
      printf '{"commit":"%s","buildTime":"%s"}\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >version.json
    fi
    # sem `npm prune --omit=dev`: o servidor roda com tsx e a CLI usa prisma (devDependencies; acordado com o app)
    rm -rf .git
    printf '{"commit":"%s","ref":"%s","builtAt":"%s","buildSeconds":%s,"node":"%s"}\n' "$SHA" "$REF" "$(date -Is)" \
      "$(( $(date +%s) - T_BUILD ))" "$(node -v)" >.release-ok
  ) || { relog build_failed; as_root rm -rf "$BUILD"; die "build/verify falhou: NADA foi alterado em produção"; }
  as_root chown -R root:root "$BUILD"
  as_root chmod -R go-w "$BUILD"
  as_root mv -T "$BUILD" "$REL"
  ok "release $SHORT pronto em $(( $(date +%s) - T_BUILD )) s"
fi
for u in tretario.service tretario-backup.service tretario-health.service tretario-backup.timer tretario-health.timer; do
  cmp -s "$REL/deploy/systemd/$u" "/etc/systemd/system/$u" || warn "$u difere do instalado: rode scripts/provision-vps.sh deste release"
done

# ------------------------------------------------------------------ 3. banco: backup → status → guarda → migrate
log "backup pré-deploy"
as_app "$REL/scripts/backup-db.sh" --kind predeploy --label "$SHORT" || { relog backup_failed; die "backup falhou: deploy abortado antes de tocar no banco"; }
BACKUP_FILE="$(as_root find "$SHARED/backups/predeploy" -name "tretario-*-$SHORT.dump" -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)"

mig_state "$REL" || { relog migration_blocked; exit 1; }
log "prisma migrate status:"
# shellcheck disable=SC2016
as_app bash -c 'cd "$1" && npx --no-install prisma migrate status' _ "$REL/server" || true
if ((${#MIG_PENDING[@]})); then
  log "pendentes: ${MIG_PENDING[*]}"
  mig_destructive_guard "$REL" "${ALLOW[@]}" || { relog migration_blocked; exit 1; }
  mig_diff_info "$REL"
  log "prisma migrate deploy"
  # shellcheck disable=SC2016
  if ! as_app bash -c 'cd "$1" && npx --no-install prisma migrate deploy' _ "$REL/server"; then
    MIG_APPLIED="FALHOU"
    relog migration_failed
    loud "MIGRATION FALHOU — o código NÃO foi trocado; o release anterior (${PREV:-nenhum}) continua no ar." \
      "Backup de antes: ${BACKUP_FILE:-?}" \
      "NÃO rode prisma migrate reset nem db push. Siga docs/INCIDENT_RESPONSE.md (Migration falhou)."
    exit 1
  fi
  MIG_APPLIED="y(${MIG_PENDING[*]})"
  MIG_APPLIED="${MIG_APPLIED// /,}"
else
  ok "nenhuma migration pendente"
  MIG_APPLIED=n
fi

# ------------------------------------------------------------------ 4. troca atômica + restart + ready
switch_to() { # switch_to <release>: symlink relativo novo + rename atômico
  as_root ln -sfn "releases/$1" "$TRETARIO_ROOT/current.new"
  as_root mv -Tf "$TRETARIO_ROOT/current.new" "$CURRENT"
}
switch_to "$SHORT"
log "current → $SHORT; reiniciando tretario (SIGTERM gracioso, até 20 s)"
T_STOP=$(ms_now)
as_root systemctl restart tretario
if wait_ready "$TRETARIO_API/health/ready" "$READY_TIMEOUT"; then
  DOWNTIME=$(( $(ms_now) - T_STOP ))
  ok "pronto: /health/ready ok em $DOWNTIME ms"
else
  DOWNTIME=$(( $(ms_now) - T_STOP ))
  as_root journalctl -u tretario -n 40 --no-pager >&2 || true
  if [[ -n $PREV && $PREV != "$SHORT" ]]; then
    switch_to "$PREV"
    as_root systemctl restart tretario
    if wait_ready "$TRETARIO_API/health/ready" "$READY_TIMEOUT"; then back="e respondeu /health/ready"; else back="mas TAMBÉM não ficou pronto"; fi
    relog rolled_back
    loud "DEPLOY FALHOU: $SHORT não ficou pronto em $READY_TIMEOUT s." \
      "ROLLBACK AUTOMÁTICO do APP para $PREV $back." \
      "O BANCO NÃO FOI REVERTIDO (migrations aplicadas: $MIG_APPLIED). Backup de antes: ${BACKUP_FILE:-?}" \
      "Logs: journalctl -u tretario -n 200"
  else
    relog failed
    loud "DEPLOY FALHOU: $SHORT não ficou pronto em $READY_TIMEOUT s e não há release anterior." "Logs: journalctl -u tretario -n 200"
  fi
  exit 1
fi

# ------------------------------------------------------------------ 5. smoke + registro + poda
RESULT=ok
if ((SMOKE)); then
  URL="${URL:-$(env_get PV_PUBLIC_ORIGIN)}"
  if [[ -z $URL || $URL == *__DOMAIN__* ]]; then
    warn "smoke pulado: sem domínio (PV_PUBLIC_ORIGIN); rode scripts/smoke-production.sh <url> depois"
  elif ! "$REL/scripts/smoke-production.sh" "$URL"; then
    RESULT=smoke_failed
    loud "SMOKE FALHOU em $URL com $SHORT no ar. Decida: corrigir ou scripts/rollback-production.sh" \
      "(rollback é só do app; o banco fica como está)"
  fi
fi
relog "$RESULT"

mapfile -t ALL < <(as_root find "$RELEASES" -mindepth 2 -maxdepth 2 -name .release-ok -printf '%T@ %h\n' | sort -rn | cut -d' ' -f2-)
n=0
for d in "${ALL[@]}"; do
  b="$(basename "$d")"
  [[ $b =~ ^[0-9a-f]{12}$ && $d == "$RELEASES/$b" ]] || continue
  n=$((n + 1))
  if ((n > KEEP)) && [[ $b != "$SHORT" && $b != "$PREV" ]]; then as_root rm -rf -- "$d"; log "poda: release $b removido"; fi
done
as_root find "$RELEASES" -mindepth 1 -maxdepth 1 -name '.build-*' -mtime +1 -exec rm -rf {} + || true

echo
summary="$SHORT em $(( $(date +%s) - T_START )) s · indisponibilidade medida (restart → ready): ${DOWNTIME} ms · migrations: $MIG_APPLIED"
if [[ $RESULT == ok ]]; then ok "deploy concluído: $summary"; else die "deploy no ar mas com $RESULT: $summary"; fi
