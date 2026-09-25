#!/usr/bin/env bash
# =============================================================================
#  WILLY AI — Instalador para servidor Linux (IONOS VPS L: 4 vCores, 8 GB RAM)
#  Probado el build en Ubuntu/Node 22 (contenedor); la instalación completa en
#  un VPS real está pendiente de tu ejecución (ver LEEME-VPS.md).
#
#  Qué hace (en este orden):
#    1. Actualiza el sistema e instala utilidades, cortafuegos y fail2ban.
#    2. Instala Node 22, Caddy (HTTPS automático) y Ollama (IA local en CPU).
#    3. Descarga WILLY AI desde GitHub, lo compila para Linux (node-server)
#       y lo deja como servicio systemd que arranca solo (127.0.0.1:3000).
#    4. Pone Caddy delante con HTTPS + usuario y contraseña (basic auth):
#       WILLY AI 0.0.7 no tiene autenticación real en el servidor, así que sin
#       esta capa cualquiera en Internet podría usar tu IA y tus rutas /api.
#    5. Abre solo los puertos 22, 80 y 443. Activa actualizaciones automáticas.
#    6. Comprueba que todo responde y guarda el resumen en /root/willy-vps-resumen.txt
#
#  Uso (como root en el VPS):
#    DOMAIN=willy.tudominio.es ADMIN_USER=antonio bash instalar-willy-vps.sh
#  Variables opcionales:
#    DOMAIN         Dominio apuntando a la IP del VPS. Vacío = usa <ip>.sslip.io
#    ADMIN_USER     Usuario de acceso web (por defecto: antonio)
#    ADMIN_PASS     Contraseña de acceso web (vacío = se genera una segura)
#    REPO_URL       Repositorio (por defecto: https://github.com/murelf87/willy-ai)
#    BRANCH         Rama (por defecto: main)
#    INSTALL_OLLAMA yes|no (por defecto: yes)
#    OLLAMA_MODEL   Modelo a descargar (por defecto: llama3.2:3b — cabe en 8 GB)
#    TLS_MODE       auto|internal (internal = certificado propio, avisa el navegador)
#    ACME_EMAIL     Correo para avisos de caducidad de certificado (opcional)
# =============================================================================
set -Eeuo pipefail

DOMAIN="${DOMAIN:-}"
ADMIN_USER="${ADMIN_USER:-antonio}"
ADMIN_PASS="${ADMIN_PASS:-}"
REPO_URL="${REPO_URL:-https://github.com/murelf87/willy-ai}"
BRANCH="${BRANCH:-main}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-yes}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
TLS_MODE="${TLS_MODE:-auto}"
ACME_EMAIL="${ACME_EMAIL:-}"

APP_USER="willy"
APP_DIR="/opt/willy-ai"
SRC_DIR="$APP_DIR/app"
LOG="/var/log/willy-vps-install.log"
RESUMEN="/root/willy-vps-resumen.txt"

exec > >(tee -a "$LOG") 2>&1

paso() { printf '\n\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
ok()   { printf '   \033[1;32mOK\033[0m  %s\n' "$*"; }
aviso(){ printf '   \033[1;33mAVISO\033[0m %s\n' "$*"; }
fallo(){ printf '   \033[1;31mFALLO\033[0m %s\n' "$*"; }

trap 'fallo "El instalador se ha detenido en la línea $LINENO. Revisa $LOG"; exit 1' ERR

[[ $EUID -eq 0 ]] || { fallo "Ejecuta este script como root (sudo -i)."; exit 1; }

. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ok "Sistema: $PRETTY_NAME" ;;
  *) fallo "Solo Ubuntu o Debian. Detectado: ${PRETTY_NAME:-desconocido}"; exit 1 ;;
esac

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
CPUS=$(nproc)
ok "Recursos: ${CPUS} vCores, ${MEM_MB} MB RAM"
if (( MEM_MB < 3500 )) && [[ "$INSTALL_OLLAMA" == "yes" ]]; then
  aviso "Menos de 4 GB de RAM: no se instalará Ollama (INSTALL_OLLAMA=no)."
  INSTALL_OLLAMA="no"
fi

# ----------------------------------------------------------------------------- 1
paso "1/6 Sistema base, cortafuegos y protección SSH"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git ca-certificates gnupg ufw fail2ban unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https jq openssl

PUBLIC_IP="$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me || true)"
[[ -n "$PUBLIC_IP" ]] && ok "IP pública: $PUBLIC_IP" || aviso "No se pudo detectar la IP pública."

if [[ -z "$DOMAIN" ]]; then
  if [[ -n "$PUBLIC_IP" ]]; then
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
    aviso "Sin dominio propio: se usará $DOMAIN (gratuito). Si Let's Encrypt lo rechaza, vuelve a ejecutar con TLS_MODE=internal o con un dominio tuyo."
  else
    fallo "Indica DOMAIN=... (no hay IP pública detectable)."; exit 1
  fi
fi

ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ok "Cortafuegos: solo 22, 80 y 443 abiertos"

systemctl enable --now fail2ban
ok "fail2ban activo (bloquea intentos de fuerza bruta en SSH)"

dpkg-reconfigure -f noninteractive unattended-upgrades
ok "Actualizaciones de seguridad automáticas activadas"

if grep -qs "ssh-" /root/.ssh/authorized_keys 2>/dev/null; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  ok "SSH: acceso solo con clave (había clave en /root/.ssh/authorized_keys)"
else
  aviso "SSH sigue aceptando contraseña porque no hay clave pública instalada. Añade tu clave (ssh-copy-id root@$PUBLIC_IP) y vuelve a ejecutar."
fi

# ----------------------------------------------------------------------------- 2
paso "2/6 Node 22, Caddy y Ollama"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v), npm $(npm -v)"

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
ok "Caddy $(caddy version | head -1)"

if [[ "$INSTALL_OLLAMA" == "yes" ]]; then
  if ! command -v ollama >/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  systemctl enable --now ollama
  # Ollama escucha solo en 127.0.0.1:11434 por defecto: no se expone a Internet.
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  ok "Ollama en marcha (solo local, 127.0.0.1:11434)"
  paso "   Descargando modelo $OLLAMA_MODEL (puede tardar varios minutos)"
  ollama pull "$OLLAMA_MODEL"
  ok "Modelo disponible: $(ollama list | awk 'NR>1 {print $1}' | tr '\n' ' ')"
fi

# ----------------------------------------------------------------------------- 3
paso "3/6 Descarga y compilación de WILLY AI ($REPO_URL, rama $BRANCH)"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ -d "$SRC_DIR/.git" ]]; then
  git -C "$SRC_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$SRC_DIR" checkout -q -f FETCH_HEAD
else
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$SRC_DIR"
fi
COMMIT="$(git -C "$SRC_DIR" rev-parse --short HEAD)"
APP_VERSION="$(grep -oP 'APP_VERSION = "\K[0-9.]+' "$SRC_DIR/src/lib/version.ts" || echo desconocida)"
ok "Código en $SRC_DIR (commit $COMMIT, versión declarada $APP_VERSION)"

cd "$SRC_DIR"
# Registro público de npm (el repositorio ya trae package-lock.json generado con él).
# ONNXRUNTIME_NODE_INSTALL_CUDA=skip: onnxruntime-node (lo trae @huggingface/transformers)
# intenta bajar ~300 MB de binarios CUDA que en un VPS sin GPU no sirven de nada.
export npm_config_registry="https://registry.npmjs.org/"
export npm_config_fund=false npm_config_audit=false
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
# npm install (no "npm ci"): con las overrides de este package.json, npm ci rechaza el lockfile aunque esté recién generado.
npm install --no-audit --no-fund --loglevel=error
npx vite build --config vite.config.local.ts
[[ -f .output/server/index.mjs ]] || { fallo "La compilación no ha generado .output/server/index.mjs"; exit 1; }
ok "Compilado para Linux (preset node-server)"

# Archivo extraño detectado en el repositorio (commits «SaaS Clientes» del 21-22/09):
# public/index.html «Proyecto sin título» tapa la portada real en «/». Se desactiva
# SOLO en la salida compilada; el repositorio no se toca.
if grep -qs "Proyecto sin título" .output/public/index.html 2>/dev/null; then
  mv .output/public/index.html .output/public/index.html.desactivado
  aviso "public/index.html («Proyecto sin título») desactivado en la salida compilada para que «/» muestre la portada de WILLY AI. Conviene borrarlo del repositorio."
fi
# Datos del dueño (proyectos, perfil, voces, claves de motores): viven en <raíz>/datos-privados,
# fuera de git, y las actualizaciones nunca los tocan.
mkdir -p "$SRC_DIR/datos-privados"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ----------------------------------------------------------------------------- 4
paso "4/6 Servicio systemd (arranca solo, se reinicia si cae)"
cat > /etc/systemd/system/willy-ai.service <<EOF
[Unit]
Description=WILLY AI (web, Nitro node-server)
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$SRC_DIR
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=NITRO_HOST=127.0.0.1
Environment=NITRO_PORT=3000
ExecStart=/usr/bin/node $SRC_DIR/.output/server/index.mjs
Restart=always
RestartSec=3
MemoryMax=3G
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now willy-ai
for i in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:3000/app && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:3000/app && ok "WILLY AI responde en 127.0.0.1:3000 (solo interno)" || { fallo "WILLY AI no responde. journalctl -u willy-ai -n 50"; exit 1; }

# ----------------------------------------------------------------------------- 5
paso "5/6 Caddy: HTTPS + usuario y contraseña delante de WILLY AI"
if [[ -z "$ADMIN_PASS" ]]; then
  ADMIN_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  GENERATED_PASS="sí"
else
  GENERATED_PASS="no (la que indicaste)"
fi
HASH="$(caddy hash-password --plaintext "$ADMIN_PASS")"
TLS_LINE=""
[[ "$TLS_MODE" == "internal" ]] && TLS_LINE="tls internal"
GLOBAL_BLOCK=""
[[ -n "$ACME_EMAIL" ]] && GLOBAL_BLOCK=$'{\n\temail '"$ACME_EMAIL"$'\n}\n'

cat > /etc/caddy/Caddyfile <<EOF
$GLOBAL_BLOCK
$DOMAIN {
	$TLS_LINE
	encode zstd gzip
	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	basic_auth {
		$ADMIN_USER $HASH
	}
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
	log {
		output file /var/log/caddy/willy-access.log {
			roll_size 20mb
			roll_keep 5
		}
	}
}
EOF
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy
sleep 3
ok "Caddy configurado para https://$DOMAIN (usuario: $ADMIN_USER)"

# ----------------------------------------------------------------------------- 6
paso "6/6 Verificación"
RESULT_NOAUTH="$(curl -sk -o /dev/null -w '%{http_code}' "https://$DOMAIN/app" || true)"
RESULT_AUTH="$(curl -sk -o /dev/null -w '%{http_code}' -u "$ADMIN_USER:$ADMIN_PASS" "https://$DOMAIN/app" || true)"
RESULT_ENGINE="$(curl -sk -u "$ADMIN_USER:$ADMIN_PASS" "https://$DOMAIN/api/engine" || true)"
[[ "$RESULT_NOAUTH" == "401" ]] && ok "Sin contraseña → 401 (bloqueado)" || aviso "Sin contraseña devuelve $RESULT_NOAUTH (esperado 401). Si es 000, el certificado aún se está emitiendo: espera 1-2 min y prueba en el navegador."
[[ "$RESULT_AUTH" == "200" ]] && ok "Con contraseña → 200 (WILLY AI accesible)" || aviso "Con contraseña devuelve $RESULT_AUTH (esperado 200)."
echo "   /api/engine → $RESULT_ENGINE"
PORTS="$(ss -ltn | awk 'NR>1 {print $4}' | sed 's/.*://' | sort -un | tr '\n' ' ')"
echo "   Puertos escuchando (locales+públicos): $PORTS"

cat > "$RESUMEN" <<EOF
WILLY AI en tu VPS — resumen ($(date '+%d/%m/%Y %H:%M'))
--------------------------------------------------------
URL:           https://$DOMAIN
Usuario web:   $ADMIN_USER
Contraseña:    $ADMIN_PASS   (generada automáticamente: $GENERATED_PASS)
Código:        $SRC_DIR (commit $COMMIT, versión declarada $APP_VERSION)
Servicios:     systemctl status willy-ai caddy ollama
Registros:     journalctl -u willy-ai -f      /var/log/caddy/willy-access.log
Actualizar:    bash /root/actualizar-willy.sh
Ollama:        solo interno (127.0.0.1:11434). Modelos: $( [[ "$INSTALL_OLLAMA" == "yes" ]] && ollama list | awk 'NR>1 {print $1}' | tr '\n' ' ' || echo "no instalado")
Cortafuegos:   ufw status
Notas:
 - La cuenta de administrador interna de WILLY (Licencias) sigue con su valor por defecto: cámbiala.
 - Las claves de los motores externos se ponen desde la propia WILLY (Centro de Inteligencia);
   quedan en $SRC_DIR/datos-privados, que las actualizaciones no tocan.
 - Autoconstrucción, Fábrica de instaladores, ComfyUI y Chatterbox son funciones pensadas para
   el PC con Windows/GPU: en este servidor no están verificadas.
EOF
chmod 600 "$RESUMEN"

printf '\n\033[1;32m¡Listo!\033[0m Abre https://%s (usuario %s). Contraseña y detalles en %s\n\n' "$DOMAIN" "$ADMIN_USER" "$RESUMEN"
