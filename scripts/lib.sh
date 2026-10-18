# shellcheck shell=bash
# Funções comuns dos scripts de operação (deploy/CONTRACT.md). Uso: `. "$(dirname "$0")/lib.sh"`.
# Variáveis sobrescrevíveis só para teste local (nunca em produção): TRETARIO_ROOT, TRETARIO_USER, TRETARIO_API.

# shellcheck disable=SC2034 # usadas pelos scripts que carregam este arquivo
TRETARIO_ROOT="${TRETARIO_ROOT:-/opt/tretario}"
TRETARIO_USER="${TRETARIO_USER:-tretario}"
TRETARIO_API="${TRETARIO_API:-http://127.0.0.1:2568}"
ENV_FILE="${ENV_FILE:-$TRETARIO_ROOT/shared/env/server.env}"
SHARED="$TRETARIO_ROOT/shared"
RELEASES="$TRETARIO_ROOT/releases"
CURRENT="$TRETARIO_ROOT/current"
MIRROR="$TRETARIO_ROOT/repo.git"
LOG_DIR="$SHARED/logs"
MAINT_FLAG="$SHARED/maintenance.on"

if [[ -t 1 ]]; then C_RED=$'\e[1;31m'; C_YEL=$'\e[1;33m'; C_GRN=$'\e[1;32m'; C_OFF=$'\e[0m'; else C_RED=''; C_YEL=''; C_GRN=''; C_OFF=''; fi

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
ok() { printf '%s[ok]%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '%s[aviso]%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
die() { printf '%s[ERRO]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }
# mensagem em destaque (falhas que exigem ação humana)
loud() {
  printf '%s\n' "$C_RED################################################################################" >&2
  local line; for line in "$@"; do printf '## %s\n' "$line" >&2; done
  printf '%s\n' "################################################################################$C_OFF" >&2
}

# sudo só quando não somos root
SUDO=()
if [[ $EUID -ne 0 ]]; then SUDO=(sudo); fi
as_root() { "${SUDO[@]}" "$@"; }

# roda um comando como outro usuário (root: runuser; admin: sudo -u; já é ele: direto)
as_user() {
  local u="$1"; shift
  if [[ $(id -un) == "$u" ]]; then "$@"
  elif [[ $EUID -eq 0 ]]; then runuser -u "$u" -- "$@"
  else sudo -u "$u" -- "$@"; fi
}

# roda um comando como o usuário do app com o env de produção carregado (o arquivo é 600 do usuário do app)
as_app() {
  # shellcheck disable=SC2016 # expande dentro do bash -c
  as_user "$TRETARIO_USER" env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$SHARED/home" LANG=C.UTF-8 \
    CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 ENV_FILE="$ENV_FILE" \
    bash -c 'set -a; . "$ENV_FILE"; set +a; exec "$@"' _ "$@"
}

# lê uma variável do env de produção sem carregar o resto no shell atual
# shellcheck disable=SC2016 # programa awk
env_get() { as_root awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "$ENV_FILE"; }

# URL do Postgres sem parâmetros de consulta (pg_dump/psql não aceitam ?schema=)
pg_url() { local u="${1:-$DATABASE_URL}"; printf '%s' "${u%%\?*}"; }

ms_now() { date +%s%3N; }

# espera GET <url> responder 200 (corpo com "ok":true) até <timeout_s>; devolve 0/1
wait_ready() {
  local url="$1" timeout="${2:-60}" deadline
  deadline=$(( $(date +%s) + timeout ))
  while (( $(date +%s) < deadline )); do
    if curl -fsS -m 2 "$url" 2>/dev/null | grep -q '"ok":[[:space:]]*true'; then return 0; fi
    sleep 0.25
  done
  return 1
}

current_release() { if [[ -L $CURRENT ]]; then basename "$(readlink -f "$CURRENT")"; fi; }
