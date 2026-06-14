import { afterEach, expect, test } from "bun:test"
import { sendAdminRegistrationNotification, sendVerificationEmail } from "../src/email"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("sends verification codes through the Mailgun EU message API", async () => {
  let requestUrl = ""
  let requestInit: RequestInit | undefined
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      requestInit = init
      return new Response(JSON.stringify({ id: "queued" }), { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )

  await sendVerificationEmail({
    apiBase: "https://api.eu.mailgun.net/",
    domain: "verification.kingkung.men",
    sendingKey: "mailgun-test-key",
    sender: "Codyx Installer <installer@verification.kingkung.men>",
    email: "beginner@example.com",
    displayName: "Beginner User",
    code: "246810",
  })

  expect(requestUrl).toBe("https://api.eu.mailgun.net/v3/verification.kingkung.men/messages")
  expect(requestInit?.headers).toEqual({
    Authorization: `Basic ${btoa("api:mailgun-test-key")}`,
  })
  const body = requestInit?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body")
  expect(body.get("from")).toBe("Codyx Installer <installer@verification.kingkung.men>")
  expect(body.get("to")).toBe("beginner@example.com")
  expect(body.get("text")).toContain("246810")
  expect(body.get("o:tracking")).toBe("no")
  expect(body.get("o:tracking-clicks")).toBe("no")
  expect(body.get("o:tracking-opens")).toBe("no")
})

test("sends admin notification for a verified installation without the code", async () => {
  let requestUrl = ""
  let requestInit: RequestInit | undefined
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input
      requestInit = init
      return new Response(JSON.stringify({ id: "queued" }), { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )

  await sendAdminRegistrationNotification({
    apiBase: "https://api.eu.mailgun.net/",
    domain: "verification.kingkung.men",
    sendingKey: "mailgun-test-key",
    sender: "Codyx Installer <installer@verification.kingkung.men>",
    adminEmail: "admin@example.com",
    userEmail: "user@example.com",
    displayName: "Test User",
    installId: "550e8400-e29b-41d4-a716-446655440000",
    installerVersion: "1.14.41",
    platform: "windows",
    verifiedAt: "2026-06-13T16:00:00.000Z",
  })

  expect(requestUrl).toBe("https://api.eu.mailgun.net/v3/verification.kingkung.men/messages")
  expect(requestInit?.headers).toEqual({
    Authorization: `Basic ${btoa("api:mailgun-test-key")}`,
  })
  const body = requestInit?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body")
  expect(body.get("from")).toBe("Codyx Installer <installer@verification.kingkung.men>")
  expect(body.get("to")).toBe("admin@example.com")
  expect(body.get("subject")).toBe("[installer] Verified installation 550e8400-e29b-41d4-a716-446655440000")
  const text = body.get("text") as string
  expect(text).toContain("Test User")
  expect(text).toContain("user@example.com")
  expect(text).toContain("550e8400-e29b-41d4-a716-446655440000")
  expect(text).toContain("1.14.41")
  expect(text).toContain("windows")
  expect(text).toContain("2026-06-13T16:00:00.000Z")
  expect(text).not.toContain("123456")
  expect(text).not.toContain("Code:")
  expect(body.get("o:tracking")).toBe("no")
})

test("uses account-specific wording for WebUI verification", async () => {
  let requestInit: RequestInit | undefined
  globalThis.fetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestInit = init
      return new Response(JSON.stringify({ id: "queued" }), { status: 200 })
    },
    { preconnect: originalFetch.preconnect },
  )

  await sendVerificationEmail({
    apiBase: "https://api.eu.mailgun.net",
    domain: "verification.kingkung.men",
    sendingKey: "mailgun-test-key",
    sender: "Codyx Installer <installer@verification.kingkung.men>",
    email: "owner@example.com",
    displayName: "Server Owner",
    code: "246810",
    purpose: "webui-registration",
  })

  const body = requestInit?.body
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body")
  expect(body.get("subject")).toBe("Your Codyx account verification code")
  expect(body.get("text")).toContain("account verification code")
  expect(body.get("text")).not.toContain("installer verification code")
})
