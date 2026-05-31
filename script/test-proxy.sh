#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="${1:-https://api.cody.ai}"
PROXY_FILE="$ROOT/.env.proxy"

if [ ! -f "$PROXY_FILE" ]; then
  PROXY_FILE="$ROOT/.env"
fi
if [ ! -f "$PROXY_FILE" ]; then
  echo "[error] No proxy config found. Create .env.proxy from .env.proxy.example." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$PROXY_FILE"
set +a

PROXY="${HTTPS_PROXY:-${HTTP_PROXY:-}}"
if [ -z "$PROXY" ]; then
  echo "[error] HTTPS_PROXY or HTTP_PROXY is required in $PROXY_FILE." >&2
  exit 1
fi

if [[ "${NO_PROXY:-}" == *localhost* && "${NO_PROXY:-}" == *127.0.0.1* ]]; then
  echo "[ok] NO_PROXY includes localhost and 127.0.0.1"
else
  echo "[warn] NO_PROXY should include localhost and 127.0.0.1"
fi

curl -fsSI --proxy "$PROXY" "$URL" >/dev/null
echo "[ok] Request through proxy succeeded: $URL"
