#!/usr/bin/env bash
# Smoke test de produção visto DE FORA (pelo Nginx), sem login e sem escrever nada:
#
#   scripts/smoke-production.sh https://dominio
#
# Confere: TLS válido (e dias até vencer), :80 → 301 https, home 200 + noindex, HSTS/CSP/nosniff, /health/live,
# /health/ready, /api/status (protocol), /internal/health e /metrics bloqueados, handshake WebSocket em /game/ e
# entrada real na sala como espectador (Colyseus SDK). Saída 0 = tudo ok.
# Só para teste local com certificado autoassinado: SMOKE_CACERT=<ca.pem> (o TLS continua sendo verificado).
# shellcheck disable=SC2015 # `teste && pass || fail`: pass sempre devolve 0
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

BASE="${1:-}"
[[ $BASE =~ ^https://[^/]+$ ]] || die "uso: $0 https://dominio (sem barra no fim)"
HOSTPORT="${BASE#https://}"
CURL=(curl -sS --max-time 10 --proto '=https,http')
[[ -n ${SMOKE_CACERT:-} ]] && CURL+=(--cacert "$SMOKE_CACERT")
FAILS=0 TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
pass() { printf '%s  ok%s  %s\n' "$C_GRN" "$C_OFF" "$*"; }
fail() { printf '%sFALHA%s %s\n' "$C_RED" "$C_OFF" "$*"; FAILS=$((FAILS + 1)); }
get() { # get <caminho> → código HTTP; corpo em $TMP/body, cabeçalhos em $TMP/hdr
  "${CURL[@]}" -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' "$BASE$1" 2>"$TMP/err" || { cat "$TMP/err" >&2; echo 000; }
}
hdr() { grep -i "^$1:" "$TMP/hdr" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //'; }

# TLS
if "${CURL[@]}" -o /dev/null "$BASE/" 2>"$TMP/err"; then
  connect="$HOSTPORT"; [[ $connect == *:* ]] || connect+=":443"
  end="$(echo | openssl s_client -connect "$connect" -servername "${HOSTPORT%%:*}" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [[ -z $end ]]; then
    fail "não consegui ler a validade do certificado ($connect)"
  else
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    if ((days < 14)); then fail "certificado vence em $days dias ($end)"; else pass "TLS válido (vence em $days dias)"; fi
  fi
else
  fail "TLS/conexão: $(cat "$TMP/err")"
fi

# :80 → https (só faz sentido na porta padrão)
if [[ $HOSTPORT != *:* ]]; then
  loc="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$HOSTPORT/" || true)"
  [[ $loc == "301 https://$HOSTPORT/" ]] && pass "http → 301 https" || fail "http:// não redireciona para https (obtido: $loc)"
fi

# home
code="$(get /)"
if [[ $code == 200 ]]; then pass "home 200"; else fail "home → $code"; fi
if grep -qi 'name="robots"[^>]*noindex' "$TMP/body" || hdr X-Robots-Tag | grep -qi noindex; then pass "noindex"; else fail "sem noindex (meta robots ou X-Robots-Tag)"; fi
hsts="$(hdr Strict-Transport-Security)"; [[ $hsts == *max-age=* ]] && pass "HSTS: $hsts" || fail "sem HSTS"
csp="$(hdr Content-Security-Policy)"; [[ $csp == *"frame-ancestors 'none'"* ]] && pass "CSP presente" || fail "CSP ausente/sem frame-ancestors"
[[ $(hdr X-Content-Type-Options) == nosniff ]] && pass "nosniff" || fail "sem X-Content-Type-Options"
[[ $(hdr Cache-Control) == *no-cache* ]] && pass "index no-cache" || fail "index sem no-cache ($(hdr Cache-Control))"
asset="$(grep -oE '/assets/[^"]+\.js' "$TMP/body" | head -1 || true)"
if [[ -n $asset ]]; then
  code="$(get "$asset")"
  [[ $code == 200 && $(hdr Cache-Control) == *immutable* ]] && pass "asset $asset 200 imutável" || fail "asset $asset → $code ($(hdr Cache-Control))"
fi

# health / API
code="$(get /health/live)"; [[ $code == 200 ]] && grep -q '"ok":true' "$TMP/body" && pass "/health/live" || fail "/health/live → $code $(head -c 200 "$TMP/body")"
code="$(get /health/ready)"; [[ $code == 200 ]] && grep -q '"ok":true' "$TMP/body" && pass "/health/ready" || fail "/health/ready → $code $(head -c 200 "$TMP/body")"
code="$(get /api/status)"
PROTO="$(jq -r '.protocol // empty' "$TMP/body" 2>/dev/null || true)"
if [[ $code == 200 && $PROTO =~ ^[0-9]+$ ]]; then pass "/api/status protocol=$PROTO version=$(jq -r '.version // "?"' "$TMP/body")"; else fail "/api/status → $code $(head -c 200 "$TMP/body")"; fi

# o que nunca é público
for p in /internal/health /metrics; do
  code="$(get "$p")"; [[ $code == 403 || $code == 404 ]] && pass "$p bloqueado ($code)" || fail "$p acessível de fora ($code)"
done

# WebSocket: handshake HTTP/1.1 (101) e entrada real como espectador
code="$("${CURL[@]}" --http1.1 --max-time 4 -o /dev/null -w '%{http_code}' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dHJldGFyaW8tc21va2UtMQ==' "$BASE/game/" 2>/dev/null || true)"
[[ $code == 101* ]] && pass "handshake WebSocket /game/ (101)" || fail "handshake WebSocket /game/ → $code"
if command -v node >/dev/null; then
  if out="$(NODE_EXTRA_CA_CERTS="${SMOKE_CACERT:-}" node "$SCRIPT_DIR/ws-join-check.mjs" "wss://$HOSTPORT/game" "$PROTO" 2>&1)"; then
    pass "entrou como espectador: $out"
  else
    fail "entrada na sala como espectador: $out"
  fi
fi

echo
if ((FAILS)); then die "smoke: $FAILS falha(s) em $BASE"; fi
ok "smoke ok em $BASE"
