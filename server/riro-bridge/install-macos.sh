#!/bin/zsh
set -euo pipefail

if [[ ! "${RIRO_BRIDGE_SECRET:-}" =~ '^[0-9a-fA-F]{64}$' ]]; then
  echo "RIRO_BRIDGE_SECRET must be a 64-character hexadecimal value." >&2
  exit 1
fi

SCRIPT_DIR="${0:A:h}"
INSTALL_DIR="${HOME}/Library/Application Support/IntactRiroBridge"
PLIST_PATH="${HOME}/Library/LaunchAgents/com.intact.riro-bridge.plist"
PYTHON_BIN="${RIRO_PYTHON_BIN:-}"
if [[ -z "${PYTHON_BIN}" ]]; then
  if [[ -x /opt/homebrew/bin/python3 ]]; then
    PYTHON_BIN=/opt/homebrew/bin/python3
  elif [[ -x /usr/local/bin/python3 ]]; then
    PYTHON_BIN=/usr/local/bin/python3
  else
    PYTHON_BIN="$(command -v python3 || true)"
  fi
fi
if [[ -z "${PYTHON_BIN}" ]] || ! "${PYTHON_BIN}" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  echo "Python 3.11 or newer is required. Set RIRO_PYTHON_BIN to a compatible interpreter." >&2
  exit 1
fi
TAILSCALE_BIN="$(command -v tailscale || true)"
if [[ -z "${TAILSCALE_BIN}" && -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
  TAILSCALE_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi
if [[ -z "${TAILSCALE_BIN}" ]]; then
  echo "Tailscale CLI was not found." >&2
  exit 1
fi
TAILSCALE_IP="${RIRO_BRIDGE_TAILSCALE_IP:-$(${TAILSCALE_BIN} ip -4 | head -n 1)}"
if [[ ! "${TAILSCALE_IP}" =~ '^100\.' ]]; then
  echo "A Tailscale IPv4 address is required." >&2
  exit 1
fi

PREFLIGHT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/intact-riro-preflight.XXXXXX")"
cleanup_preflight() {
  rm -rf -- "${PREFLIGHT_DIR}"
}
trap cleanup_preflight EXIT
"${PYTHON_BIN}" -m venv "${PREFLIGHT_DIR}/.venv"
"${PREFLIGHT_DIR}/.venv/bin/python" -m pip install --disable-pip-version-check --quiet --upgrade pip==26.1.2
"${PREFLIGHT_DIR}/.venv/bin/python" -m pip install --disable-pip-version-check --quiet -r "${SCRIPT_DIR}/requirements.txt"
"${PREFLIGHT_DIR}/.venv/bin/python" -m pip check
(
  cd "${SCRIPT_DIR}"
  RIRO_BRIDGE_SECRET="${RIRO_BRIDGE_SECRET}" "${PREFLIGHT_DIR}/.venv/bin/python" - <<'PY'
import asyncio

from main import app, lifespan


async def preflight() -> None:
    async with lifespan(app):
        pass


asyncio.run(preflight())
PY
)

mkdir -p "${INSTALL_DIR}" "${HOME}/Library/LaunchAgents"
chmod 700 "${INSTALL_DIR}"
cp "${SCRIPT_DIR}/main.py" "${SCRIPT_DIR}/requirements.txt" "${INSTALL_DIR}/"
"${PYTHON_BIN}" -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/python" -m pip install --disable-pip-version-check --quiet --upgrade pip==26.1.2
"${INSTALL_DIR}/.venv/bin/python" -m pip install --disable-pip-version-check --quiet -r "${INSTALL_DIR}/requirements.txt"
"${INSTALL_DIR}/.venv/bin/python" -m pip check

sed \
  -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
  -e "s|__TAILSCALE_IP__|${TAILSCALE_IP}|g" \
  -e "s|__BRIDGE_SECRET__|${RIRO_BRIDGE_SECRET}|g" \
  "${SCRIPT_DIR}/com.intact.riro-bridge.plist.template" > "${PLIST_PATH}"
chmod 600 "${PLIST_PATH}"

launchctl bootout "gui/${UID}/com.intact.riro-bridge" >/dev/null 2>&1 || true
if launchctl bootstrap "gui/${UID}" "${PLIST_PATH}"; then
  launchctl enable "gui/${UID}/com.intact.riro-bridge"
else
  # `bootstrap` can return an I/O error in an otherwise valid remote GUI
  # session. The legacy loader remains supported and starts the same agent.
  launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl load -w "${PLIST_PATH}"
fi

for _ in {1..20}; do
  if curl --fail --silent --max-time 2 "http://${TAILSCALE_IP}:8765/health" >/dev/null; then
    echo "Riroschool bridge is healthy at http://${TAILSCALE_IP}:8765"
    exit 0
  fi
  sleep 1
done

echo "Bridge did not become healthy. Check ${INSTALL_DIR}/bridge-error.log" >&2
exit 1
