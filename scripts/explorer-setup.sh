#!/usr/bin/env bash
# Prepara un VPS Ubuntu 22.04 o 24.04 para correr el worker del explorador.
# Idempotente: se puede volver a ejecutar sin romper nada.
#
# Instala:
#   - Node.js 22 LTS (NodeSource)
#   - usuario de sistema "autoqa" sin login
#   - directorio /opt/autoqa (código) y /var/lib/autoqa/explorations (capturas)
#   - dependencias del sistema que Chromium necesita
#   - binario de Chromium vía playwright-core
#
# NO instala la unidad systemd ni el archivo .env: eso lo hace el admin
# a mano (ver docs/EXPLORER_DEPLOY.md) para no arriesgar credenciales.
#
# Uso (como root o con sudo):
#   sudo bash scripts/explorer-setup.sh [RUTA_REPO]
#
# RUTA_REPO opcional: si ya clonaste el repo en otra ruta, pásala.
# Por defecto asume /opt/autoqa.

set -euo pipefail

REPO_DIR="${1:-/opt/autoqa}"
AUTOQA_USER="autoqa"
AUTOQA_GROUP="autoqa"
DATA_DIR="/var/lib/autoqa"
SCREENSHOTS_DIR="${DATA_DIR}/explorations"
PLAYWRIGHT_DIR="/var/lib/autoqa/playwright-browsers"

log() { printf '[explorer-setup] %s\n' "$*"; }
die() { printf '[explorer-setup] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Ejecuta como root (sudo bash $0 ...)."

# --- 0. Verificar Ubuntu 22.04 / 24.04 ---------------------------------------
if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${VERSION_ID:-}" in
    22.04|24.04) : ;;
    *) log "AVISO: probado solo en Ubuntu 22.04 y 24.04 (detectado: ${PRETTY_NAME:-desconocido}). Continuando." ;;
  esac
fi

# --- 1. Paquetes base --------------------------------------------------------
log "Actualizando apt e instalando paquetes base…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git tzdata openssl

# --- 2. Node.js 22 LTS -------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2- | cut -d. -f1)" != "22" ]; then
  log "Instalando Node.js 22 LTS desde NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  log "Node.js 22 ya está instalado: $(node -v)"
fi

# --- 3. Usuario y grupos -----------------------------------------------------
if ! getent group "${AUTOQA_GROUP}" >/dev/null 2>&1; then
  log "Creando grupo ${AUTOQA_GROUP}…"
  groupadd --system "${AUTOQA_GROUP}"
fi
if ! id -u "${AUTOQA_USER}" >/dev/null 2>&1; then
  log "Creando usuario de sistema ${AUTOQA_USER}…"
  useradd --system --gid "${AUTOQA_GROUP}" --home-dir "${REPO_DIR}" \
          --shell /usr/sbin/nologin --comment "AutoQA explorer worker" \
          "${AUTOQA_USER}"
fi

# --- 4. Directorios de datos -------------------------------------------------
log "Preparando directorios de datos en ${DATA_DIR}…"
install -d -o "${AUTOQA_USER}" -g "${AUTOQA_GROUP}" -m 0700 "${DATA_DIR}"
install -d -o "${AUTOQA_USER}" -g "${AUTOQA_GROUP}" -m 0700 "${SCREENSHOTS_DIR}"
install -d -o "${AUTOQA_USER}" -g "${AUTOQA_GROUP}" -m 0700 "${PLAYWRIGHT_DIR}"
install -d -o root           -g "${AUTOQA_GROUP}" -m 0750 /etc/autoqa

# --- 5. Repositorio ----------------------------------------------------------
if [ ! -d "${REPO_DIR}/.git" ]; then
  log "No hay repositorio en ${REPO_DIR}."
  log "Clónalo tú (con tu token/SSH) y vuelve a ejecutar este script:"
  log "  git clone <url-del-repo> ${REPO_DIR}"
  log "  chown -R ${AUTOQA_USER}:${AUTOQA_GROUP} ${REPO_DIR}"
  exit 0
fi

log "Ajustando permisos del repositorio…"
chown -R "${AUTOQA_USER}:${AUTOQA_GROUP}" "${REPO_DIR}"

# --- 6. Dependencias del sistema para los tres motores ----------------------
log "Instalando dependencias nativas (Chromium + Firefox + WebKit)…"
# Playwright validará y pedirá más si falta algo. Cubre:
#  - Chromium: libnss3, libatk, libxkbcommon, libgbm, libasound…
#  - Firefox: libdbus-glib (además de las de Chromium)
#  - WebKit: libwoff1, libharfbuzz-icu, libenchant-2, libhyphen,
#    libgstreamer-plugins-bad, libwebpdemux2, libavif
apt-get install -y --no-install-recommends \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
  libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2t64 \
  libdbus-glib-1-2 \
  libwoff1 libharfbuzz-icu0 libenchant-2-2 libhyphen0 libmanette-0.2-0 \
  libgstreamer-plugins-bad1.0-0 libwebpdemux2 libavif16 2>/dev/null \
  || apt-get install -y --no-install-recommends libasound2 \
       libdbus-glib-1-2 libwoff1 libharfbuzz-icu0 libenchant-2-2 libhyphen0

# --- 7. Dependencias de node + Chromium -------------------------------------
log "Ejecutando npm ci como ${AUTOQA_USER}…"
sudo -u "${AUTOQA_USER}" env HOME="${REPO_DIR}" bash -lc \
  "cd '${REPO_DIR}' && npm ci --omit=dev=false"

log "Instalando los tres motores de Playwright (Chromium + Firefox + WebKit)…"
# Cada motor pesa ~350 MB. Los instalamos todos aunque el default sea
# Chromium: el worker puede recibir TestRun.targetBrowser = FIREFOX|WEBKIT
# sin necesitar reinstalar.
sudo -u "${AUTOQA_USER}" env HOME="${REPO_DIR}" \
     PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_DIR}" \
     bash -lc "cd '${REPO_DIR}' && npx --yes playwright@1.65.1 install chromium firefox webkit"

# --- 8. Build ---------------------------------------------------------------
log "Compilando API + web + explorer…"
sudo -u "${AUTOQA_USER}" env HOME="${REPO_DIR}" bash -lc \
  "cd '${REPO_DIR}' && npx prisma generate && npm --workspace apps/explorer run build"

# --- 9. Validación user namespace (necesario para chromiumSandbox: true) ----
if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then
  val="$(cat /proc/sys/kernel/unprivileged_userns_clone)"
  if [ "${val}" != "1" ]; then
    log "AVISO: unprivileged_userns_clone=${val}. El sandbox de Chromium puede fallar."
    log "  Arreglo: echo 'kernel.unprivileged_userns_clone=1' > /etc/sysctl.d/99-autoqa.conf && sysctl --system"
  fi
fi
if [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  val="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)"
  if [ "${val}" = "1" ]; then
    log "AVISO (Ubuntu 24.04): apparmor_restrict_unprivileged_userns=1 bloquea el sandbox."
    log "  Arreglo temporal: sysctl -w kernel.apparmor_restrict_unprivileged_userns=0"
    log "  Persistente: echo 'kernel.apparmor_restrict_unprivileged_userns=0' > /etc/sysctl.d/98-autoqa-userns.conf"
  fi
fi

log "Listo. Siguiente paso: crear /etc/autoqa/explorer.env y la unidad systemd."
log "Ver docs/EXPLORER_DEPLOY.md para los detalles."
