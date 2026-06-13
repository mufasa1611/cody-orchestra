import { afterEach, expect, test } from "bun:test"
import { sendAdminNotification, sendVerificationEmail } from "../src/email"

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

  expect(requestUrl).toBe(
    "https://api.eu.mailgun.net/v3/verification.kingkung.men/messages",
  )
  expect(requestInit?.headers).toEqual({
    Authorization: `Basic ${btoa("api:mailgun-test-key")}`,
  })
  const body = requestInit?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body")
  expect(body.get("from")).toBe(
    "Codyx Installer <installer@verification.kingkung.men>",
  )
  expect(body.get("to")).toBe("beginner@example.com")
  expect(body.get("text")).toContain("246810")
  expect(body.get("o:tracking")).toBe("no")
  expect(body.get("o:tracking-clicks")).toBe("no")
  expect(body.get("o:tracking-opens")).toBe("no")
})

test("sends admin notification with installer user info", async () => {
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

  await sendAdminNotification({
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
    code: "123456",
  })

  expect(requestUrl).toBe(
    "https://api.eu.mailgun.net/v3/verification.kingkung.men/messages",
  )
  expect(requestInit?.headers).toEqual({
    Authorization: `Basic ${btoa("api:mailgun-test-key")}`,
  })
  const body = requestInit?.body
  expect(body).toBeInstanceOf(FormData)
  if (!(body instanceof FormData)) throw new Error("Expected a FormData body")
  expect(body.get("from")).toBe(
    "Codyx Installer <installer@verification.kingkung.men>",
  )
  expect(body.get("to")).toBe("admin@example.com")
  expect(body.get("subject")).toBe(
    "[installer] Verification code generated for user@example.com",
  )
  const text = body.get("text") as string
  expect(text).toContain("Test User")
  expect(text).toContain("user@example.com")
  expect(text).toContain("550e8400-e29b-41d4-a716-446655440000")
  expect(text).toContain("1.14.41")
  expect(text).toContain("windows")
  expect(text).toContain("123456")
  expect(body.get("o:tracking")).toBe("no")
})
