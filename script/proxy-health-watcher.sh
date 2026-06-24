#!/usr/bin/env bash
# Proxy Health Watcher - monitors and auto-recovers circuits
# Run from cron every 2 minutes, or manually for a single check

set -euo pipefail

ROOT="/opt/cody-orchestra"
LOG="$ROOT/proxy-health.log"
PROXY_CTRL="http://localhost:8888"

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG"
}

check_service() {
  if ! systemctl is-active --quiet "$1" 2>/dev/null; then
    log "❌ $1 is dead. Restarting..."
    systemctl restart "$1" 2>>"$LOG" && log "  → $1 restarted"
    return 1
  fi
  return 0
}

recover_tor() {
  local i=$1
  local socks_port=$((9050 + i * 2))
  local ctrl_port=$((9051 + i * 2))
  local service="tor-instance-$i"

  if ! systemctl is-active --quiet "$service" 2>/dev/null; then
    log "  Tor-$i down (port $socks_port). Restarting..."
    systemctl restart "$service" 2>>"$LOG"
    sleep 3
    if ss -tlnp 2>/dev/null | grep -q ":$socks_port\s"; then
      log "  Tor-$i recovered on port $socks_port"
      # Signal new circuit immediately
      echo -e 'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n' | nc -w3 127.0.0.1 "$ctrl_port" 2>/dev/null || true
    fi
    return 1
  fi
  return 0
}

# Phase 1: Check all services are alive
log "=== Health check ==="

PROXY_OK=true
for i in 0 1 2 3; do
  recover_tor "$i" || PROXY_OK=false
done

check_service "cody-proxy" || PROXY_OK=false

# Phase 2: Check proxy responds
if ! curl -fsSL -o /dev/null --max-time 5 "$PROXY_CTRL/__cody_proxy/status?reason=healthwatch" 2>/dev/null; then
  log "❌ Proxy API not responding. Restarting full stack..."
  systemctl restart cody-proxy 2>>"$LOG"
  PROXY_OK=false
fi

# Phase 3: Check route health via API
HEALTH_OUTPUT=$(curl -fsSL --max-time 10 "$PROXY_CTRL/__cody_proxy/status?reason=healthwatch" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
healthy = sum(1 for r in d['routes'] if r['type']=='tor' and r['health']['cooldownUntil']==0 and r['health'].get('lastIP',''))
dead = sum(1 for r in d['routes'] if r['type']=='tor' and r['health']['cooldownUntil']>0)
unknown = sum(1 for r in d['routes'] if r['type']=='tor' and not r['health'].get('lastIP','') and r['health']['cooldownUntil']==0)
print(f'{healthy} healthy, {dead} cooldown, {unknown} bootstrapping')
if dead > 2:
    print('CRITICAL')
    sys.exit(2)
if healthy == 0:
    print('WARNING')
    sys.exit(1)
print('OK')
" 2>/dev/null || echo "PARSE_FAILED") || true

if [ "$HEALTH_OUTPUT" = "PARSE_FAILED" ]; then
  log "❌ Could not parse route health"
else
  echo "$HEALTH_OUTPUT" | while read -r line; do log "$line"; done
  SEVERITY=$(echo "$HEALTH_OUTPUT" | tail -1)
  if [ "$SEVERITY" = "CRITICAL" ]; then
    log "⚠ 3+ TOR circuits in cooldown - force reset"
    curl -s -X POST "$PROXY_CTRL/__cody_proxy/direct?reason=healthwatch-reset" -o /dev/null 2>/dev/null || true
  elif [ "$SEVERITY" = "WARNING" ]; then
    log "⚠ No healthy TOR circuits"
  fi
fi

# Phase 4: Log route state for diagnostics
curl -fsSL --max-time 10 "$PROXY_CTRL/__cody_proxy/rotate?reason=healthwatch" 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d['routes']:
    h=r['health']
    ip=h.get('lastIP','') or ''
    s='COOLDOWN' if h['cooldownUntil']>0 else ('BOOT' if not ip else 'OK')
    print(f'  [{r[\"type\"]:7}] {s:10} IP: {ip:18} OK:{h[\"successes\"]} Fail:{h[\"failures\"]}')
print(f'  Active: {d[\"current\"][\"type\"]}')
" >> "$LOG" 2>/dev/null || echo "  (route data unavailable)" >> "$LOG"

log "=== Done ==="
