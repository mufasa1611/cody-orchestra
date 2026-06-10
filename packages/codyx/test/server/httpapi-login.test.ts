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
  await disposeAllInstances()
  await resetDatabase()
})

describe("HttpApi auth endpoints", () => {
  test("GET /api/auth/status reports whether account auth is active", async () => {
    const server = app()
    const initial = await server.request("/api/auth/status")

    expect(initial.status).toBe(200)
    expect(await initial.json()).toEqual({ accountAuthRequired: false })

    AuthService.createUser("status-user", "testpass123")
    const afterUser = await server.request("/api/auth/status")

    expect(afterUser.status).toBe(200)
    expect(await afterUser.json()).toEqual({ accountAuthRequired: true })
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
﻿describe("HttpApi register endpoint", () => {
  test("POST /api/auth/register creates a new user and returns token", async () => {
    ensureSecret()
    const server = app()
    const response = await server.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "newuser", password: "newpass123" }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token).toBeDefined()
    expect(body.user).toBeDefined()
    expect(body.user.username).toBe("newuser")
  })

  test("POST /api/auth/register rejects duplicate username", async () => {
    ensureSecret()
    AuthService.createUser("existing", "testpass123")
    const server = app()
    const response = await server.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "existing", password: "newpass123" }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })

  test("POST /api/auth/register rejects short password", async () => {
    const server = app()
    const response = await server.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "shortpwd", password: "ab" }),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })
})
