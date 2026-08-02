#!/usr/bin/env bash
# Launch fpt-proxy on localhost:8789 and print connection details.
#
# Usage:
#   FPT_API_KEY=sk-... ./scripts/fpt-proxy/start.sh
#
# Then in OpenWork Settings → Environment:
#   FPT_API_KEY: <unchanged>
#   FPT_CONFIG : {"baseURL":"http://127.0.0.1:8789/v1"}
set -euo pipefail

PORT="${FPT_PROXY_PORT:-8789}"
DB="${FPT_PROXY_DB:-$(cd "$(dirname "$0")" && pwd)/proxy.db}"
RPM="${FPT_PROXY_RPM:-30}"
TPM="${FPT_PROXY_TPM:-200000}"
BURST="${FPT_PROXY_BURST:-5}"

if [[ -z "${FPT_API_KEY:-}" ]]; then
  echo "ERROR: FPT_API_KEY env var is required" >&2
  exit 1
fi

# Remove stale db only if explicitly asked
if [[ "${FPT_PROXY_RESET:-0}" == "1" && -f "$DB" ]]; then
  rm -f "$DB"
  echo "[fpt-proxy] reset db: $DB"
fi

cd "$(cd "$(dirname "$0")/../.." && pwd)"

export FPT_UPSTREAM="${FPT_UPSTREAM:-https://mkp-api.fptcloud.com}"
export FPT_PROXY_PORT="$PORT"
export FPT_PROXY_DB="$DB"
export FPT_PROXY_RPM="$RPM"
export FPT_PROXY_TPM="$TPM"
export FPT_PROXY_BURST="$BURST"

echo "[fpt-proxy] port=$PORT db=$DB rpm=$RPM tpm=$TPM upstream=$FPT_UPSTREAM"
echo "[fpt-proxy] dashboard: http://127.0.0.1:$PORT/__dashboard"
echo "[fpt-proxy] point FPT_CONFIG at: {\"baseURL\":\"http://127.0.0.1:$PORT/v1\"}"
echo

exec bun scripts/fpt-proxy/server.ts
