#!/usr/bin/env bash
# Levanta GitSight (backend en :8000 y frontend en :5173) con un solo comando.
#
#   ./start.sh                 instala lo que falte, arranca todo y abre el navegador
#   ./start.sh --no-browser    igual, pero sin abrir el navegador
#   ./start.sh --install-only  solo comprueba requisitos e instala dependencias
#
# La primera vez crea el entorno virtual de Python e instala las dependencias (puede tardar unos
# minutos). Las veces siguientes solo reinstala si cambiaron los archivos de dependencias.
# Funciona con el bash que trae macOS (3.2).

set -eu
cd "$(dirname "${0}")"

BACKEND_PORT=8000
FRONTEND_PORT=5173
MIN_PYTHON="3.12"
MIN_NODE="22.18"
URL="http://localhost:${FRONTEND_PORT}"
LOG_DIR=".tid-logs"

OPEN_BROWSER=1
INSTALL_ONLY=0
for arg in "$@"; do
  case "${arg}" in
    --no-browser) OPEN_BROWSER=0 ;;
    --install-only) INSTALL_ONLY=1 ;;
    -h|--help) sed -n '2,10p' "${0}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción desconocida: ${arg} (usa --help)"; exit 2 ;;
  esac
done

if [ -t 1 ]; then BOLD=$'\033[1m'; RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; OFF=$'\033[0m'; else BOLD=""; RED=""; YEL=""; GRN=""; OFF=""; fi
say()  { printf '%s\n' "${BOLD}$*${OFF}"; }
ok()   { printf '%s\n' "${GRN}✓${OFF} $*"; }
warn() { printf '%s\n' "${YEL}!${OFF} $*"; }
die()  { printf '%s\n' "${RED}✗ $*${OFF}" >&2; exit 1; }

# --- 1. Requisitos ------------------------------------------------------------------------

say "Comprobando requisitos…"

PY=""
for candidate in python3.13 python3.12 python3 python; do
  if command -v "${candidate}" >/dev/null 2>&1 &&
     "${candidate}" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    PY="${candidate}"; break
  fi
done
[ -n "${PY}" ] || die "Falta Python ${MIN_PYTHON} o superior. Instálalo desde https://www.python.org/downloads/ (o con tu gestor de paquetes) y vuelve a ejecutar."
ok "Python: $("${PY}" --version 2>&1) (${PY})"

command -v node >/dev/null 2>&1 || die "Falta Node.js ${MIN_NODE} o superior. Instálalo desde https://nodejs.org/ (versión LTS) y vuelve a ejecutar."
node_ok=$(node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.stdout.write(a>22||(a===22&&b>=18)?"1":"0")')
[ "${node_ok}" = "1" ] || die "Tu Node.js es $(node --version) y se necesita ${MIN_NODE} o superior. Actualízalo desde https://nodejs.org/ (versión LTS)."
ok "Node.js: $(node --version)"

command -v npm >/dev/null 2>&1 || die "Falta npm (viene con Node.js). Reinstala Node.js desde https://nodejs.org/."
command -v git >/dev/null 2>&1 || die "Falta git, que se usa para descargar los repositorios de los estudiantes. Instálalo desde https://git-scm.com/downloads."
ok "git: $(git --version)"

# --- 2. Dependencias (solo si faltan o cambiaron) ----------------------------------------------

stamp_of() { cksum < "${1}" | awk '{print $1"-"$2}'; }

if [ ! -x backend/.venv/bin/python ]; then
  say "Creando el entorno virtual de Python (solo la primera vez)…"
  "${PY}" -m venv backend/.venv
fi
REQ_STAMP="$(stamp_of backend/requirements.txt)"
if [ "$(cat backend/.venv/.tid-requirements 2>/dev/null || true)" != "${REQ_STAMP}" ]; then
  say "Instalando las dependencias del backend (puede tardar unos minutos)…"
  backend/.venv/bin/python -m pip install --quiet --upgrade pip
  backend/.venv/bin/python -m pip install --quiet -r backend/requirements.txt
  printf '%s' "${REQ_STAMP}" > backend/.venv/.tid-requirements
fi
ok "Backend listo"

LOCK_STAMP="$(stamp_of frontend/package-lock.json)"
if [ ! -d frontend/node_modules ] || [ "$(cat frontend/node_modules/.tid-lock 2>/dev/null || true)" != "${LOCK_STAMP}" ]; then
  say "Instalando las dependencias del frontend (puede tardar unos minutos)…"
  (cd frontend && npm install --no-audit --no-fund --loglevel=error)
  printf '%s' "${LOCK_STAMP}" > frontend/node_modules/.tid-lock
fi
ok "Frontend listo"

[ "${INSTALL_ONLY}" = "1" ] && { say "Dependencias instaladas. Para arrancar: ./start.sh"; exit 0; }

# --- 3. Puertos -------------------------------------------------------------------------------

pids_on_port() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${1}" -sTCP:LISTEN -t 2>/dev/null | sort -u
  fi
}

port_busy_without_lsof() {
  (exec 3<>"/dev/tcp/127.0.0.1/${1}") 2>/dev/null
}

ensure_port_free() {
  port="${1}"; what="${2}"
  pids="$(pids_on_port "${port}" || true)"
  if [ -z "${pids}" ]; then
    if ! command -v lsof >/dev/null 2>&1 && port_busy_without_lsof "${port}"; then
      die "El puerto ${port} (${what}) está ocupado por otro programa. Ciérralo y vuelve a ejecutar."
    fi
    return 0
  fi
  warn "El puerto ${port} (${what}) ya está en uso por:"
  for pid in ${pids}; do printf '    PID %s  %s\n' "${pid}" "$(ps -o command= -p "${pid}" 2>/dev/null | cut -c1-90)"; done
  if [ -t 0 ]; then
    printf '¿Quieres cerrarlo para continuar? [s/N] '
    read -r answer
    case "${answer}" in
      s|S|si|sí|SI|Sí|y|Y)
        for pid in ${pids}; do kill "${pid}" 2>/dev/null || true; done
        for _ in 1 2 3 4 5 6 7 8 9 10; do [ -z "$(pids_on_port "${port}" || true)" ] && return 0; sleep 0.5; done
        die "No se pudo liberar el puerto ${port}. Ciérralo a mano (kill ${pids}) y vuelve a ejecutar." ;;
    esac
  fi
  die "Libera el puerto ${port} (por ejemplo: kill ${pids}) y vuelve a ejecutar ./start.sh."
}

ensure_port_free "${BACKEND_PORT}" "backend"
ensure_port_free "${FRONTEND_PORT}" "frontend"

# --- 4. Arranque ------------------------------------------------------------------------------

mkdir -p "${LOG_DIR}"
set -m   # cada proceso en segundo plano en su propio grupo, para poder cerrarlo completo

BACK_PID=""; FRONT_PID=""
cleanup() {
  trap - EXIT INT TERM
  echo
  say "Cerrando GitSight…"
  for pid in ${FRONT_PID} ${BACK_PID}; do
    [ -n "${pid}" ] && kill -TERM -- "-${pid}" 2>/dev/null || true
  done
  sleep 1
  for pid in ${FRONT_PID} ${BACK_PID}; do
    [ -n "${pid}" ] && kill -KILL -- "-${pid}" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

say "Arrancando el backend en el puerto ${BACKEND_PORT}…"
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend \
  --host 127.0.0.1 --port "${BACKEND_PORT}" > "${LOG_DIR}/backend.log" 2>&1 &
BACK_PID=$!

say "Arrancando el frontend en el puerto ${FRONTEND_PORT}…"
(cd frontend && exec npm run dev -- --port "${FRONTEND_PORT}" --strictPort) > "${LOG_DIR}/frontend.log" 2>&1 &
FRONT_PID=$!

wait_for() {   # url, nombre, pid
  for _ in $(seq 1 120); do
    if curl -fs -o /dev/null "${1}" 2>/dev/null; then return 0; fi
    kill -0 "${3}" 2>/dev/null || { warn "${2} se cerró al arrancar. Últimas líneas de ${LOG_DIR}:"; tail -n 15 "${LOG_DIR}/${4}" || true; return 1; }
    sleep 0.5
  done
  warn "${2} no respondió en 60 segundos. Revisa ${LOG_DIR}/${4}"
  return 1
}

command -v curl >/dev/null 2>&1 || die "Falta curl (se usa para comprobar que los servidores arrancaron)."
wait_for "http://127.0.0.1:${BACKEND_PORT}/api/health" "El backend" "${BACK_PID}" backend.log || exit 1
wait_for "${URL}" "El frontend" "${FRONT_PID}" frontend.log || exit 1

echo
say "GitSight está listo:  ${URL}"
echo "  Para cerrarlo, presiona Ctrl+C en esta ventana."
echo "  Registros: ${LOG_DIR}/backend.log y ${LOG_DIR}/frontend.log"

if [ "${OPEN_BROWSER}" = "1" ]; then
  if command -v open >/dev/null 2>&1; then open "${URL}" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "${URL}" >/dev/null 2>&1 || true
  elif command -v wslview >/dev/null 2>&1; then wslview "${URL}" >/dev/null 2>&1 || true
  else warn "No pude abrir el navegador solo: abre ${URL}"; fi
fi

# Se queda esperando mientras los dos sigan vivos.
while kill -0 "${BACK_PID}" 2>/dev/null && kill -0 "${FRONT_PID}" 2>/dev/null; do sleep 1; done
warn "Uno de los servidores se detuvo. Revisa ${LOG_DIR}/."
exit 1
