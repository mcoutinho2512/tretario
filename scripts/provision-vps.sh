#!/usr/bin/env bash
# Provisiona a VPS de produção (Ubuntu 24.04 LTS) do Presidente Vargas 3D — deploy/CONTRACT.md, docs/DEPLOYMENT.md.
# Idempotente: pode rodar de novo a qualquer momento (não recria segredos, não sobrescreve server.env, não mexe nos
# dados do PostgreSQL). Rodar UMA vez como administrador com sudo, a partir de um clone do repositório:
#
#   sudo scripts/provision-vps.sh [--repo <url-git>] [--domain jogo.exemplo.com.br --email ops@exemplo.com.br]
#                                 [--admin-ip <ip>]... [--with-www] [--ssh-port 22022] [--harden-ssh] [--node-version 20.20.2] [--skip-apt-upgrade]
#                                 [--shared-host]   VPS que já roda outros sistemas (Ubuntu 22.04/24.04): só o que é do jogo
#
#   --repo        origem do espelho git usado pelo deploy (padrão: o `origin` deste clone). Repositório privado:
#                 use a URL SSH e uma deploy key só-leitura na conta do administrador (docs/DEPLOYMENT.md)
#   --domain      ativa HTTPS (certbot --webroot); sem domínio o Nginx só responde a página de manutenção em :80
#   --email       e-mail da conta Let's Encrypt (obrigatório junto com --domain na primeira emissão)
#   --with-www    certificado também para www.<domínio> (o Nginx redireciona www → domínio)
#   --ssh-port    porta do SSH para ufw/fail2ban (padrão: a do `sshd -T`; diferente dela → recusa). Produção: 22022
#   --admin-ip    IP do administrador que o fail2ban nunca bane (pode repetir)
#   --harden-ssh  desliga login por senha no SSH — SÓ depois de confirmar o login por chave numa SEGUNDA sessão
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/lib.sh
. "$SCRIPT_DIR/lib.sh"

DOMAIN="" EMAIL="" REPO_URL="" HARDEN_SSH=0 WITH_WWW=0 SSH_PORT="" SKIP_UPGRADE=0 SHARED=0
NODE_VERSION="${NODE_VERSION:-20.20.2}" # mesmo major da máquina de desenvolvimento (node -v = v20.20.2)
ADMIN_IPS=()
while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; shift ;;
    --no-email) EMAIL="-"; shift ;; # certificado sem e-mail de contato (sem avisos de expiração; renovação continua automática)
    --repo) REPO_URL="${2:?}"; shift 2 ;;
    --repo=*) REPO_URL="${1#*=}"; shift ;;
    --admin-ip) ADMIN_IPS+=("${2:?}"); shift 2 ;;
    --admin-ip=*) ADMIN_IPS+=("${1#*=}"); shift ;;
    --node-version) NODE_VERSION="${2:?}"; shift 2 ;;
    --harden-ssh) HARDEN_SSH=1; shift ;;
    --with-www) WITH_WWW=1; shift ;;
    --ssh-port) SSH_PORT="${2:?}"; shift 2 ;;
    --ssh-port=*) SSH_PORT="${1#*=}"; shift ;;
    --skip-apt-upgrade) SKIP_UPGRADE=1; shift ;;
    --shared-host) SHARED=1; SKIP_UPGRADE=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1 (veja --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "rode com sudo (sudo $0 ...)"
ADMIN_USER="${SUDO_USER:-root}"
[[ $DOMAIN =~ ^[A-Za-z0-9.-]*$ ]] || die "domínio inválido: $DOMAIN"
if [[ -n $DOMAIN && -z $EMAIL && ! -e /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
  die "--domain sem --email (ou --no-email): o Let's Encrypt pede um contato na primeira emissão"
fi
# shellcheck source=/dev/null
. /etc/os-release
# 24.04 (VPS dedicada) ou 22.04 (VPS COMPARTILHADA com outros sistemas: só --shared-host)
if [[ ${ID:-} != ubuntu ]] || { [[ ${VERSION_ID:-} != 24.04 ]] && ! { [[ ${VERSION_ID:-} == 22.04 ]] && ((SHARED)); }; }; then
  die "feito para Ubuntu 24.04 LTS (ou 22.04 com --shared-host); achei ${PRETTY_NAME:-?}"
fi
# --shared-host: a VPS já roda OUTROS sistemas (sites no Nginx, containers, ufw/fail2ban próprios). Só o que é do
# jogo é instalado/alterado: sem apt upgrade (poderia reiniciar Docker/Nginx dos outros), sem mexer em ufw/fail2ban/
# journald/unattended/swap, sem default_server no Nginx, sem http2 (no Nginx 1.18 ligaria o HTTP/2 nos outros sites
# da mesma porta), Postgres com memória modesta. Pacotes já instalados (nginx, certbot) não são reinstalados.
((SHARED)) && log "MODO COMPARTILHADO: só o que é do jogo será instalado/alterado (veja docs/DEPLOYMENT.md)"
HAS_SYSTEMD=0; [[ -d /run/systemd/system ]] && HAS_SYSTEMD=1
IN_CONTAINER=0; if systemd-detect-virt --container -q 2>/dev/null || [[ -f /.dockerenv ]]; then IN_CONTAINER=1; fi
MISSING=()
# porta do SSH: a que o sshd usa de fato (a VPS de produção usa 22022). --ssh-port diferente do sshd → recusa,
# para o ufw/fail2ban nunca trancarem o administrador fora
mkdir -p /run/sshd 2>/dev/null || true # sshd -T exige o diretório de privilégio
SSHD_PORT="$( (sshd -T 2>/dev/null || true) | awk '$1=="port" {print $2; exit}')"
[[ -n $SSHD_PORT ]] || warn "não consegui ler a porta do sshd (sshd -T); usando ${SSH_PORT:-22} — CONFIRA antes de ativar o ufw"
if [[ -n $SSH_PORT && -n $SSHD_PORT && $SSH_PORT != "$SSHD_PORT" ]]; then
  die "--ssh-port $SSH_PORT, mas o sshd escuta em $SSHD_PORT (sshd -T). Nada alterado."
fi
SSH_PORT="${SSH_PORT:-${SSHD_PORT:-22}}"
[[ $SSH_PORT =~ ^[0-9]+$ ]] || die "porta SSH inválida: $SSH_PORT"

svc() { # systemctl só quando há systemd (o teste em container sem systemd pula)
  if ((HAS_SYSTEMD)); then systemctl "$@"; else warn "sem systemd: pulei 'systemctl $*'"; fi
}
install_file() { # install_file <origem> <destino> <modo> [dono] → 0 se mudou
  local src="$1" dst="$2" mode="$3" owner="${4:-root:root}"
  if [[ -f $dst ]] && cmp -s "$src" "$dst"; then return 1; fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$src" "$dst"
  log "instalado $dst"
}
render() { # render <modelo> → arquivo temporário com __DOMAIN__/__IGNOREIP__ trocados
  local out; out="$(mktemp)"
  sed -e "s/__DOMAIN__/${DOMAIN:-__DOMAIN__}/g" -e "s#__IGNOREIP__#${ADMIN_IPS[*]:-}#g" -e "s/__SSH_PORT__/$SSH_PORT/g" "$1" >"$out"
  printf '%s' "$out"
}

# ---------------------------------------------------------------- 1. pacotes
export DEBIAN_FRONTEND=noninteractive
log "apt: atualizando índices"
apt-get update -q
if ((!SKIP_UPGRADE)); then
  apt-get -q -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
fi
if ((SHARED)); then
  # PostgreSQL 16 no 22.04 vem do repositório oficial do PostgreSQL (PGDG)
  if [[ ${VERSION_CODENAME:-} == jammy && ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
    install -d -m 755 /usr/share/postgresql-common/pgdg
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt jammy-pgdg main" >/etc/apt/sources.list.d/pgdg.list
    apt-get update -q
  fi
  # só o que FALTA (instalar um pacote já presente poderia atualizá-lo e reiniciar o serviço dos outros sistemas)
  missing=()
  for pkg in ca-certificates curl git rsync iproute2 procps jq openssl xz-utils acl sudo cron logrotate nginx certbot postgresql-16 postgresql-client-16; do
    dpkg -s "$pkg" &>/dev/null || missing+=("$pkg")
  done
  ((${#missing[@]})) && apt-get -q -y install --no-install-recommends "${missing[@]}"
  ok "pacotes (instalados agora: ${missing[*]:-nenhum})"
else
apt-get -q -y install --no-install-recommends \
  ca-certificates curl git rsync iproute2 procps jq openssl xz-utils acl sudo cron logrotate \
  nginx postgresql-16 postgresql-client-16 certbot ufw fail2ban unattended-upgrades
ok "pacotes"
fi

# ---------------------------------------------------------------- 2. usuário e diretórios
if ! id "$TRETARIO_USER" &>/dev/null; then
  useradd --system --user-group --home-dir "$SHARED/home" --no-create-home --shell /usr/sbin/nologin "$TRETARIO_USER"
  log "usuário $TRETARIO_USER criado (sem shell de login, sem sudo)"
fi
mkd() { install -d -m "$1" -o "${2%%:*}" -g "${2##*:}" "$3"; }
mkd 755 root:root "$TRETARIO_ROOT"
mkd 755 root:root "$RELEASES"
mkd 755 root:root "$SHARED" # o Nginx (www-data) precisa atravessar para testar maintenance.on
mkd 700 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/env"
mkd 750 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/data"
mkd 700 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/home"
mkd 750 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/backups"
for d in daily weekly predeploy; do mkd 750 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/backups/$d"; done
mkd 755 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/logs"
mkd 755 "$TRETARIO_USER:$TRETARIO_USER" "$SHARED/monitor"
[[ -e $SHARED/deploy.lock ]] || install -m 644 -o root -g root /dev/null "$SHARED/deploy.lock"
[[ -e $SHARED/releases.log ]] || install -m 644 -o root -g root /dev/null "$SHARED/releases.log"
mkd 755 root:root /var/www/tretario-maintenance
mkd 755 root:root /var/www/letsencrypt
install_file "$REPO_DIR/deploy/maintenance/index.html" /var/www/tretario-maintenance/index.html 644 || true
ok "layout $TRETARIO_ROOT"

# ---------------------------------------------------------------- 3. Node (binário oficial, SHA-256 conferido)
case "$(uname -m)" in x86_64) NARCH=x64 ;; aarch64) NARCH=arm64 ;; *) die "arquitetura não suportada: $(uname -m)" ;; esac
NODE_DIR="/usr/local/lib/nodejs/node-v$NODE_VERSION-linux-$NARCH"
if [[ ! -x $NODE_DIR/bin/node ]]; then
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  base="https://nodejs.org/dist/v$NODE_VERSION"
  tarball="node-v$NODE_VERSION-linux-$NARCH.tar.xz"
  log "baixando Node $NODE_VERSION ($NARCH)"
  curl -fsSLo "$tmp/$tarball" "$base/$tarball"
  curl -fsSLo "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -) || die "SHA-256 do Node não confere"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$tmp/$tarball" -C /usr/local/lib/nodejs
fi
for b in node npm npx corepack; do ln -sfn "$NODE_DIR/bin/$b" "/usr/local/bin/$b"; done
ok "node $(/usr/local/bin/node -v) · npm $(/usr/local/bin/npm -v)"

# ---------------------------------------------------------------- 4. env de produção (NUNCA sobrescrever)
gen() { openssl rand -hex "$1"; }
if [[ ! -e $ENV_FILE ]]; then
  tmpenv="$(mktemp)"
  sed -e "s/__DB_PASSWORD__/$(gen 24)/" -e "s/__SESSION_SECRET__/$(gen 32)/" -e "s/__ADMIN_TOKEN__/$(gen 32)/" \
    -e "s/__DOMAIN__/${DOMAIN:-__DOMAIN__}/g" "$REPO_DIR/deploy/server.env.example" >"$tmpenv"
  install -m 600 -o "$TRETARIO_USER" -g "$TRETARIO_USER" "$tmpenv" "$ENV_FILE"
  rm -f "$tmpenv"
  ok "criado $ENV_FILE (segredos gerados agora; guarde uma cópia FORA da VPS, docs/BACKUP_RESTORE.md)"
else
  chown "$TRETARIO_USER:$TRETARIO_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  ok "$ENV_FILE já existe: mantido"
  if [[ -n $DOMAIN ]] && grep -q '__DOMAIN__' "$ENV_FILE"; then
    # único ajuste permitido num env existente: preencher o MARCADOR do domínio (cópia antes)
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%dT%H%M%S)"
    sed -i "s/__DOMAIN__/$DOMAIN/g" "$ENV_FILE"
    log "marcador __DOMAIN__ do env preenchido com $DOMAIN (cópia .bak-* ao lado)"
  fi
fi
grep -q '__DOMAIN__' "$ENV_FILE" && MISSING+=("PV_PUBLIC_ORIGIN sem domínio em $ENV_FILE (rode de novo com --domain)")

# ---------------------------------------------------------------- 5. PostgreSQL 16 (só localhost)
PG_CONF_DIR=/etc/postgresql/16/main
[[ -d $PG_CONF_DIR ]] || die "PostgreSQL 16 não encontrado em $PG_CONF_DIR"
grep -Eq "^include_dir = 'conf.d'" "$PG_CONF_DIR/postgresql.conf" || die "postgresql.conf sem include_dir conf.d"
PG_SRC="$REPO_DIR/deploy/postgres/90-tretario.conf"
if ((SHARED)); then # máquina dividida com outros sistemas: memória do banco menor
  PG_SRC="$(mktemp)"; sed -e 's/^shared_buffers = .*/shared_buffers = 512MB/' -e 's/^effective_cache_size = .*/effective_cache_size = 2GB/' \
    -e 's/^maintenance_work_mem = .*/maintenance_work_mem = 128MB/' "$REPO_DIR/deploy/postgres/90-tretario.conf" >"$PG_SRC"
fi
if install_file "$PG_SRC" "$PG_CONF_DIR/conf.d/90-tretario.conf" 644 postgres:postgres; then
  svc restart postgresql # só o cluster do jogo (o Postgres dos outros sistemas roda em container próprio)
fi
svc enable --now postgresql
if ((!HAS_SYSTEMD)); then pg_ctlcluster 16 main start 2>/dev/null || true; fi
for _ in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p 5432 && break; sleep 1; done
pg_isready -q -h 127.0.0.1 -p 5432 || die "PostgreSQL não respondeu em 127.0.0.1:5432"

DBURL="$(awk -F= '$1=="DATABASE_URL" { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "$ENV_FILE")"
[[ $DBURL =~ ^postgresql://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+) ]] || die "DATABASE_URL inesperada em $ENV_FILE"
DB_USER="${BASH_REMATCH[1]}" DB_PASS="${BASH_REMATCH[2]}" DB_NAME="${BASH_REMATCH[5]}"
[[ $DB_USER =~ ^[a-z_][a-z0-9_]*$ && $DB_NAME =~ ^[a-z_][a-z0-9_]*$ ]] || die "usuário/banco com caracteres inesperados"
psql_pg() { runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 "$@"; }
if [[ -z $(psql_pg -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'") ]]; then
  printf "CREATE ROLE %s LOGIN PASSWORD :'pw';\n" "$DB_USER" | psql_pg -v pw="$DB_PASS"
  log "role $DB_USER criada"
fi
if [[ -z $(psql_pg -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'") ]]; then
  psql_pg -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8' TEMPLATE template0"
  psql_pg -c "REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC"
  log "banco $DB_NAME criado"
fi
PGPASSWORD="$DB_PASS" psql -X -q -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null ||
  die "a senha do env não entra no banco ($DB_USER@$DB_NAME). NÃO troquei nada: confira o env ou a role manualmente."
ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '^(0\.0\.0\.0|\*|\[::\]):5432$' && die "PostgreSQL escutando em todas as interfaces!"
ok "PostgreSQL 16: $DB_USER@$DB_NAME em 127.0.0.1:5432"

# ---------------------------------------------------------------- 6. Nginx + HTTPS
NGX=/etc/nginx
for f in tretario-headers.conf tretario-proxy.conf; do
  r="$(render "$REPO_DIR/deploy/nginx/snippets/$f")"; install_file "$r" "$NGX/snippets/$f" 644 || true; rm -f "$r"
done
# muitos WebSockets: cada jogador = 2 conexões no Nginx (cliente + upstream)
sed -i -E 's/^(\s*)worker_connections\s+[0-9]+;/\1worker_connections 8192;/' "$NGX/nginx.conf"
grep -q '^worker_rlimit_nofile' "$NGX/nginx.conf" || sed -i '1i worker_rlimit_nofile 32768;' "$NGX/nginx.conf"
((SHARED)) || sed -i -E 's/^(\s*)# ?server_tokens off;/\1server_tokens off;/' "$NGX/nginx.conf" # compartilhada: cada site do jogo já diz server_tokens off
((SHARED)) || rm -f "$NGX/sites-enabled/default"
r="$(render "$REPO_DIR/deploy/nginx/tretario-bootstrap.conf")"
# compartilhada: outro site já é o default_server da porta 80 → o provisório do jogo responde só aos nomes do jogo
((SHARED)) && sed -i -E -e 's/ default_server;/;/' -e "s/server_name _;/server_name ${DOMAIN:-_} ${DOMAIN:+www.$DOMAIN};/" "$r"
install_file "$r" "$NGX/sites-available/tretario-bootstrap.conf" 644 || true; rm -f "$r"
use_site() { # ativa só um dos dois sites
  ln -sfn "$NGX/sites-available/$1" "$NGX/sites-enabled/$1"
  [[ $1 == tretario.conf ]] && rm -f "$NGX/sites-enabled/tretario-bootstrap.conf"
  [[ $1 == tretario-bootstrap.conf ]] && rm -f "$NGX/sites-enabled/tretario.conf"
  nginx -t -q || die "nginx -t falhou (veja acima); nada recarregado"
  if ((HAS_SYSTEMD)); then systemctl enable -q nginx; systemctl reload-or-restart nginx; else nginx -s reload 2>/dev/null || nginx; fi
}
CERT="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [[ -n $DOMAIN ]]; then
  r="$(render "$REPO_DIR/deploy/nginx/tretario.conf")"
  ((SHARED)) && sed -i -E 's/ ssl http2;/ ssl;/' "$r" # sem http2: não ligar HTTP/2 nos outros sites da porta 443
  install_file "$r" "$NGX/sites-available/tretario.conf" 644 || true; rm -f "$r"
  CERT_ARGS=(-d "$DOMAIN"); ((WITH_WWW)) && CERT_ARGS+=(-d "www.$DOMAIN")
  need_cert=0
  if [[ ! -e $CERT ]]; then
    need_cert=1; use_site tretario-bootstrap.conf # :80 só com ACME até existir certificado
  elif ((WITH_WWW)) && ! openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:www.$DOMAIN"; then
    need_cert=1 # certificado existe sem o www: expandir (a config completa também responde ACME em :80)
  fi
  if ((need_cert)); then
    log "certbot: certificado para ${CERT_ARGS[*]} (webroot; o DNS precisa apontar para esta VPS)"
    certbot certonly --webroot -w /var/www/letsencrypt "${CERT_ARGS[@]}" $( [[ $EMAIL == - ]] && echo --register-unsafely-without-email || echo "${EMAIL:+--email $EMAIL}") --agree-tos \
      --no-eff-email --non-interactive --keep-until-expiring --expand ||
      MISSING+=("certificado de ${CERT_ARGS[*]} não emitido (DNS A/AAAA apontando para cá? porta 80 aberta?) — rode de novo")
  fi
  ((WITH_WWW)) || MISSING+=("www.$DOMAIN sem certificado (o Nginx redireciona www → $DOMAIN; use --with-www quando o DNS do www existir)")
  if [[ -e $CERT ]]; then
    use_site tretario.conf
    hook=/etc/letsencrypt/renewal-hooks/deploy/tretario-reload-nginx.sh
    mkdir -p "$(dirname "$hook")"
    printf '#!/bin/sh\n# renovação do certbot → recarrega o Nginx (sem derrubar WebSockets)\nsystemctl reload nginx\n' >"${hook}.new"
    install -D -m 755 "${hook}.new" "$hook"; rm -f "${hook}.new"
    svc enable --now certbot.timer || true
    ok "HTTPS ativo para $DOMAIN (renovação: certbot.timer)"
  fi
else
  use_site tretario-bootstrap.conf
  MISSING+=("HTTPS: nenhum --domain informado; o Nginx responde só a página de manutenção em :80 (o jogo não sai em HTTP puro)")
fi

# ---------------------------------------------------------------- 7. firewall + fail2ban
if ((SHARED)); then
  # firewall/fail2ban são dos OUTROS sistemas também: não alterar; só conferir que o necessário está liberado
  st="$(ufw status 2>/dev/null || true)"
  grep -Eq "^${SSH_PORT}(/tcp)? .*ALLOW" <<<"$st" || warn "ufw: porta SSH $SSH_PORT não aparece liberada — conferir manualmente"
  grep -Eq "^(80|443)(/tcp)? .*ALLOW|Nginx Full" <<<"$st" || warn "ufw: 80/443 não aparecem liberadas — conferir manualmente"
  grep -q 5432 <<<"$st" && die "ufw tem regra para 5432: o banco nunca é público"
  ok "ufw/fail2ban existentes mantidos (modo compartilhado)"
elif ((IN_CONTAINER)); then
  warn "container: ufw não ativado (rede do container); na VPS: 22/80/443 apenas"
else
  ufw allow "$SSH_PORT/tcp" comment ssh >/dev/null # PRIMEIRO o SSH: nunca trancar o administrador
  ufw allow 80/tcp comment http >/dev/null
  ufw allow 443/tcp comment https >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable >/dev/null
  ufw status | grep -q 5432 && die "ufw tem regra para 5432: o banco nunca é público"
  ok "ufw: $SSH_PORT/80/443"
fi
if ((!SHARED)); then
r="$(render "$REPO_DIR/deploy/system/fail2ban-tretario.local")"
if install_file "$r" /etc/fail2ban/jail.d/tretario.local 644; then svc restart fail2ban || true; fi; rm -f "$r"
svc enable --now fail2ban || true
fi

# ---------------------------------------------------------------- 8. logs, atualizações, kernel, swap
if ((!SHARED)) && install_file "$REPO_DIR/deploy/system/journald-tretario.conf" /etc/systemd/journald.conf.d/tretario.conf 644; then
  svc restart systemd-journald || true
fi
install_file "$REPO_DIR/deploy/system/logrotate-tretario" /etc/logrotate.d/tretario 644 || true
((SHARED)) || install_file "$REPO_DIR/deploy/system/unattended-upgrades-tretario" /etc/apt/apt.conf.d/52tretario-unattended 644 || true
((SHARED)) || printf 'net.core.somaxconn = 4096\nnet.ipv4.tcp_max_syn_backlog = 4096\nvm.swappiness = 10\n' >/tmp/90-tretario.conf
if ((!SHARED)) && install_file /tmp/90-tretario.conf /etc/sysctl.d/90-tretario.conf 644 && ((!IN_CONTAINER)); then sysctl -q --system || true; fi
rm -f /tmp/90-tretario.conf
if ((!IN_CONTAINER)) && [[ -z $(swapon --show --noheadings) && ! -e /swapfile ]]; then
  # 2 GB de swap: rede de segurança para o `npm ci`/build do deploy, não para o jogo
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  log "swap de 2 GB criado"
fi

# ---------------------------------------------------------------- 9. systemd: app + timers
for u in tretario.service tretario-backup.service tretario-backup.timer tretario-health.service tretario-health.timer; do
  install_file "$REPO_DIR/deploy/systemd/$u" "/etc/systemd/system/$u" 644 || true
done
svc daemon-reload
svc enable -q tretario.service tretario-backup.timer tretario-health.timer
svc start tretario-backup.timer tretario-health.timer
if [[ -L $CURRENT ]]; then svc start tretario.service; else MISSING+=("primeiro deploy: scripts/deploy-production.sh (o serviço sobe nele)"); fi

# ---------------------------------------------------------------- 10. espelho git usado pelo deploy
REPO_URL="${REPO_URL:-$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)}"
if [[ ! -d $MIRROR ]]; then
  rm -rf "$MIRROR.tmp"; install -d -m 755 -o "$ADMIN_USER" -g "$(id -gn "$ADMIN_USER")" "$MIRROR.tmp"
  if [[ -n $REPO_URL ]] && as_user "$ADMIN_USER" git clone --quiet --mirror "$REPO_URL" "$MIRROR.tmp"; then
    mv "$MIRROR.tmp" "$MIRROR"; ok "espelho git: $MIRROR ← $REPO_URL"
  else
    rm -rf "$MIRROR.tmp"
    MISSING+=("espelho git: falhou clonar '${REPO_URL:-?}' como $ADMIN_USER (deploy key? docs/DEPLOYMENT.md) → git clone --mirror <url> $MIRROR")
  fi
fi
if [[ -d $MIRROR ]]; then chown -R "$ADMIN_USER:$(id -gn "$ADMIN_USER")" "$MIRROR"; fi

# ---------------------------------------------------------------- 11. SSH (só com --harden-ssh e confirmação)
SSHD_DROPIN=/etc/ssh/sshd_config.d/10-tretario-hardening.conf
if [[ -f $SSHD_DROPIN ]]; then
  ok "SSH já endurecido ($SSHD_DROPIN)"
elif ((HARDEN_SSH)); then
  home_dir="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
  [[ $ADMIN_USER != root ]] || die "--harden-ssh: rode via sudo a partir do usuário administrador (não como root direto)"
  [[ -s $home_dir/.ssh/authorized_keys ]] || die "--harden-ssh: $home_dir/.ssh/authorized_keys vazio — você ficaria trancado"
  cat >&2 <<EOF
Antes de desligar senha no SSH, ABRA OUTRO TERMINAL e confirme (deixe esta sessão aberta):
    ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no $ADMIN_USER@<ip-da-vps> -p $SSH_PORT 'sudo -n true && echo CHAVE_OK'
EOF
  [[ -r /dev/tty ]] || die "--harden-ssh exige terminal interativo para a confirmação"
  read -r -p "Funcionou e imprimiu CHAVE_OK? Digite SIM para desligar o login por senha: " answer </dev/tty
  [[ $answer == SIM ]] || die "SSH não alterado"
  printf '%s\n' '# Presidente Vargas 3D — só chave (scripts/provision-vps.sh --harden-ssh)' \
    'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PubkeyAuthentication yes' \
    'PermitRootLogin no' 'MaxAuthTries 4' >"$SSHD_DROPIN"
  if ! sshd -t; then rm -f "$SSHD_DROPIN"; die "sshd -t falhou: alteração desfeita"; fi
  svc reload ssh || svc reload sshd || true
  ok "SSH: só chave. NÃO feche esta sessão antes de testar um login novo."
else
  cat <<EOF
SSH ainda aceita senha (não mexi). Para endurecer sem se trancar:
  1) numa SEGUNDA sessão: ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no $ADMIN_USER@<ip> 'echo CHAVE_OK'
  2) funcionou → sudo $0 --harden-ssh   (mantendo a primeira sessão aberta)
EOF
fi

# ---------------------------------------------------------------- resumo
echo
ok "provisionamento concluído ($(date -Is))"
if ((${#MISSING[@]})); then
  warn "falta:"
  for m in "${MISSING[@]}"; do printf '   - %s\n' "$m" >&2; done
fi
