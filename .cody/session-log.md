# Session Log

Read at start of every session. Update after completing tasks.
Survives conversation compaction.

**Repo root: `X:\cody-x`**

---

## Active Tasks

| Task | Status | Notes |
|------|--------|-------|
| Fix auth routes on running server | **DONE** | Both backends handle auth: `createHono()` registers AuthRoutes at `/api/auth`; Effect backend has `authRoute` in `createRoutes()` wrapping AuthRoutes. Registered before UI catch-all on both backends. |
| Verify UserRef / user_id wiring in session isolation | **DONE** | Fully wired: `authorization.ts:105` provides `UserRef` from JWT sub on Effect backend; `session.ts:97` provides it on Hono backend. Session core uses `UserRef` to filter by `user_id` column. |
| Write auth endpoint integration tests | pending | |

## Completed Tasks

| Task | Date | Notes |
|------|------|-------|
| Session log system | 2026-06-04 | Created `.cody/session-log.md` |
| Auth commits | prev | Service, JWT, routes, middleware, login UI |
| Auth route analysis | 2026-06-04 | Verified both backends have auth routes. Found `authRoute` in httpapi/server.ts exists since initial snapshot — wraps AuthRoutes via Hono within Effect router. |
| UserRef verification | 2026-06-04 | Effect backend: `authorization.ts` provides `UserRef` from JWT sub. Hono backend: session.ts extracts JWT from Authorization header. Session core: filters by `user_id` from `UserRef`. |

## Current Goal

_None yet — all auth infrastructure tasks done. Next: integration tests?_
