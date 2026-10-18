#!/usr/bin/env bash
# Modo manutenção (deploy/CONTRACT.md): arquivo-flag shared/maintenance.on → o Nginx responde 503 com a página
# /var/www/tretario-maintenance/index.html em tudo, exceto /health/live. Não para o jogo nem o banco.
#
#   scripts/maintenance.sh on [motivo] | off | status
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

case "${1:-status}" in
  on)
    printf '%s %s %s\n' "$(date -Is)" "$(id -un)" "${2:-}" | as_root tee "$MAINT_FLAG" >/dev/null
    as_root chmod 644 "$MAINT_FLAG"
    ok "manutenção LIGADA ($MAINT_FLAG): visitantes recebem 503; jogadores conectados por WebSocket continuam até reconectar"
    ;;
  off)
    as_root rm -f "$MAINT_FLAG"
    ok "manutenção desligada"
    ;;
  status)
    if [[ -e $MAINT_FLAG ]]; then echo "LIGADA desde: $(cat "$MAINT_FLAG")"; else echo "desligada"; fi
    ;;
  *) die "uso: $0 on [motivo] | off | status" ;;
esac
