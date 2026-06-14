import { Provider } from "@/provider/provider"
import { NamedError } from "@cody/core/util/error"
import { NotFoundError } from "@/storage/storage"
import { Session } from "@/session/session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import * as Log from "@cody/core/util/log"
import { Flag } from "@cody/core/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"
import * as ServerBackend from "./backend"
import { isAllowedCorsOrigin, type CorsOptions } from "./cors"
import { isPtyConnectPath, PTY_CONNECT_TICKET_QUERY } from "./shared/pty-ticket"
import { isPublicUIPath } from "./shared/public-ui"
import * as Jwt from "./auth/jwt"
import { serverAuthRequired } from "./auth/mode"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  const message = err instanceof Error && err.stack ? err.stack : err.toString()
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}

export const AuthMiddleware: MiddlewareHandler = async (c, next) => {
  // Allow CORS preflight requests to succeed without auth.
  // Browser clients sending Authorization headers will preflight with OPTIONS.
  if (c.req.method === "OPTIONS") return next()

  // This compatibility header is accepted only by explicitly local servers.
  // Remote clients can forge headers, so server mode never treats it as proof
  // that a request originated from the local CLI.
  if (!serverAuthRequired() && c.req.header("x-cody-cli-local")) return next()

  // Public auth endpoints — the web client needs status before it has a token.
  if (c.req.method === "GET" && c.req.path === "/api/auth/status") return next()
  if (c.req.method === "POST" && (c.req.path === "/api/auth/login" || c.req.path.startsWith("/api/auth/register")))
    return next()

  const accountAuthRequired = serverAuthRequired()

  // Skip auth only when neither legacy server auth nor WebUI account auth is configured.
  const password = Flag.CODY_SERVER_PASSWORD
  const jwtSecret = Flag.CODY_JWT_SECRET
  if (!password && !jwtSecret && !accountAuthRequired) {
    console.log(`[codyx] Auth disabled: no CODY_SERVER_PASSWORD, CODY_JWT_SECRET, or WebUI users configured`)
    return next()
  }

  // Public UI assets
  if (isPublicUIPath(c.req.method, c.req.path)) return next()
  if (c.req.method === "POST" && c.req.path === "/global/git-check") return next()
  if (isPtyConnectPath(c.req.path) && c.req.query(PTY_CONNECT_TICKET_QUERY)) return next()

  // Check for JWT Bearer token as alternative to Basic Auth
  const authHeader = c.req.header("Authorization")
  if (authHeader?.startsWith("Bearer ")) {
    try {
      Jwt.verify(authHeader.slice(7))
      return next()
    } catch {
      // Invalid JWT — fall through to Basic Auth
    }
  }

  if (accountAuthRequired) {
    return c.json({ error: "Authentication required" }, 401)
  }

  const username = Flag.CODY_SERVER_USERNAME ?? "codyx"

  if (c.req.query("auth_token")) c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)

  // If a password is set, strictly enforce Basic Auth
  if (password) {
    return basicAuth({ username, password })(c, next)
  }

  // If no password is set, allow the request to proceed (handlers will check JWT/UserRef if needed)
  return next()
}

export function LoggerMiddleware(backendAttributes: ServerBackend.Attributes): MiddlewareHandler {
  return async (c, next) => {
    const skip = c.req.path === "/log"
    if (skip) return next()
    const attributes = {
      method: c.req.method,
      path: c.req.path,
      // If this logger grows full-URL fields, redact auth_token and ticket query params.
      ...backendAttributes,
    }
    log.info("request", attributes)
    const timer = log.time("request", attributes)
    await next()
    timer.stop()
  }
}

export function CorsMiddleware(opts?: CorsOptions): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (isAllowedCorsOrigin(input, opts)) return input
    },
  })
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const path = c.req.path
  const method = c.req.method
  if (path === "/event" || path === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(path)) return next()
  return zipped(c, next)
}
