#!/usr/bin/env bash
# =============================================================================
#  WILLY AI — Actualizar el VPS desde GitHub con vuelta atrás automática
#  Uso (root):  bash actualizar-willy.sh            (rama main)
#               BRANCH=otra-rama bash actualizar-willy.sh
#  Qué hace: guarda la versión que funciona, baja el código nuevo, compila,
#  reinicia el servicio y comprueba que responde. Si falla, restaura la anterior.
# =============================================================================
set -Eeuo pipefail
BRANCH="${BRANCH:-main}"
SRC_DIR="/opt/willy-ai/app"
APP_USER="willy"
ok()   { printf '   \033[1;32mOK\033[0m  %s\n' "$*"; }
aviso(){ printf '   \033[1;33mAVISO\033[0m %s\n' "$*"; }
fallo(){ printf '   \033[1;31mFALLO\033[0m %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { fallo "Ejecuta como root."; exit 1; }
[[ -d "$SRC_DIR/.git" ]] || { fallo "No existe $SRC_DIR. Ejecuta antes instalar-willy-vps.sh"; exit 1; }
cd "$SRC_DIR"

ANTES="$(git rev-parse --short HEAD)"
git fetch --depth 1 origin "$BRANCH"
DESPUES="$(git rev-parse --short FETCH_HEAD)"
if [[ "$ANTES" == "$DESPUES" ]]; then
  ok "Ya estás en la última versión ($ANTES). Nada que hacer."
  exit 0
fi
echo "Actualizando $ANTES → $DESPUES"

# Copia de seguridad de la salida compilada que funciona.
rm -rf .output.prev
[[ -d .output ]] && cp -a .output .output.prev

git checkout -q -f FETCH_HEAD   # datos-privados/ está fuera de git: no se toca
export npm_config_registry="https://registry.npmjs.org/" npm_config_fund=false npm_config_audit=false
export ONNXRUNTIME_NODE_INSTALL_CUDA=skip
# npm install (no "npm ci"): con las overrides de este package.json, npm ci rechaza el lockfile aunque esté recién generado.
npm install --no-audit --no-fund --loglevel=error
npx vite build --config vite.config.local.ts

if grep -qs "Proyecto sin título" .output/public/index.html 2>/dev/null; then
  mv .output/public/index.html .output/public/index.html.desactivado
  aviso "index.html extraño desactivado en la salida compilada (sigue en el repositorio)."
fi
chown -R "$APP_USER":"$APP_USER" /opt/willy-ai

systemctl restart willy-ai
for i in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:3000/app && break; sleep 1; done
if curl -fsS -o /dev/null http://127.0.0.1:3000/app; then
  ok "WILLY AI actualizado a $DESPUES y respondiendo."
  rm -rf .output.prev
else
  fallo "La versión nueva no responde. Restaurando $ANTES…"
  rm -rf .output && mv .output.prev .output
  git checkout -q -f "$ANTES"
  systemctl restart willy-ai
  sleep 3
  curl -fsS -o /dev/null http://127.0.0.1:3000/app && ok "Versión anterior restaurada ($ANTES)." || fallo "Tampoco responde la anterior: journalctl -u willy-ai -n 80"
  exit 1
fi
