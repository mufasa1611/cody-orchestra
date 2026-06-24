#!/bin/bash
echo "=== Smart Proxy Rotator Status ==="
echo ""
echo "Proxy Service:"
if curl -fsSL -o /dev/null --max-time 5 "http://localhost:8888/__cody_proxy/rotate?reason=status" 2>/dev/null; then
  echo "  ✅ RUNNING (port 8888)"
else
  echo "  ❌ NOT RUNNING"
fi

echo ""
echo "TOR Circuits:"
for i in 0 1 2 3; do
  SOCKS_PORT=$((9050 + i * 2))
  if ss -tlnp 2>/dev/null | grep -q ":$SOCKS_PORT\s"; then
    echo "  TOR-$i (port $SOCKS_PORT): ✅"
  else
    echo "  TOR-$i (port $SOCKS_PORT): ❌"
  fi
done

echo ""
echo "Web Service:"
if curl -fsSL -o /dev/null --max-time 5 "http://localhost:4097" 2>/dev/null; then
  echo "  ✅ RUNNING (port 4097)"
else
  echo "  ❌ NOT RUNNING"
fi

echo ""
echo "Active Routes:"
if curl -fsSL --max-time 5 "http://localhost:8888/__cody_proxy/rotate?reason=status" 2>/dev/null; then
  echo "  (see above)"
fi
