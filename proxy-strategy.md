# Cody Orchestra: Autonomous Proxy Strategy Report
This document outlines the architecture, implementation, and strategy of the multi-layered proxy rotation system built into Cody Orchestra.

## 1. Architecture Overview

The system is designed to provide seamless, autonomous IP rotation to bypass provider rate limits (specifically for free tiers like OpenCode Zen). It consists of three primary layers working in a closed loop:

1. The Application (Container - CT 105): Detects 429 errors and triggers rotation.
2. The Proxy Gateway (Host - Servo): Handles all outbound traffic and manages the circuit state.
3. The Tor Pool (Host - Servo): Provides 4 independent anonymous identities.

## 2. Request Lifecycle & Rotation Flow

1. Request Initiation: The Agent makes an HTTPS request to a model provider.
2. Proxy Routing: The request is routed to http://192.168.68.68:8888 based on environment variables.
3. Error Detection: If the provider returns a 429 Rate Limit, the Agent intercepts this instantly in the code.
4. Rotation Signal: The Agent fires a background HTTP request to the host: http://192.168.68.68:8888/__cody_proxy/rotate.
5. State Switch: The Proxy instantly updates its internal currentState to the next healthy circuit (Direct -> Tor 1 -> Tor 2 -> Tor 3 -> Tor 4).
6. Identity Refresh: The Proxy sends a SIGNAL NEWNYM to the discarded Tor instance to prepare a fresh IP for its next use.
7. Auto-Retry: The Agent automatically retries the request (up to 5 times), traversing the new IP circuit immediately.

## 3. Key File Map & Critical Logic

### A. The Controller (Application Layer)
Path: packages/codyx/src/provider/proxy-control.ts
Line 58: Forces rotation on every 429 error.
Line 99: Sends the rotation command to the host.

### B. The Engine (Proxy Layer)
Path: packages/codyx/src/cli/cmd/proxy.ts
Line 13: Defines the circuit pool (Direct + 4 Tor nodes).
Line 134: The rotation state machine.
Line 172: SOCKS5 Handshake State Machine (Crucial for TOR stability).

### C. The Executor (Retry Logic)
Path: packages/codyx/src/provider/provider.ts
Line 28: Sets max retries to 5.

### D. The Lean Entry Point
Path: packages/codyx/src/proxy-entry.ts
Ensures the proxy service on the host is lightweight and doesn't trigger agent logic.

## 4. Environment Configuration
File: .env.proxy

HTTP_PROXY=http://192.168.68.68:8888
HTTPS_PROXY=http://192.168.68.68:8888
NO_PROXY=localhost,127.0.0.1,cody.internal

## 5. Deployment Strategy (Proxmox)

Host Service (cody-proxy.service)
- Port: 8888
- Target: proxy-entry.ts

Container Service (cody-orchestra.service)
- Port: 4097
- Auth: Isolated per-user registration mode.

## 6. Autonomous Health Monitoring
The system is now Health-Aware. Each circuit tracks its own successes and failures. If a Tor node becomes slow or blocked, it is marked as Unhealthy and placed on a 60-second cooldown, forcing the rotator to skip it.

---
Report Generated: June 6, 2026
Status: Operational & Synchronized
