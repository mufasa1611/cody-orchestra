import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { Flag } from "@cody/core/flag/flag"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"
import * as Log from "@cody/core/util/log"
import * as AuthService from "../../src/server/auth/service"
import { ensureSecret } from "../../src/server/auth/jwt"

void Log.init({ print: false })

const originalHttpApi = Flag.CODY_EXPERIMENTAL_HTTPAPI
const originalMode = process.env["CODY_SERVER_MODE"]
const originalFetch = globalThis.fetch

function app() {
  Flag.CODY_EXPERIMENTAL_HTTPAPI = true
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            CODY_SERVER_PASSWORD: undefined,
            CODY_SERVER_USERNAME: "codyx",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    fetch: (request: Request) => handler(request, ExperimentalHttpApiServer.context),
    request(input: string | URL | Request, init?: RequestInit) {
      return this.fetch(input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init))
    },
  }
}

afterEach(async () => {
  Flag.CODY_EXPERIMENTAL_HTTPAPI = originalHttpApi
  if (originalMode === undefined) delete process.env["CODY_SERVER_MODE"]
  else process.env["CODY_SERVER_MODE"] = originalMode
  globalThis.fetch = originalFetch
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi auth endpoints", () => {
  test("GET /api/auth/status keeps local mode account-free", async () => {
    const server = app()
    const initial = await server.request("/api/auth/status")

    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({
      mode: "local",
      accountAuthRequired: false,
      setupRequired: false,
      registrationMode: "closed",
      privacyUrl: "https://install.kingkung.men/privacy",
    })

    AuthService.createUser("status-user", "testpass123")
    const afterUser = await server.request("/api/auth/status")

    expect(afterUser.status).toBe(200)
    expect((await afterUser.json()).accountAuthRequired).toBe(false)
  })

  test("GET /api/auth/status requires bootstrap only in server mode", async () => {
    process.env["CODY_SERVER_MODE"] = "server"
    const server = app()
    expect(await (await server.request("/api/auth/status")).json()).toMatchObject({
      mode: "server",
      accountAuthRequired: true,
      setupRequired: true,
      registrationMode: "bootstrap",
    })

    AuthService.createUser("status-user", "testpass123")
    expect(await (await server.request("/api/auth/status")).json()).toMatchObject({
      mode: "server",
      accountAuthRequired: true,
      setupRequired: false,
      registrationMode: "closed",
    })
  })

  test("POST /api/auth/login returns token for valid credentials", async () => {
    ensureSecret()
    AuthService.createUser("testuser", "testpass123")

    const server = app()
    const response = await server.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "testpass123" }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token).toBeDefined()
    expect(body.token).toBeString()
    expect(body.user).toBeDefined()
    expect(body.user.username).toBe("testuser")
  })

  test("POST /api/auth/login returns 401 for invalid credentials", async () => {
    ensureSecret()
    AuthService.createUser("testuser", "testpass123")

    const server = app()
    const response = await server.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "wrongpass" }),
    })

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  test("POST /api/auth/login returns 400 for missing credentials", async () => {
    const server = app()
    const response = await server.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })
})
describe("HttpApi verified owner registration", () => {
  test("creates the first server administrator after email verification", async () => {
    ensureSecret()
    process.env["CODY_SERVER_MODE"] = "server"
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname === "/v1/challenges") {
          return Response.json(
            {
              challenge_id: "challenge-1",
              expires_at: "2026-06-14T12:10:00.000Z",
              resend_after: "2026-06-14T12:01:00.000Z",
            },
            { status: 201 },
          )
        }
        if (url.pathname === "/v1/challenges/challenge-1/verify") {
          return Response.json({ receipt: "verified.receipt", expires_at: "2026-06-14T12:10:00.000Z" })
        }
        if (url.pathname === "/v1/receipts/validate") return Response.json({ valid: true })
        return Response.json({ error: "not_found" }, { status: 404 })
      },
      { preconnect: originalFetch.preconnect },
    )
    const server = app()
    const registrationID = "35c1f30f-7740-4427-b321-5c375e8d7abe"
    const challenge = await server.request("/api/auth/register/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        registration_id: registrationID,
        username: "owner",
        email: "owner@example.com",
      }),
    })
    expect(challenge.status).toBe(201)
    const challengeResult = await challenge.json()
    expect(challengeResult).toMatchObject({
      challengeID: "challenge-1",
    })

    const verification = await server.request("/api/auth/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id: "challenge-1", code: "246810" }),
    })
    expect(verification.status).toBe(200)

    const registrationPayload = {
      username: "owner",
      email: "owner@example.com",
      password: "newpass123",
      registration_id: registrationID,
      receipt: "verified.receipt",
    }
    const response = await server.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(registrationPayload),
    })
    const result = await response.json()
    expect(result).toMatchObject({
      token: expect.any(String),
      user: { username: "owner", email: "owner@example.com", role: "admin", status: "active" },
    })
    expect(response.status).toBe(200)
  })

  test("local mode and configured servers reject self-registration", async () => {
    const server = app()
    expect(
      (
        await server.request("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(403)

    process.env["CODY_SERVER_MODE"] = "server"
    AuthService.createUser("existing", "testpass123")
    const response = await server.request("/api/auth/register/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "second", email: "second@example.com" }),
    })
    expect(response.status).toBe(403)
  })
})
