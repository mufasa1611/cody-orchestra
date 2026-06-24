import * as Log from "@cody/core/util/log"

const log = Log.create({ service: "proxy-control" })

const RETRYABLE_STATUS = new Set([429, 502, 503, 504])
const CONTROL_TIMEOUT_MS = 2_000

function proxyBaseURL() {
  const explicit = process.env.CODY_PROXY_CONTROL_URL
  if (explicit) return explicit.replace(/\/+$/, "")

  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  if (!proxy) return

  try {
    const url = new URL(proxy)
    url.username = ""
    url.password = ""
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return
  }
}

function controlHeaders(): HeadersInit | undefined {
  const token = process.env.CODY_PROXY_TOKEN
  return token ? { "x-cody-proxy-token": token } : undefined
}

export function retryableStatus(status: number) {
  return RETRYABLE_STATUS.has(status)
}

export async function usageLimitResponse(response: Response) {
  if (response.status !== 429) return false
  
  const retryAfter = response.headers.get("retry-after")
  const rateLimitRemaining = response.headers.get("x-ratelimit-remaining")
  if (rateLimitRemaining === "0") return true
  if (retryAfter) return true
  
  const body = await response.clone().text().catch(() => "")
  return (
    body.includes("FreeUsageLimitError") ||
    body.includes("GoUsageLimitError") ||
    body.includes("rate limit") ||
    body.includes("rate_limit") ||
    body.includes("rateLimit") ||
    body.includes("too many") ||
    body.includes("quota") ||
    body.includes("exceeded") ||
    body.includes("retry after") ||
    body.includes("try again")
  )
}

export function retryableError(error: unknown) {
  const any = error as { name?: string; code?: string; message?: string; cause?: { code?: string } }
  const text = `${any.name ?? ""} ${any.code ?? ""} ${any.cause?.code ?? ""} ${any.message ?? ""}`.toLowerCase()
  return (
    text.includes("abort") ||
    text.includes("timeout") ||
    text.includes("timedout") ||
    text.includes("econnreset") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("network") ||
    text.includes("connection") ||
    text.includes("socket") ||
    text.includes("unable to connect")
  )
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...controlHeaders(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`proxy control returned ${res.status}`)
  return res
}

export async function rotate(reason: string, metadata?: Record<string, unknown>) {
  const base = proxyBaseURL()
  if (!base) return false

  const body = { reason, ...metadata }
  try {
    await post(`${base}/__cody_proxy/rotate?reason=${encodeURIComponent(reason)}`, body)
    log.warn("proxy rotated", { reason, base, ...metadata })
    return true
  } catch (error) {
    try {
      await fetch(`${base}/__cody_rotate`, {
        method: "POST",
        headers: controlHeaders(),
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      })
      log.warn("proxy rotated via legacy endpoint", { reason, base, ...metadata })
      return true
    } catch (fallbackError) {
      log.warn("proxy rotate failed", {
        reason,
        base,
        error: error instanceof Error ? error.message : String(error),
        fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      })
      return false
    }
  }
}

export async function direct(reason: string, metadata?: Record<string, unknown>) {
  const base = proxyBaseURL()
  if (!base) return false

  try {
    await post(`${base}/__cody_proxy/direct?reason=${encodeURIComponent(reason)}`, { reason, ...metadata })
    log.warn("proxy switched to direct", { reason, base, ...metadata })
    return true
  } catch (error) {
    log.warn("proxy direct switch failed", {
      reason,
      base,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function usageLimitNext(reason: string, metadata?: Record<string, unknown>) {
  const base = proxyBaseURL()
  if (!base) return false

  try {
    const res = await post(`${base}/__cody_proxy/usage-limit-next?reason=${encodeURIComponent(reason)}`, {
      reason,
      ...metadata,
    })
    const body = (await res.json().catch(() => undefined)) as { exhausted?: unknown } | undefined
    const moved = body?.exhausted === false
    log.warn(moved ? "proxy advanced after usage limit" : "proxy usage-limit routes exhausted", {
      reason,
      base,
      ...metadata,
    })
    return moved
  } catch (error) {
    log.warn("proxy usage-limit advance failed", {
      reason,
      base,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
