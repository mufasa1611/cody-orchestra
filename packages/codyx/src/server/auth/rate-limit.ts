import type { MiddlewareHandler } from "hono"

const attempts = new Map<string, { count: number; resetAt: number }>()

let cleanupInterval: ReturnType<typeof setInterval> | undefined

function startCleanup() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of attempts) {
      if (entry.resetAt < now) attempts.delete(key)
    }
  }, 60_000)
}

export function rateLimit(maxAttempts: number, windowMs: number): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
    const now = Date.now()
    const key = `${ip}:${c.req.path}`

    const entry = attempts.get(key)
    if (entry && entry.resetAt > now) {
      if (entry.count >= maxAttempts) {
        return c.json({ error: "Too many attempts. Try again later." }, 429)
      }
      entry.count++
    } else {
      attempts.set(key, { count: 1, resetAt: now + windowMs })
    }

    startCleanup()
    return next()
  }
}
