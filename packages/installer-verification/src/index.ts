import { Hono } from "hono"
import { z } from "zod"
import { keyedHash, generateCode, signReceipt, timingSafeEqual, verifyReceipt } from "./crypto"
import { cleanup, ensureSchema } from "./db"
import { sendAdminRegistrationNotification, sendAdminUninstallNotification, sendVerificationEmail } from "./email"
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  RECEIPT_TTL_MS,
  RESEND_DELAY_MS,
  RETENTION_MS,
  SEND_WINDOW_MS,
  canResend,
} from "./policy"
import { privacyPage } from "./privacy"
import type { Bindings, ChallengeRow } from "./types"

const app = new Hono<{ Bindings: Bindings }>()
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
const challengeSchema = z.object({
  install_id: z.string().uuid(),
  display_name: z.string().trim().min(2).max(100),
  email: emailSchema,
  installer_version: z.string().trim().min(1).max(64),
  platform: z.literal("windows"),
})
const verifySchema = z.object({ code: z.string().regex(/^\d{6}$/) })
const receiptSchema = z.object({
  install_id: z.string().uuid(),
  receipt: z.string().min(1).max(2048),
  installer_version: z.string().trim().min(1).max(64).optional(),
  platform: z.literal("windows").optional(),
})
const commandActionSchema = z.object({
  install_id: z.string().uuid(),
  receipt: z.string().min(1).max(2048),
  command_id: z.string().uuid(),
})

class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 429 | 500 | 502 | 503,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

function secrets(env: Bindings) {
  return {
    receipt: env.INSTALLER_RECEIPT_SECRET,
    otp: env.INSTALLER_OTP_PEPPER,
    admin: env.INSTALLER_ADMIN_SECRET,
    mailgunSendingKey: env.INSTALLER_MAILGUN_SENDING_KEY,
  }
}

async function jsonBody(request: Request) {
  try {
    return await request.json()
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.")
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value)
  if (!result.success) throw new ApiError(400, "invalid_request", "Request fields are invalid.")
  return result.data
}

function clientKey(request: Request) {
  return request.headers.get("CF-Connecting-IP") ?? "local"
}

async function applyIpRateLimit(env: Bindings, request: Request) {
  const now = Date.now()
  const hash = await keyedHash(secrets(env).otp, `ip:${clientKey(request)}`)
  const result = await env.InstallerVerificationDatabase.prepare(
    `INSERT INTO request_event (id, client_hash, created_at)
     SELECT ?, ?, ?
     WHERE (
       SELECT COUNT(*) FROM request_event WHERE client_hash = ? AND created_at >= ?
     ) < 10`,
  )
    .bind(crypto.randomUUID(), hash, now, hash, now - 60_000)
    .run()
  if (result.meta.changes === 0) throw new ApiError(429, "rate_limited", "Too many requests. Try again shortly.", 60)
}

async function emailHash(env: Bindings, email: string) {
  return keyedHash(secrets(env).otp, email)
}

async function reserveEmailSend(db: D1Database, hash: string, now: number) {
  const id = crypto.randomUUID()
  const result = await db
    .prepare(
      `INSERT INTO send_event (id, email_hash, created_at)
       SELECT ?, ?, ?
       WHERE (
         SELECT COUNT(*) FROM send_event WHERE email_hash = ? AND created_at >= ?
       ) < ?`,
    )
    .bind(id, hash, now, hash, now - SEND_WINDOW_MS, MAX_SENDS_PER_WINDOW)
    .run()
  if (result.meta.changes === 0)
    throw new ApiError(429, "email_rate_limited", "Too many codes were sent to this email. Try again later.", 3600)
  return id
}

async function deliverCode(env: Bindings, input: { email: string; displayName: string; code: string }) {
  if (env.INSTALLER_ENVIRONMENT === "test" && env.INSTALLER_TEST_CODE) return
  const value = secrets(env)
  await sendVerificationEmail({
    apiBase: env.INSTALLER_MAILGUN_API_BASE,
    domain: env.INSTALLER_MAILGUN_DOMAIN,
    sendingKey: value.mailgunSendingKey,
    sender: env.INSTALLER_SENDER,
    ...input,
  })
}

function notifyAdmin(
  env: Bindings,
  input: {
    userEmail: string
    displayName: string
    installId: string
    installerVersion: string
    platform: string
    verifiedAt: string
  },
) {
  const adminEmail = env.INSTALLER_ADMIN_EMAIL
  if (!adminEmail) return Promise.resolve()
  const value = secrets(env)
  return sendAdminRegistrationNotification({
    apiBase: env.INSTALLER_MAILGUN_API_BASE,
    domain: env.INSTALLER_MAILGUN_DOMAIN,
    sendingKey: value.mailgunSendingKey,
    sender: env.INSTALLER_SENDER,
    adminEmail,
    ...input,
  }).catch(() => {
    console.warn(JSON.stringify({ status: 502, error: "admin_notification_failed" }))
  })
}

async function notifyAdminUninstallComplete(env: Bindings, installId: string, commandId: string) {
  const adminEmail = env.INSTALLER_ADMIN_EMAIL
  if (!adminEmail) return
  const db = env.InstallerVerificationDatabase
  const registration = await db
    .prepare("SELECT email, display_name FROM registration WHERE install_id = ?")
    .bind(installId)
    .first<{ email: string; display_name: string }>()
  if (!registration) return
  const value = secrets(env)
  return sendAdminUninstallNotification({
    apiBase: env.INSTALLER_MAILGUN_API_BASE,
    domain: env.INSTALLER_MAILGUN_DOMAIN,
    sendingKey: value.mailgunSendingKey,
    sender: env.INSTALLER_SENDER,
    adminEmail,
    userEmail: registration.email,
    displayName: registration.display_name,
    installId,
    commandId,
  }).catch(() => {
    console.warn(JSON.stringify({ status: 502, error: "uninstall_admin_notification_failed" }))
  })
}

async function challenge(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM challenge WHERE id = ?").bind(id).first<ChallengeRow>()
  if (!row) throw new ApiError(404, "challenge_not_found", "Verification request was not found.")
  return row
}

async function requireAdmin(env: Bindings, request: Request) {
  const authorization = request.headers.get("Authorization")
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""
  const value = secrets(env)
  if (!token || !(await timingSafeEqual(value.otp, token, value.admin)))
    throw new ApiError(401, "unauthorized", "A valid administrator token is required.")
}

async function verifyReceiptPayload(env: Bindings, installId: string, receipt: string) {
  const payload = await verifyReceipt(secrets(env).receipt, receipt)
  if (!payload || payload.install_id !== installId || payload.expires_at <= Date.now())
    throw new ApiError(401, "invalid_receipt", "Receipt is invalid or expired.")
  return payload
}

function csvCell(value: unknown) {
  const serialized =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : ""
  return `"${serialized.replaceAll('"', '""')}"`
}

app.use("*", async (context, next) => {
  await ensureSchema(context.env.InstallerVerificationDatabase)
  await next()
})

app.get("/health", (context) => context.json({ healthy: true, environment: context.env.INSTALLER_ENVIRONMENT }))

app.get("/privacy", (context) =>
  context.html(privacyPage(context.env.INSTALLER_PRIVACY_EMAIL), 200, {
    "Cache-Control": "public, max-age=3600",
  }),
)

app.post("/v1/challenges", async (context) => {
  await applyIpRateLimit(context.env, context.req.raw)
  const input = parse(challengeSchema, await jsonBody(context.req.raw))
  const db = context.env.InstallerVerificationDatabase
  const now = Date.now()
  const id = crypto.randomUUID()
  const code = context.env.INSTALLER_TEST_CODE ?? generateCode()
  const hash = await emailHash(context.env, input.email)
  const sendEventId = await reserveEmailSend(db, hash, now)
  await db
    .prepare(
      `INSERT INTO challenge
        (id, install_id, display_name, email, email_hash, code_hash, installer_version, platform,
         attempts, created_at, last_sent_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.install_id,
      input.display_name,
      input.email,
      hash,
      await keyedHash(secrets(context.env).otp, `${id}:${code}`),
      input.installer_version,
      input.platform,
      now,
      now,
      now + CODE_TTL_MS,
    )
    .run()
  try {
    await deliverCode(context.env, {
      email: input.email,
      displayName: input.display_name,
      code,
    })
  } catch {
    await db.batch([
      db.prepare("DELETE FROM challenge WHERE id = ?").bind(id),
      db.prepare("DELETE FROM send_event WHERE id = ?").bind(sendEventId),
    ])
    throw new ApiError(502, "email_delivery_failed", "The verification email could not be sent.")
  }
  return context.json(
    {
      challenge_id: id,
      expires_at: new Date(now + CODE_TTL_MS).toISOString(),
      resend_after: new Date(now + RESEND_DELAY_MS).toISOString(),
    },
    201,
  )
})

app.post("/v1/challenges/:id/resend", async (context) => {
  await applyIpRateLimit(context.env, context.req.raw)
  const db = context.env.InstallerVerificationDatabase
  const row = await challenge(db, context.req.param("id"))
  const now = Date.now()
  if (row.verified_at !== null)
    throw new ApiError(409, "challenge_already_verified", "This verification request is already complete.")
  if (!canResend(row.last_sent_at, now)) {
    const wait = Math.ceil((RESEND_DELAY_MS - (now - row.last_sent_at)) / 1000)
    throw new ApiError(429, "resend_too_soon", "Wait before requesting another code.", wait)
  }
  const sendEventId = await reserveEmailSend(db, row.email_hash, now)
  const code = context.env.INSTALLER_TEST_CODE ?? generateCode()
  await db
    .prepare("UPDATE challenge SET code_hash = ?, attempts = 0, last_sent_at = ?, expires_at = ? WHERE id = ?")
    .bind(await keyedHash(secrets(context.env).otp, `${row.id}:${code}`), now, now + CODE_TTL_MS, row.id)
    .run()
  try {
    await deliverCode(context.env, {
      email: row.email,
      displayName: row.display_name,
      code,
    })
  } catch {
    await db.batch([
      db
        .prepare("UPDATE challenge SET code_hash = ?, attempts = ?, last_sent_at = ?, expires_at = ? WHERE id = ?")
        .bind(row.code_hash, row.attempts, row.last_sent_at, row.expires_at, row.id),
      db.prepare("DELETE FROM send_event WHERE id = ?").bind(sendEventId),
    ])
    throw new ApiError(502, "email_delivery_failed", "The verification email could not be sent.")
  }
  return context.json({
    expires_at: new Date(now + CODE_TTL_MS).toISOString(),
    resend_after: new Date(now + RESEND_DELAY_MS).toISOString(),
  })
})

app.post("/v1/challenges/:id/verify", async (context) => {
  await applyIpRateLimit(context.env, context.req.raw)
  const input = parse(verifySchema, await jsonBody(context.req.raw))
  const db = context.env.InstallerVerificationDatabase
  const row = await challenge(db, context.req.param("id"))
  const now = Date.now()
  if (row.verified_at !== null)
    throw new ApiError(409, "challenge_already_verified", "This verification request is already complete.")
  if (row.expires_at <= now) throw new ApiError(409, "code_expired", "The verification code has expired.")
  if (row.attempts >= MAX_ATTEMPTS)
    throw new ApiError(429, "attempts_exhausted", "Too many incorrect verification attempts.")
  const value = secrets(context.env)
  const expected = await keyedHash(value.otp, `${row.id}:${input.code}`)
  if (!(await timingSafeEqual(value.otp, expected, row.code_hash))) {
    await db.prepare("UPDATE challenge SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run()
    const remaining = Math.max(0, MAX_ATTEMPTS - row.attempts - 1)
    throw new ApiError(
      remaining === 0 ? 429 : 409,
      remaining === 0 ? "attempts_exhausted" : "incorrect_code",
      remaining === 0 ? "Too many incorrect verification attempts." : "The verification code is incorrect.",
    )
  }
  const receiptId = row.id
  const expiresAt = now + RECEIPT_TTL_MS
  await db.batch([
    db.prepare("UPDATE challenge SET verified_at = ? WHERE id = ? AND verified_at IS NULL").bind(now, row.id),
    db
      .prepare(
        `INSERT INTO registration
          (install_id, display_name, email, email_verified_at, installer_version, platform,
           created_at, updated_at, retain_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(install_id) DO UPDATE SET
           display_name = excluded.display_name,
           email = excluded.email,
           email_verified_at = excluded.email_verified_at,
           installer_version = excluded.installer_version,
           platform = excluded.platform,
           updated_at = excluded.updated_at,
           retain_until = excluded.retain_until`,
      )
      .bind(
        row.install_id,
        row.display_name,
        row.email,
        now,
        row.installer_version,
        row.platform,
        now,
        now,
        now + RETENTION_MS,
      ),
    db
      .prepare("INSERT INTO receipt (id, install_id, issued_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(receiptId, row.install_id, now, expiresAt),
  ])
  context.executionCtx.waitUntil(
    notifyAdmin(context.env, {
      userEmail: row.email,
      displayName: row.display_name,
      installId: row.install_id,
      installerVersion: row.installer_version,
      platform: row.platform,
      verifiedAt: new Date(now).toISOString(),
    }),
  )
  return context.json({
    receipt: await signReceipt(value.receipt, {
      install_id: row.install_id,
      receipt_id: receiptId,
      issued_at: now,
      expires_at: expiresAt,
    }),
    expires_at: new Date(expiresAt).toISOString(),
  })
})

app.post("/v1/receipts/validate", async (context) => {
  await applyIpRateLimit(context.env, context.req.raw)
  const input = parse(receiptSchema, await jsonBody(context.req.raw))
  const payload = await verifyReceipt(secrets(context.env).receipt, input.receipt)
  const now = Date.now()
  if (!payload || payload.install_id !== input.install_id || payload.expires_at <= now)
    return context.json({ valid: false })
  const db = context.env.InstallerVerificationDatabase
  const row = await db
    .prepare(
      `SELECT receipt.id
       FROM receipt
       INNER JOIN registration ON registration.install_id = receipt.install_id
       LEFT JOIN revocation ON revocation.receipt_id = receipt.id
       WHERE receipt.id = ? AND receipt.install_id = ? AND receipt.expires_at > ?
         AND receipt.revoked_at IS NULL AND revocation.receipt_id IS NULL`,
    )
    .bind(payload.receipt_id, payload.install_id, now)
    .first<{ id: string }>()
  if (!row) return context.json({ valid: false })
  await db.batch([
    db.prepare("UPDATE receipt SET last_validated_at = ? WHERE id = ?").bind(now, payload.receipt_id),
    db
      .prepare(
        `UPDATE registration SET installer_version = COALESCE(?, installer_version),
         platform = COALESCE(?, platform), updated_at = ? WHERE install_id = ?`,
      )
      .bind(input.installer_version ?? null, input.platform ?? null, now, payload.install_id),
  ])
  return context.json({ valid: true, expires_at: new Date(payload.expires_at).toISOString() })
})

app.get("/v1/admin/installations", async (context) => {
  await requireAdmin(context.env, context.req.raw)
  const format = context.req.query("format") ?? "json"
  if (format !== "json" && format !== "csv") throw new ApiError(400, "invalid_format", "Format must be json or csv.")
  const result = await context.env.InstallerVerificationDatabase.prepare(
    `SELECT install_id, display_name, email, email_verified_at, installer_version, platform,
      created_at, updated_at, retain_until
     FROM registration ORDER BY created_at DESC LIMIT 10000`,
  ).all()
  if (format === "json") return context.json({ installations: result.results })
  const columns = [
    "install_id",
    "display_name",
    "email",
    "email_verified_at",
    "installer_version",
    "platform",
    "created_at",
    "updated_at",
    "retain_until",
  ]
  const csv = [
    columns.join(","),
    ...result.results.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n")
  return context.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="codyx-installations.csv"',
  })
})

app.delete("/v1/admin/installations/:installID", async (context) => {
  await requireAdmin(context.env, context.req.raw)
  const db = context.env.InstallerVerificationDatabase
  const installId = parse(z.string().uuid(), context.req.param("installID"))
  const now = Date.now()
  const receipts = await db
    .prepare("SELECT id, expires_at FROM receipt WHERE install_id = ?")
    .bind(installId)
    .all<{ id: string; expires_at: number }>()
  await db.batch([
    ...receipts.results.map((receipt) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO revocation (receipt_id, install_id, revoked_at, retain_until) VALUES (?, ?, ?, ?)",
        )
        .bind(receipt.id, installId, now, receipt.expires_at),
    ),
    db.prepare("DELETE FROM receipt WHERE install_id = ?").bind(installId),
    db.prepare("DELETE FROM registration WHERE install_id = ?").bind(installId),
    db.prepare("DELETE FROM challenge WHERE install_id = ?").bind(installId),
  ])
  return context.body(null, 204)
})

app.post("/v1/admin/installations/:installID/uninstall", async (context) => {
  await requireAdmin(context.env, context.req.raw)
  const db = context.env.InstallerVerificationDatabase
  const installId = parse(z.string().uuid(), context.req.param("installID"))
  const now = Date.now()
  const registration = await db
    .prepare("SELECT install_id FROM registration WHERE install_id = ?")
    .bind(installId)
    .first()
  if (!registration) throw new ApiError(404, "registration_not_found", "Installation not found.")
  const commandId = crypto.randomUUID()
  await db.batch([
    db
      .prepare(
        `INSERT INTO remote_command (id, install_id, type, status, created_at, retain_until)
         VALUES (?, ?, 'uninstall', 'pending', ?, ?)`,
      )
      .bind(commandId, installId, now, now + 30 * 24 * 60 * 60 * 1000),
    ...(
      await db
        .prepare("SELECT id, expires_at FROM receipt WHERE install_id = ?")
        .bind(installId)
        .all<{ id: string; expires_at: number }>()
    ).results.map((receipt) =>
      db
        .prepare(
          "INSERT OR REPLACE INTO revocation (receipt_id, install_id, revoked_at, retain_until) VALUES (?, ?, ?, ?)",
        )
        .bind(receipt.id, installId, now, receipt.expires_at),
    ),
    db.prepare("DELETE FROM receipt WHERE install_id = ?").bind(installId),
  ])
  return context.json({ command_id: commandId }, 201)
})

app.get("/v1/commands", async (context) => {
  const installId = context.req.query("install_id")
  const receipt = context.req.query("receipt")
  const input = parse(commandActionSchema.omit({ command_id: true }), { install_id: installId, receipt })
  const payload = await verifyReceiptPayload(context.env, input.install_id, input.receipt)
  const db = context.env.InstallerVerificationDatabase
  const now = Date.now()
  const rows = await db
    .prepare(
      `SELECT id, type, created_at
       FROM remote_command
       WHERE install_id = ? AND status = 'pending' AND retain_until > ?
       ORDER BY created_at ASC`,
    )
    .bind(payload.install_id, now)
    .all<{ id: string; type: string; created_at: number }>()
  return context.json({ commands: rows.results })
})

app.post("/v1/acknowledge", async (context) => {
  const input = parse(commandActionSchema, await jsonBody(context.req.raw))
  const payload = await verifyReceiptPayload(context.env, input.install_id, input.receipt)
  const db = context.env.InstallerVerificationDatabase
  const now = Date.now()
  await db
    .prepare(
      "UPDATE remote_command SET status = 'acknowledged', acknowledged_at = ? WHERE id = ? AND install_id = ? AND status = 'pending'",
    )
    .bind(now, input.command_id, payload.install_id)
    .run()
  return context.json({ status: "acknowledged" })
})

app.post("/v1/complete", async (context) => {
  const input = parse(commandActionSchema, await jsonBody(context.req.raw))
  const payload = await verifyReceiptPayload(context.env, input.install_id, input.receipt)
  const db = context.env.InstallerVerificationDatabase
  const now = Date.now()
  await db
    .prepare(
      "UPDATE remote_command SET status = 'completed', completed_at = ?, retain_until = ? WHERE id = ? AND install_id = ? AND status IN ('acknowledged', 'pending')",
    )
    .bind(now, now + 2 * 60 * 1000, input.command_id, payload.install_id)
    .run()
  context.executionCtx.waitUntil(notifyAdminUninstallComplete(context.env, payload.install_id, input.command_id))
  return context.json({ status: "completed" })
})

app.post("/internal/cleanup", async (context) => {
  await requireAdmin(context.env, context.req.raw)
  await cleanup(context.env.InstallerVerificationDatabase)
  return context.json({ cleaned: true })
})

app.notFound((context) => context.json({ error: "not_found", message: "Route not found." }, 404))

app.onError((error, context) => {
  const requestId = context.req.header("CF-Ray") ?? crypto.randomUUID()
  if (error instanceof ApiError) {
    console.warn(JSON.stringify({ request_id: requestId, status: error.status, error: error.code }))
    if (error.retryAfter) context.header("Retry-After", String(error.retryAfter))
    return context.json({ error: error.code, message: error.message }, error.status)
  }
  console.error(JSON.stringify({ request_id: requestId, status: 500, error: "internal_error" }))
  return context.json({ error: "internal_error", message: "The service could not process the request." }, 500)
})

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings) {
    await ensureSchema(env.InstallerVerificationDatabase)
    await cleanup(env.InstallerVerificationDatabase)
  },
}
