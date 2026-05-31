# cody-x — Todo List & Roadmap

## Overview
Make `X:\cody` a fully standalone `cody-x` instance that:
- Works locally on Windows with unique identity and branding
- Coexists with `cody_pro` (same machine, different port/data dirs)
- Deploys to the Proxmox server for public access via cloudflared
- Supports anonymous users with per-user database & registration

---

## Phase 1 — NOW: Local Windows cody-x

| Item | Status | Notes |
|------|--------|-------|
| XDG data isolation (separate dirs from cody_pro) | ✅ Done | `XDG_DATA_HOME=%LOCALAPPDATA%\cody-x`, etc. in `cody-x.cmd` |
| Unique port 4097 | ✅ Done | `--port 4097` in all launch commands |
| Proxy env loading from `.env.proxy` | ✅ Done | `for /f` parsing in `cody-x.cmd` |
| Cloudflare tunnel auto-start in launcher | ✅ Done | Checks port 9999, starts `cloudflared access tcp` if not listening |
| "cody-x" branding everywhere | ✅ Done | 13 expressions in 8 source files check `CODY_X` env var |
| Provider name fix (`cody` → `opencode`) | ✅ Done | `provider.ts:160` — cloud models were silently dropped before the fix |
| BOM stripping (root package.json, vite.config.ts) | ✅ Done | PostCSS build failure fixed |
| Global `cody-x` command from any terminal | ✅ Done | Forwarder at `%USERPROFILE%\.bun\bin\cody-x.cmd` |
| Sleep guard (keep awake during PTY sessions) | ✅ Done | Cross-platform child-process-based, reference-counted |
| System path protection works in full mode | ✅ Done | All permission prompt sources checked, no bypasses |
| Side-by-side parity test with cody_pro | ✅ Done | Both serve models via proxy (HTTP 200), no rate limits |

---

## Phase 2 — DEPLOY cody-x to Proxmox (public access)

**Goal**: Run cody-x as a systemd service on `ct101` (192.168.68.69), reachable via a public domain through cloudflared.

| Step | Status | Details |
|------|--------|---------|
| 2a. Sync repo to server | 🔲 Todo | Clone or pull `X:\cody` onto `ct101`. Which branch/checkout? |
| 2b. Create systemd service | 🔲 Todo | `/etc/systemd/system/cody-x.service` with correct PATH (`/root/.bun/bin`) |
| 2c. Choose port | 🔲 Todo | 4097 (same as local) or 3002 (alongside cody-pro on 3001)? |
| 2d. cloudflared DNS config | 🔲 Todo | New tunnel config for e.g. `cody-x.kingkung.men` → `http://192.168.68.69:<port>` |
| 2e. Verify public access | 🔲 Todo | curl from internet returns "cody-x" branding |

**Notes**:
- Server has no reverse proxy (no nginx), no Docker — cloudflared tunnels directly to the app port.
- If cody-x and cody-pro coexist on the same LXC, they need different ports and different `CODY_DB`/`XDG_DATA_HOME` values.

---

## Phase 3 — MULTI-TENANT: User registration & per-user databases

**Goal**: Anonymous visitors to the web UI must register (username + password + email) to get isolated workspaces.

| Step | Status | Details | Effort |
|------|--------|---------|--------|
| 3a. Auth schema & DB | 🔲 Todo | `users` table (id, username, email, password_hash, created_at). Add `user_id` FK to existing tables, or use per-user SQLite files. | Medium |
| 3b. Auth API | 🔲 Todo | Register (POST /api/auth/register), Login (POST /api/auth/login), Session token (JWT or signed cookie), Logout | Medium |
| 3c. Password recovery | 🔲 Todo | Forgot-password endpoint → email → time-limited reset token → change-password form | Medium |
| 3d. Email service integration | 🔲 Todo | Check Proxmox server for existing Mailgun code (none found in cody repo). Integrate Mailgun/Resend/SendGrid if none exists. | Small (if existing) / Medium (new) |
| 3e. Web UI popup | 🔲 Todo | Login/register modal on page load for unauthenticated users. Simple React form (username, email, password). | Small |
| 3f. Per-user data isolation | 🔲 Todo | Filter all queries (conversations, sessions, settings) by `user_id`. Each user sees only their own data. | Medium |

**DB approach — decision needed**:
- **Option A**: Shared SQLite with `user_id` column on every table. Standard, admin-friendly, but schema migration needed.
- **Option B**: Per-user SQLite files (`users/{user_id}/cody-x.db`). Naturally isolated, but harder to administer/backup.

---

## Phase 4 — FUTURE

| Item | Trigger |
|------|---------|
| Admin panel (user mgmt, usage stats) | After Phase 3 stable |
| Rate limiting per user / IP | After Phase 3 stable |
| Usage quotas (free vs paid tiers) | When scaling |
| WebSocket for real-time collaboration | If needed |
| Monitoring / alerting (health endpoint) | After public launch |

---

## Open Decisions Needed

1. **Phase 2 — Proxmox deployment**: Same LXC as cody-pro (ct101, new port) or separate LXC? Same cloudflared tunnel or subdomain like `cody-x.kingkung.men`?
2. **Phase 3 — DB approach**: Shared SQLite with `user_id` or per-user SQLite files?
3. **Phase 3 — Email**: Is there Mailgun/email code on the Proxmox server already, or build from scratch?
4. **Priority**: Phase 2 (deploy to server) or Phase 3 (multi-user) first?
