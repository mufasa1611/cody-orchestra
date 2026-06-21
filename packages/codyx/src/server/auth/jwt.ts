import { createHmac, randomBytes, timingSafeEqual } from "crypto"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { dirname } from "path"
import { Flag } from "@cody/core/flag/flag"
import { Global } from "@cody/core/global"

export class JwtError extends Error {
  override readonly name = "JwtError"
}

export interface JwtPayload {
  readonly sub: string
  readonly username: string
  readonly iat: number
  readonly exp: number
}

const SECRET_FILE = "codyx-jwt-secret"

const blacklistedTokens = new Set<string>()

let cleanupInterval: ReturnType<typeof setInterval> | undefined

function startCleanup() {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => {
    const before = blacklistedTokens.size
    blacklistedTokens.clear()
    if (before) console.log(`[codyx] Cleared ${before} blacklisted tokens (cleanup cycle)`)
  }, 86_400_000)
}

export function blacklistToken(token: string) {
  blacklistedTokens.add(token)
  startCleanup()
}

export function isBlacklisted(token: string) {
  return blacklistedTokens.has(token)
}

function base64url(input: string): string {
  return Buffer.from(input)
    .toString("base64url")
    .replace(/=+$/, "")
}

function base64urlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8")
}

function getSecretFilePath(): string {
  const configDir = Global.Path.config
  return dirname(configDir) + "/" + SECRET_FILE
}

export function ensureSecret(): string {
  const fromEnv = Flag.CODY_JWT_SECRET
  if (fromEnv) return fromEnv

  const filePath = getSecretFilePath()
  try {
    const stored = readFileSync(filePath, "utf-8").trim()
    if (stored) {
      process.env["CODY_JWT_SECRET"] = stored
      return stored
    }
  } catch {}

  const generated = randomBytes(32).toString("hex")
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, generated, { encoding: "utf-8", mode: 0o600 })
  } catch {}
  process.env["CODY_JWT_SECRET"] = generated
  return generated
}

function getSecret(): string | undefined {
  return Flag.CODY_JWT_SECRET
}

function hmacSign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url")
}

export function sign(payload: { sub: string; username: string; ttlMs?: number }): string {
  ensureSecret()
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
  if (isBlacklisted(token)) throw new JwtError("Token revoked")
  ensureSecret()
  const secret = getSecret()
  if (!secret) throw new JwtError("CODY_JWT_SECRET not set")
  const parts = token.split(".")
  if (parts.length !== 3) throw new JwtError("Invalid token format")
  const [header, body, signature] = parts
  const expected = hmacSign(secret, `${header}.${body}`)
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new JwtError("Invalid token signature")
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(base64urlDecode(body))
  } catch {
    throw new JwtError("Invalid token payload")
  }
  if (parsed.exp && typeof parsed.exp === "number" && parsed.exp * 1000 < Date.now()) {
    throw new JwtError("Token expired")
  }
  if (!parsed.sub || typeof parsed.sub !== "string" || !parsed.username || typeof parsed.username !== "string") {
    throw new JwtError("Invalid token claims")
  }
  return {
    sub: parsed.sub,
    username: parsed.username,
    iat: typeof parsed.iat === "number" ? parsed.iat : 0,
    exp: typeof parsed.exp === "number" ? parsed.exp : 0,
  }
}

export function userIdFromBearer(authHeader: string | undefined): string | undefined {
  if (!authHeader?.startsWith("Bearer ")) return undefined
  try {
    return verify(authHeader.slice(7)).sub
  } catch {
    return undefined
  }
}
