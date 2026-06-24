#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Check if proxy service is installed but not running
if [ -f "/etc/systemd/system/cody-proxy.service" ]; then
  echo "[info] cody-proxy.service exists but may not be running"
  
  # Check proxy status
  systemctl is-active --quiet cody-proxy.service
  if [ $? -ne 0 ]; then
    echo "[error] cody-proxy.service is not running"
    echo "[info] Starting cody-proxy.service..."
    systemctl start cody-proxy.service
    
    # Wait for service to start
    for i in {1..10}; do
      if systemctl is-active --quiet cody-proxy.service; then
        echo "[ok] cody-proxy.service is now running"
        break
      fi
      sleep 2
    done
  fi
else
  echo "[error] cody-proxy.service not found in /etc/systemd/system/"
  echo "[info] Looking for codyx proxy binary..."
  
  # Check if codyx proxy command exists
  if [ -f "$ROOT/packages/codyx/src/index.ts" ]; then
    echo "[warn] codyx proxy may need to be started manually"
    echo "[info] Running: bun run packages/codyx/src/index.ts proxy"
    # Try to start the proxy
    cd "$ROOT"
    timeout 30 bun run packages/codyx/src/index.ts proxy 2>&1 || true
  fi
fi

# Test proxy endpoint
PROXY_PORT=${CODY_PROXY_PORT:-8888}
TEST_URL="http://localhost:${PROXY_PORT}/__cody_proxy/rotate?reason=test"

echo "[info] Testing proxy endpoint: $TEST_URL"
curl -fsSL -o /dev/null --max-time 5 "$TEST_URL" 2>&1 || echo "[error] Proxy endpoint not responding"

# Check if TOR ports are expected to be running
TOR_PORTS="9050 9051 9052 9053 9054 9055 9056 9057"

echo "[info] Checking TOR proxy ports..."
for port in $TOR_PORTS; do
  if ss -tlnp 2>/dev/null | grep -q ":$port\s"; then
    echo "[ok] TOR proxy port $port is listening"
  else
    echo "[warn] TOR proxy port $port is not listening (expected for this container)"
  fi
done

# Check if proxy environment variables are set
if [ -n "${CODY_PROXY_CONTROL_URL:-}" ]; then
  echo "[ok] CODY_PROXY_CONTROL_URL is set: ${CODY_PROXY_CONTROL_URL}"
else
  echo "[warn] CODY_PROXY_CONTROL_URL is not set"
  echo "[info] Using HTTP_PROXY: ${HTTP_PROXY:-}"
fi

echo "[info] Proxy setup check complete"
