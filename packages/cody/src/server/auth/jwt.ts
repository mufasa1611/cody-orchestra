import { createHmac, timingSafeEqual } from "crypto"
import { Flag } from "@cody/core/flag/flag"

export interface JwtPayload {
  readonly sub: string
  readonly username: string
  readonly iat: number
  readonly exp: number
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64url")
    .replace(/=+$/, "")
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8")
}

function getSecret(): string {
  return Flag.CODY_JWT_SECRET
}

function hmacSign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url")
}

export function sign(payload: { sub: string; username: string; ttlMs?: number }): string {
  const secret = getSecret()
  if (!secret) throw new Error("CODY_JWT_SECRET not set")
  const now = Date.now()
  const exp = now + (payload.ttlMs ?? 86_400_000)
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(
    JSON.stringify({
      sub: payload.sub,
      username: payload.username,
      iat: Math.floor(now / 1000),
      exp: Math.floor(exp / 1000),
    }),
  )
  const signature = hmacSign(secret, `${header}.${body}`)
  return `${header}.${body}.${signature}`
}

export function verify(token: string): JwtPayload {
  const secret = getSecret()
  if (!secret) throw new Error("CODY_JWT_SECRET not set")
  const parts = token.split(".")
  if (parts.length !== 3) throw new Error("Invalid token format")
  const [header, body, signature] = parts
  const expected = hmacSign(secret, `${header}.${body}`)
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new Error("Invalid token signature")
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(base64urlDecode(body))
  } catch {
    throw new Error("Invalid token payload")
  }
  if (parsed.exp && typeof parsed.exp === "number" && parsed.exp * 1000 < Date.now()) {
    throw new Error("Token expired")
  }
  if (!parsed.sub || typeof parsed.sub !== "string" || !parsed.username || typeof parsed.username !== "string") {
    throw new Error("Invalid token claims")
  }
  return {
    sub: parsed.sub,
    username: parsed.username,
    iat: typeof parsed.iat === "number" ? parsed.iat : 0,
    exp: typeof parsed.exp === "number" ? parsed.exp : 0,
  }
}
