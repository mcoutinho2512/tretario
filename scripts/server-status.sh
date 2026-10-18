#!/usr/bin/env bash
# Painel rápido do servidor (docs/OPERATIONS.md): CPU/RAM/disco/load, serviços, health, jogadores online
# (/internal/health com o token do env), último backup, commit no ar, manutenção, último alerta.
#
#   scripts/server-status.sh   (o administrador roda; sudo é usado para ler o token e os backups)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

sec() { printf '\n%s== %s ==%s\n' "$C_GRN" "$1" "$C_OFF"; }

sec "máquina"
echo "host $(hostname) · uptime $(uptime -p) · load $(cut -d' ' -f1-3 /proc/loadavg) · CPUs $(nproc)"
top -bn1 | awk '/^%Cpu/ {print "CPU: " $0; exit}'
free -h | awk 'NR<=2'
df -h / "$TRETARIO_ROOT" | awk 'NR==1 || !seen[$0]++'

sec "serviços"
for s in tretario postgresql nginx fail2ban tretario-backup.timer tretario-health.timer certbot.timer; do
  printf '%-24s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || true)"
done
systemctl show tretario -p MainPID -p ActiveEnterTimestamp -p NRestarts -p MemoryCurrent 2>/dev/null | sed 's/^/  /'

sec "health"
printf 'live:  %s\n' "$(curl -sS -m 3 "$TRETARIO_API/health/live" 2>&1 || true)"
printf 'ready: %s\n' "$(curl -sS -m 3 "$TRETARIO_API/health/ready" 2>&1 || true)"
printf 'api:   %s\n' "$(curl -sS -m 3 "$TRETARIO_API/api/status" 2>&1 || true)"
TOKEN="$(env_get PV_ADMIN_TOKEN 2>/dev/null || true)"
if [[ -n $TOKEN ]]; then
  ih="$(curl -sS -m 3 -H "x-admin-token: $TOKEN" "$TRETARIO_API/internal/health" 2>&1 || true)"
  if jq -e . >/dev/null 2>&1 <<<"$ih"; then
    # campos de server/src/http/health.ts (rodada 9.1)
    jq -r '"ok: \(.ok) · jogadores: \(.players // "?") · espectadores: \(.spectators // "?") · bots: \(.bots // "?") · salas: \(.rooms // "?") · websockets: \(.websockets // "?")",
           "versão: \(.version // .commit // "?") (build \(.buildTime // "?")) · protocolo \(.protocol // "?") · uptime \(.uptimeS // .uptime // "?") s · node \(.node // "?")",
           "tick: médio \(.tick.avgMs // "?") ms / máx \(.tick.maxMs // "?") ms · event loop p99 \(.eventLoop.p99Ms // "?") ms",
           "memória: RSS \(.memory.rssMB // "?") MB · heap \(.memory.heapUsedMB // "?") MB · banco: \(.db // "?" | tostring)",
           "degradado: \(.degraded // [] | join(", ")) · desligando: \(.shuttingDown // false)"' <<<"$ih"
  else
    echo "/internal/health: $ih"
  fi
fi
[[ -f $SHARED/monitor/status ]] && echo "último health-check: $(cat "$SHARED/monitor/status")"
if [[ -f $SHARED/monitor/alert ]]; then printf '%sALERTA ATIVO:%s\n' "$C_RED" "$C_OFF"; cat "$SHARED/monitor/alert"; fi

sec "release"
echo "current → $(current_release) $(as_root cat "$CURRENT/version.json" 2>/dev/null || true)"
echo "releases: $(as_root find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -printf '%f ' 2>/dev/null)"
as_root tail -n 3 "$SHARED/releases.log" 2>/dev/null || true
if [[ -e $MAINT_FLAG ]]; then printf '%sMANUTENÇÃO LIGADA:%s %s\n' "$C_YEL" "$C_OFF" "$(cat "$MAINT_FLAG")"; else echo "manutenção: desligada"; fi

sec "backups"
last="$(as_root find "$SHARED/backups" -name 'tretario-*.dump' -printf '%T@ %s %p\n' 2>/dev/null | sort -n | tail -1 || true)"
if [[ -n $last ]]; then
  read -r ts size path <<<"$last"
  echo "último: $path ($(numfmt --to=iec "$size"), há $(( ($(date +%s) - ${ts%.*}) / 3600 )) h)"
else
  echo "NENHUM backup encontrado"
fi
as_root tail -n 1 "$LOG_DIR/backup.jsonl" 2>/dev/null || true
echo "fail2ban sshd: $(as_root fail2ban-client status sshd 2>/dev/null | awk -F: '/Currently banned/ {gsub(/ /,"",$2); print $2 " banido(s)"}' || echo '?')"
