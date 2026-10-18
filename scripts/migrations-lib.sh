# shellcheck shell=bash
# Estado das migrations Prisma × banco de produção (usado por deploy-production.sh e rollback-production.sh).
# Requer lib.sh carregado. Nunca escreve no banco.

# psql no banco de produção como o usuário do app (somente leitura)
db_q() {
  # shellcheck disable=SC2016 # expande dentro do bash -c do as_app
  as_app bash -c 'psql -X -q -v ON_ERROR_STOP=1 -tA "${DATABASE_URL%%\?*}" -c "SET default_transaction_read_only = on" -c "$1"' _ "$1"
}

# mig_state <release> → MIG_REPO, MIG_APPLIED_DB, MIG_PENDING, MIG_DB_ONLY; falha se houver migration incompleta
mig_state() {
  local rel="$1" m
  mapfile -t MIG_REPO < <(as_root find "$rel/server/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
  MIG_APPLIED_DB=() MIG_PENDING=() MIG_DB_ONLY=()
  if [[ $(db_q "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") == t ]]; then
    local broken
    broken="$(db_q "SELECT string_agg(migration_name, ' ') FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")"
    if [[ -n $broken ]]; then
      loud "Migration(s) INCOMPLETA(S) no banco: $broken" \
        "Uma migration falhou no meio. Nada foi feito. Resolver à mão: docs/INCIDENT_RESPONSE.md (Migration falhou)." \
        "NUNCA prisma migrate reset."
      return 1
    fi
    mapfile -t MIG_APPLIED_DB < <(db_q "SELECT DISTINCT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1")
  fi
  for m in "${MIG_REPO[@]}"; do [[ " ${MIG_APPLIED_DB[*]} " == *" $m "* ]] || MIG_PENDING+=("$m"); done
  for m in "${MIG_APPLIED_DB[@]}"; do [[ " ${MIG_REPO[*]} " == *" $m "* ]] || MIG_DB_ONLY+=("$m"); done
  if ((${#MIG_DB_ONLY[@]})) && [[ ${MIG_ALLOW_DB_AHEAD:-0} != 1 ]]; then
    loud "O banco tem migration(s) que este release NÃO conhece: ${MIG_DB_ONLY[*]}" \
      "Isso é um downgrade de código. Use scripts/rollback-production.sh (que exige --force-app-only)."
    return 1
  fi
  return 0
}

# padrões de perda de dados/compatibilidade em SQL de migration
MIG_DESTRUCTIVE_RE='DROP[[:space:]]+(TABLE|SCHEMA|DATABASE|TYPE|VIEW|MATERIALIZED[[:space:]]+VIEW|SEQUENCE)|DROP[[:space:]]+COLUMN|TRUNCATE|DELETE[[:space:]]+FROM|ALTER[[:space:]]+COLUMN[[:space:]]+[^[:space:]]+[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE|RENAME[[:space:]]+(COLUMN|TO)'

# linhas destrutivas de um SQL (sem comentários --), uma por linha
mig_destructive_lines() { sed -e 's/--.*$//' "$1" | grep -inE "$MIG_DESTRUCTIVE_RE" || true; }

# mig_destructive_guard <release> [migrations liberadas...] → 1 se alguma pendente destrutiva não foi liberada
mig_destructive_guard() {
  local rel="$1"; shift
  local m hits blocked=() a
  for m in "${MIG_PENDING[@]}"; do
    hits="$(as_root cat "$rel/server/prisma/migrations/$m/migration.sql" | mig_destructive_lines /dev/stdin)"
    [[ -n $hits ]] || continue
    local allowed=0
    for a in "$@"; do [[ $a == "$m" ]] && allowed=1; done
    if ((allowed)); then
      warn "migration DESTRUTIVA liberada por --allow-destructive=$m:"; printf '      %s\n' "$hits" >&2
    else
      blocked+=("$m"); printf '%s[destrutiva]%s %s:\n' "$C_RED" "$C_OFF" "$m" >&2; printf '      %s\n' "$hits" >&2
    fi
  done
  if ((${#blocked[@]})); then
    loud "Migration(s) com risco de PERDA DE DADOS pendente(s): ${blocked[*]}" \
      "Deploy ABORTADO antes de migrar (o backup pré-deploy foi feito; nada mudou no banco)." \
      "Política EXPAND → MIGRATE → CONTRACT: docs/DEPLOYMENT.md. Se for intencional e o código no ar já não usa" \
      "o que será removido, repita com --allow-destructive=<nome> para CADA uma."
    return 1
  fi
  return 0
}

# informativo: o que o Prisma acha que falta do banco atual até o schema do release (só leitura)
mig_diff_info() {
  local rel="$1" out
  # shellcheck disable=SC2016
  if out="$(as_app bash -c 'cd "$1" && npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script' _ "$rel/server" 2>&1)"; then
    local d; d="$(printf '%s\n' "$out" | sed -e 's/--.*$//' | grep -iE "$MIG_DESTRUCTIVE_RE" || true)"
    if [[ -n $d ]]; then warn "prisma migrate diff (banco → schema) contém comandos destrutivos:"; printf '      %s\n' "$d" >&2
    else log "prisma migrate diff: sem comandos destrutivos ($(printf '%s\n' "$out" | grep -cE '^(CREATE|ALTER)') CREATE/ALTER)"; fi
  else
    warn "prisma migrate diff indisponível: $(printf '%s' "$out" | tail -1)"
  fi
}
