#!/usr/bin/env bash
# dev-server-with-opencode-creds.sh
#
# Launch the OpenWork dev server pre-configured to talk to an already-running
# OpenCode engine (typically the one OpenWork.app spawns, or the desktop
# sidecar). Extracts OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD from
# the live process env so you don't have to copy them by hand, and wires the
# standard OPENWORK_OPENCODE_BASE_URL / OPENWORK_OPENCODE_USERNAME /
# OPENWORK_OPENCODE_PASSWORD env the server reads at boot.
#
# Usage:
#   ./scripts/dev-server-with-opencode-creds.sh                # auto-pick first opencode
#   ./scripts/dev-server-with-opencode-creds.sh 65309          # pin to a specific port
#   PORT=18001 ./scripts/dev-server-with-opencode-creds.sh 65309
#
# After it starts, the scheduled-task dialog's "Model" dropdown will list
# every (providerID, modelID) the connected engine has loaded.
set -euo pipefail

PORT="${1:-}"
case "${PORT}" in
  "" )
    PID=$(pgrep -f "opencode-aarch64-apple-darwin serve" | head -1 || true)
    ;;
  * )
    PID=$(pgrep -f "opencode-aarch64-apple-darwin serve --hostname 127.0.0.1 --port ${PORT}" | head -1 || true)
    ;;
esac

if [[ -z "${PID}" ]]; then
  echo "No OpenCode sidecar process found. Open OpenWork.app first, or pass a port as the first argument." >&2
  exit 1
fi

USERNAME=$(ps -p "${PID}" -E -ww 2>/dev/null | tr ' ' '\n' | grep "^OPENCODE_SERVER_USERNAME=" | sed 's/^OPENCODE_SERVER_USERNAME=//' | head -1)
PASSWORD=$(ps -p "${PID}" -E -ww 2>/dev/null | tr ' ' '\n' | grep "^OPENCODE_SERVER_PASSWORD=" | sed 's/^OPENCODE_SERVER_PASSWORD=//' | head -1)
ENGINE_PORT=$(ps -p "${PID}" -o args= 2>/dev/null | tr ' ' '\n' | grep -A1 "^--port" | tail -1 | tr -d ' ')

# Fallback: scan the full env line for --port N (BSD `ps -o command=` truncates)
if [[ -z "${ENGINE_PORT}" ]]; then
  ENGINE_PORT=$(ps -p "${PID}" -E -ww 2>/dev/null | tr ' ' '\n' | grep "^--port" | head -1 | sed 's/^--port=//;s/^--port //')
fi

if [[ -z "${USERNAME}" || -z "${PASSWORD}" || -z "${ENGINE_PORT}" ]]; then
  echo "OpenCode PID ${PID} is missing OPENCODE_SERVER_USERNAME / _PASSWORD env or --port flag." >&2
  exit 1
fi

echo "Using OpenCode sidecar PID=${PID} port=${ENGINE_PORT} (creds from process env)"

export OPENWORK_DEV_MODE=1
export OPENWORK_OPENCODE_BASE_URL="http://127.0.0.1:${ENGINE_PORT}"
export OPENWORK_OPENCODE_USERNAME="${USERNAME}"
export OPENWORK_OPENCODE_PASSWORD="${PASSWORD}"
export OPENWORK_TOKEN="${OPENWORK_TOKEN:-dev-server-$(date +%s)}"

# Inherit the rest of the dev env if the user already has it set
exec bun --cwd "$(dirname "$0")/../apps/server" src/cli.ts
