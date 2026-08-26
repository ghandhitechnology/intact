#!/bin/zsh
set -euo pipefail

INSTALL_DIR="${0:A:h}"
TAILSCALE_BIN="${RIRO_TAILSCALE_BIN:-}"
PYTHON_BIN="${RIRO_PYTHON_BIN:-}"

if [[ -z "${TAILSCALE_BIN}" || ! -x "${TAILSCALE_BIN}" ]]; then
  echo "Riro bridge cannot start: the configured Tailscale CLI is unavailable." >&2
  exit 69
fi
if [[ -z "${PYTHON_BIN}" || ! -x "${PYTHON_BIN}" ]]; then
  echo "Riro bridge cannot start: the configured Python environment is unavailable." >&2
  exit 69
fi

# launchd can start this agent before the Tailscale interface is ready after a
# reboot or GUI login. Keep the process alive and wait instead of entering a
# fast crash/restart loop because uvicorn cannot bind the private address yet.
while true; do
  TAILSCALE_IP="$("${TAILSCALE_BIN}" ip -4 2>/dev/null | awk '/^100\./ { print; exit }')"
  if [[ "${TAILSCALE_IP}" =~ '^100\.' ]]; then
    break
  fi
  sleep 2
done

exec "${PYTHON_BIN}" -m uvicorn main:app \
  --app-dir "${INSTALL_DIR}" \
  --host "${TAILSCALE_IP}" \
  --port 8765 \
  --no-access-log
