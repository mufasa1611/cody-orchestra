# cody-x — Todo List & Roadmap

## Overview
Make a fully standalone cody-x instance that:
- Works locally on Windows with unique identity and branding
- Coexists with cody_pro (same machine, different port/data dirs)
- Deploys to the Proxmox server for public access via cloudflared
- Supports 5 concurrent users with isolated sessions via login + per-user session scoping

---

## Phase 1 — NOW: Local Windows cody-x

| Item | Status | Notes |
|------|--------|-------|
| XDG data isolation (separate dirs from cody_pro) | ✅ Done | XDG_DATA_HOME=%LOCALAPPDATA%\cody-x in cody-x.cmd |
| Unique port 4097 | ✅ Done | --port 4097 in all launch commands |
| Proxy env loading from .env.proxy | ✅ Done | for /f parsing in cody-x.cmd |
| Cloudflare tunnel auto-start in launcher | ✅ Done | Starts cloudflared access tcp if not listening |
| "cody-x" branding everywhere | ✅ Done | 13 expressions in 8 source files check CODY_X env var |
| Provider name fix (cody → opencode) | ✅ Done | provider.ts:160 |
| BOM stripping (root package.json, vite.config.ts) | ✅ Done | PostCSS build failure fixed |
| Global cody-x command from any terminal | ✅ Done | Forwarder at %USERPROFILE%\.bun\bin\cody-x.cmd |
| Sleep guard (keep awake during PTY sessions) | ✅ Done | Cross-platform child-process-based |
| System path protection works in full mode | ✅ Done | All permission prompt sources checked |
| Side-by-side parity test with cody_pro | ✅ Done | Both serve models via proxy (HTTP 200) |

---

## Phase 2 — DEPLOY cody-x to Proxmox (public access)

**Goal**: Run cody-x as a systemd service on ct101, reachable via cloudflared.

| Step | Status | Details |
|------|--------|---------|
| 2a. Sync repo to server | 🔲 Todo | Clone or pull onto ct101. Which branch? |
| 2b. Create systemd service | 🔲 Todo | /etc/systemd/system/cody-x.service |
| 2c. Choose port | 🔲 Todo | 4097 or 3002? |
| 2d. cloudflared DNS config | 🔲 Todo | Tunnel config for subdomain |
| 2e. Verify public access | 🔲 Todo | curl from internet returns "cody-x" |

**Notes**: No reverse proxy — cloudflared tunnels directly to app port.

---

## Phase 3 — MULTI-USER: 5 users with isolated sessions

**Goal**: 5 named users can log into the web UI. Each sees only their own sessions. No registration or email. Proxy unchanged.

### Architecture
Browser → cloudflared → cody-x → auth middleware → per-user session filtering

- **Auth**: Replace single Basic Auth with per-user login. Keep Basic Auth fallback for CLI/API.
- **Sessions**: Add user_id column to session table. Queries filter by user_id.
- **Web UI**: Login page. JWT token on auth. Token sent with all API calls.
- **Proxy**: Unchanged (TCP-level, auth is HTTP-level).

### Step-by-step

| Step | What | Effort |
|------|------|--------|
| 3a. Users table schema | Drizzle: users(id, username unique, password_hash, created_at). Run migration. | Small |
| 3b. Auth service | Effect service: register, verifyPassword, getUser, listUsers. bcrypt. | Small |
| 3c. Login API | POST /api/auth/login → JWT. POST /api/auth/logout. GET /api/auth/me. POST /api/auth/change-password. | Medium |
| 3d. Auth middleware | Check Bearer JWT. Fallback to Basic Auth vs users table. CODY_MASTER_PASSWORD bypass. | Medium |
| 3e. JWT module | Sign/verify JWTs. Secret from CODY_JWT_SECRET env var (auto-gen). 24h expiry + refresh. | Small |
| 3f. Login UI page | SolidJS login form. Store token in localStorage or httpOnly cookie. | Small |
| 3g. Auth guard in App | No token → show Login. Logout → clear token → Login. | Small |
| 3h. user_id on sessions | Add column. Run migration. | Small |
| 3i. Scoped session queries | list() filters by user_id. create() sets user_id. CRUD checks ownership. | Medium |
| 3j. Admin CLI | cody-x users create/list/reset-password/delete | Small |
| 3k. First-run setup | Auto-create admin from CODY_ADMIN_USERNAME/PASSWORD on empty DB. | Small |
| 3l. Seed 5 users | script/seed-users.ts — create 5 accounts, print passwords. | Tiny |

### Unchanged components
Cloudflared tunnel, Session sync, Project scope (x-cody-directory), Provider auth, SQLite DB, PTY/tools.

### Risks
- CODY_SERVER_PASSWORD users break → keep as master bypass
- JWT secret lost → store in XDG config dir
- Token XSS → use httpOnly cookie + short expiry + refresh
- Proxy unaffected (TCP-level)

---

## Phase 4 — FUTURE
Admin panel, Rate limiting, Quotas, WebSocket collab, Monitoring, Public registration.

---

## Open Decisions
1. Deploy: same LXC as cody-pro or separate?
2. Token storage: httpOnly cookie vs localStorage?
3. CODY_SERVER_PASSWORD: keep as bypass or remove?
4. Priority: deploy or multi-user first?
