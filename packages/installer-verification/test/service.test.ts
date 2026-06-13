import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Miniflare } from "miniflare"

const code = "246810"
const adminSecret = "admin-test-secret"
const receiptSecret = "receipt-test-secret"
const otpSecret = "otp-test-secret"
let worker: Miniflare

type DispatchRequestInit = NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]>
type TestRequestInit = Omit<DispatchRequestInit, "headers"> & {
  headers?: Record<string, string>
}

function request(path: string, init?: TestRequestInit) {
  return worker.dispatchFetch(
    `https://install.test${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": crypto.randomUUID(),
        ...init?.headers,
      },
    },
  )
}

function admin(path: string, init?: TestRequestInit) {
  return request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${adminSecret}`,
      ...init?.headers,
    },
  })
}

function challengeBody(installId = crypto.randomUUID(), email = `${crypto.randomUUID()}@example.com`) {
  return {
    install_id: installId,
    display_name: "Installer User",
    email,
    installer_version: "1.14.41",
    platform: "windows",
  }
}

async function createChallenge(body = challengeBody()) {
  const response = await request("/v1/challenges", {
    method: "POST",
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(201)
  return {
    body,
    response: (await response.json()) as { challenge_id: string },
  }
}

async function verifyChallenge(challengeId: string, value = code) {
  return request(`/v1/challenges/${challengeId}/verify`, {
    method: "POST",
    body: JSON.stringify({ code: value }),
  })
}

beforeAll(async () => {
  worker = new Miniflare({
    modules: true,
    scriptPath: ".test-dist/index.js",
    compatibilityDate: "2026-06-13",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: {
      InstallerVerificationDatabase: "installer-verification-test",
    },
    bindings: {
      INSTALLER_ENVIRONMENT: "test",
      INSTALLER_SENDER: "Codyx Installer <installer@verification.kingkung.men>",
      INSTALLER_PRIVACY_EMAIL: "privacy@kingkung.men",
      INSTALLER_MAILGUN_API_BASE: "https://api.eu.mailgun.net",
      INSTALLER_MAILGUN_DOMAIN: "verification.kingkung.men",
      INSTALLER_TEST_CODE: code,
      INSTALLER_RECEIPT_SECRET: receiptSecret,
      INSTALLER_OTP_PEPPER: otpSecret,
      INSTALLER_ADMIN_SECRET: adminSecret,
      INSTALLER_MAILGUN_SENDING_KEY: "test-sending-key",
    },
  })
})

afterAll(async () => {
  await worker.dispose()
})

describe("installer verification service", () => {
  test("publishes its health and privacy disclosures", async () => {
    const health = await request("/health")
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ healthy: true, environment: "test" })

    const privacy = await request("/privacy")
    expect(privacy.status).toBe(200)
    const notice = await privacy.text()
    expect(notice).toContain("display name is not independently verified")
    expect(notice).toContain("privacy@kingkung.men")
    expect(notice).toContain("It is not used for marketing")
    expect(notice).toContain("operational registration notice")
    expect(notice).toContain("Verification codes are never included")
  })

  test("issues a receipt, validates it, and prevents challenge replay", async () => {
    const created = await createChallenge()
    const verified = await verifyChallenge(created.response.challenge_id)
    expect(verified.status).toBe(200)
    const result = (await verified.json()) as { receipt: string }

    const valid = await request("/v1/receipts/validate", {
      method: "POST",
      body: JSON.stringify({
        install_id: created.body.install_id,
        receipt: result.receipt,
        installer_version: "1.14.42",
        platform: "windows",
      }),
    })
    expect(valid.status).toBe(200)
    expect((await valid.json()) as { valid: boolean }).toMatchObject({ valid: true })

    const replay = await verifyChallenge(created.response.challenge_id)
    expect(replay.status).toBe(409)
    expect((await replay.json()) as { error: string }).toMatchObject({
      error: "challenge_already_verified",
    })
  })

  test("expires codes and enforces five attempts", async () => {
    const expired = await createChallenge()
    const db = await worker.getD1Database("InstallerVerificationDatabase")
    await db
      .prepare("UPDATE challenge SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, expired.response.challenge_id)
      .run()
    const expiredResponse = await verifyChallenge(expired.response.challenge_id)
    expect(expiredResponse.status).toBe(409)
    expect((await expiredResponse.json()) as { error: string }).toMatchObject({ error: "code_expired" })

    const attempted = await createChallenge()
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await verifyChallenge(attempted.response.challenge_id, "000000")
      expect(response.status).toBe(409)
      expect((await response.json()) as { error: string }).toMatchObject({ error: "incorrect_code" })
    }
    const fifth = await verifyChallenge(attempted.response.challenge_id, "000000")
    expect(fifth.status).toBe(429)
    expect((await fifth.json()) as { error: string }).toMatchObject({ error: "attempts_exhausted" })
    expect((await verifyChallenge(attempted.response.challenge_id)).status).toBe(429)
  })

  test("enforces resend cooldown and per-email send limits", async () => {
    const email = `${crypto.randomUUID()}@example.com`
    const created = await createChallenge(challengeBody(crypto.randomUUID(), email))
    const tooSoon = await request(`/v1/challenges/${created.response.challenge_id}/resend`, {
      method: "POST",
    })
    expect(tooSoon.status).toBe(429)
    expect((await tooSoon.json()) as { error: string }).toMatchObject({ error: "resend_too_soon" })

    const db = await worker.getD1Database("InstallerVerificationDatabase")
    for (let send = 1; send < 5; send++) {
      await db
        .prepare("UPDATE challenge SET last_sent_at = ? WHERE id = ?")
        .bind(Date.now() - 61_000, created.response.challenge_id)
        .run()
      const resent = await request(`/v1/challenges/${created.response.challenge_id}/resend`, {
        method: "POST",
      })
      expect(resent.status).toBe(200)
    }
    await db
      .prepare("UPDATE challenge SET last_sent_at = ? WHERE id = ?")
      .bind(Date.now() - 61_000, created.response.challenge_id)
      .run()
    const limited = await request(`/v1/challenges/${created.response.challenge_id}/resend`, {
      method: "POST",
    })
    expect(limited.status).toBe(429)
    expect((await limited.json()) as { error: string }).toMatchObject({ error: "email_rate_limited" })
  })

  test("enforces the email send limit under concurrent requests", async () => {
    const email = `${crypto.randomUUID()}@example.com`
    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        request("/v1/challenges", {
          method: "POST",
          body: JSON.stringify(challengeBody(crypto.randomUUID(), email)),
        }),
      ),
    )
    expect(responses.filter((response) => response.status === 201)).toHaveLength(5)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1)
  })

  test("exports registrations and deletion revokes receipts", async () => {
    const created = await createChallenge()
    const verified = await verifyChallenge(created.response.challenge_id)
    const receipt = ((await verified.json()) as { receipt: string }).receipt

    expect((await request("/v1/admin/installations?format=json")).status).toBe(401)
    const exported = await admin("/v1/admin/installations?format=csv")
    expect(exported.status).toBe(200)
    expect(await exported.text()).toContain(created.body.email)

    const deleted = await admin(`/v1/admin/installations/${created.body.install_id}`, {
      method: "DELETE",
    })
    expect(deleted.status).toBe(204)
    const validation = await request("/v1/receipts/validate", {
      method: "POST",
      body: JSON.stringify({ install_id: created.body.install_id, receipt }),
    })
    expect(await validation.json()).toEqual({ valid: false })
  })

  test("rejects expired receipts and cleanup removes retained data", async () => {
    const created = await createChallenge()
    const verified = await verifyChallenge(created.response.challenge_id)
    const receipt = ((await verified.json()) as { receipt: string }).receipt
    const db = await worker.getD1Database("InstallerVerificationDatabase")
    await db
      .prepare("UPDATE receipt SET expires_at = ? WHERE install_id = ?")
      .bind(Date.now() - 1, created.body.install_id)
      .run()
    const expired = await request("/v1/receipts/validate", {
      method: "POST",
      body: JSON.stringify({ install_id: created.body.install_id, receipt }),
    })
    expect(await expired.json()).toEqual({ valid: false })

    await db
      .prepare("UPDATE registration SET retain_until = ? WHERE install_id = ?")
      .bind(Date.now() - 1, created.body.install_id)
      .run()
    const cleaned = await admin("/internal/cleanup", { method: "POST" })
    expect(cleaned.status).toBe(200)
    const registration = await db
      .prepare("SELECT install_id FROM registration WHERE install_id = ?")
      .bind(created.body.install_id)
      .first()
    expect(registration).toBeNull()
  })

  test("applies the per-IP service rate limit", async () => {
    const ip = "203.0.113.10"
    const responses = await Promise.all(
      Array.from({ length: 11 }, () =>
        request("/v1/receipts/validate", {
          method: "POST",
          headers: { "CF-Connecting-IP": ip },
          body: JSON.stringify({
            install_id: crypto.randomUUID(),
            receipt: "invalid.receipt",
          }),
        }),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(10)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(1)
  })
})
