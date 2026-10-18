#!/usr/bin/env bash
# Checagem de saúde local (timer tretario-health, a cada minuto, como o usuário do app) — docs/MONITORING.md.
# Grava shared/monitor/status (uma linha chave=valor, sempre) e shared/monitor/alert (só enquanto algo estiver ruim;
# some sozinho quando normaliza). Mudanças de estado e alertas vão para shared/logs/health.log e para o journald.
# Limites (env): HC_DISK_PCT=85 HC_MEM_PCT=90 HC_LOAD_PER_CPU=2 HC_TICK_MS=40 HC_LAG_MS=100 HC_BACKUP_MAX_H=26
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

DISK_PCT="${HC_DISK_PCT:-85}" MEM_PCT="${HC_MEM_PCT:-90}" LOAD_PER_CPU="${HC_LOAD_PER_CPU:-2}"
TICK_MS="${HC_TICK_MS:-40}" LAG_MS="${HC_LAG_MS:-100}" BACKUP_MAX_H="${HC_BACKUP_MAX_H:-26}"
MON="$SHARED/monitor"
mkdir -p "$MON" "$LOG_DIR" 2>/dev/null || true
PROBLEMS=() KV=()
add() { KV+=("$1=$2"); }

svc_state="$(systemctl is-active tretario 2>/dev/null || true)"; add service "${svc_state:-unknown}"
[[ $svc_state == active ]] || PROBLEMS+=("serviço tretario: ${svc_state:-unknown}")

if body="$(curl -sS -m 3 "$TRETARIO_API/health/ready" 2>/dev/null)" && grep -q '"ok":[[:space:]]*true' <<<"$body"; then add ready ok
else add ready fail; PROBLEMS+=("/health/ready falhou: ${body:0:120}"); fi

if pg_isready -q -h 127.0.0.1 -p 5432 -t 3; then add postgres ok; else add postgres down; PROBLEMS+=("PostgreSQL não responde"); fi

# métricas internas (token do env; a rota não é pública). Campos lidos de forma tolerante.
if [[ -n ${PV_ADMIN_TOKEN:-} ]] && ih="$(curl -sS -m 3 -H "x-admin-token: $PV_ADMIN_TOKEN" "$TRETARIO_API/internal/health" 2>/dev/null)" &&
  jq -e . >/dev/null 2>&1 <<<"$ih"; then
  players="$(jq -r '.players // .online // empty | if type=="object" then (.count // .total // length) else . end' <<<"$ih")"
  specs="$(jq -r '.spectators // empty | if type=="object" then (.count // .total // length) else . end' <<<"$ih")"
  tick="$(jq -r '[.tick.avgMs?, .tick.p95Ms?, .tickMs?, .tick?] | map(select(type=="number")) | first // empty' <<<"$ih")"
  lag="$(jq -r '[.eventLoop.p99Ms?, .eventLoopLagMs?, .eventLoop.lagMs?, .lagMs?] | map(select(type=="number")) | first // empty' <<<"$ih")"
  add players "${players:-?}"; add spectators "${specs:-?}"; add tick_ms "${tick:-?}"; add lag_ms "${lag:-?}"
  if [[ -n $tick ]] && awk -v a="$tick" -v b="$TICK_MS" 'BEGIN{exit !(a>b)}'; then PROBLEMS+=("tick alto: ${tick} ms (> $TICK_MS)"); fi
  if [[ -n $lag ]] && awk -v a="$lag" -v b="$LAG_MS" 'BEGIN{exit !(a>b)}'; then PROBLEMS+=("event loop lag: ${lag} ms (> $LAG_MS)"); fi
else
  add internal unavailable
fi

for mnt in / "$TRETARIO_ROOT"; do
  pct="$(df -P "$mnt" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  lbl=root; [[ $mnt == / ]] || lbl="$(basename "$mnt")"
  add "disk_$lbl" "$pct%"
  ((pct > DISK_PCT)) && PROBLEMS+=("disco $mnt em $pct% (> $DISK_PCT%)")
done
read -r mem_total mem_avail < <(awk '/^MemTotal:/{t=$2} /^MemAvailable:/{a=$2} END{print t, a}' /proc/meminfo)
mem_used=$(( (mem_total - mem_avail) * 100 / mem_total ))
add mem "$mem_used%"
((mem_used > MEM_PCT)) && PROBLEMS+=("RAM em $mem_used% (> $MEM_PCT%)")
load1="$(cut -d' ' -f1 /proc/loadavg)" cpus="$(nproc)"
add load1 "$load1"; add cpus "$cpus"
awk -v l="$load1" -v c="$cpus" -v k="$LOAD_PER_CPU" 'BEGIN{exit !(l > c*k)}' && PROBLEMS+=("load alto: $load1 com $cpus CPUs")

last="$(find "$SHARED/backups/daily" "$SHARED/backups/predeploy" -maxdepth 1 -name 'tretario-*.dump' -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)"
if [[ -n $last ]]; then
  age_h=$(( ($(date +%s) - last) / 3600 )); add backup_age_h "$age_h"
  ((age_h > BACKUP_MAX_H)) && PROBLEMS+=("último backup há $age_h h (> $BACKUP_MAX_H)")
else
  add backup_age_h none; PROBLEMS+=("nenhum backup encontrado")
fi
add commit "$(current_release)"

state=ok; ((${#PROBLEMS[@]})) && state=ALERT
line="$(date -Is) state=$state ${KV[*]}"
printf '%s\n' "$line" >"$MON/status.tmp" && mv -f "$MON/status.tmp" "$MON/status"
prev_state="$(cat "$MON/.last_state" 2>/dev/null || echo ok)"
if [[ $state == ALERT ]]; then
  { echo "$line"; printf -- '- %s\n' "${PROBLEMS[@]}"; } >"$MON/alert.tmp" && mv -f "$MON/alert.tmp" "$MON/alert"
  printf '%s ALERT %s\n' "$(date -Is)" "$(IFS=';'; echo "${PROBLEMS[*]}")" >>"$LOG_DIR/health.log"
  echo "ALERTA: ${PROBLEMS[*]}" >&2
else
  rm -f "$MON/alert"
  [[ $prev_state == ok ]] || printf '%s RECOVERED %s\n' "$(date -Is)" "$line" >>"$LOG_DIR/health.log"
fi
echo "$state" >"$MON/.last_state"
echo "$line"
[[ $state == ok ]]
