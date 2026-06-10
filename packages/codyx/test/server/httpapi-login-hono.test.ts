import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { Flag } from "@cody/core/flag/flag"
import { resetDatabase } from "../fixture/db"
import * as Log from "@cody/core/util/log"
import * as AuthService from "../../src/server/auth/service"
import { ensureSecret } from "../../src/server/auth/jwt"
import AuthRoutes from "../../src/server/routes/auth"

void Log.init({ print: false })

const originalPassword = Flag.CODY_SERVER_PASSWORD
const originalJwt = Flag.CODY_JWT_SECRET

describe("Hono backend auth login", () => {
  test("POST /api/auth/login works via Hono sub-app", async () => {
    ensureSecret()
    AuthService.createUser("hono-test", "password123")

    const app = new Hono().route("/api/auth", AuthRoutes)
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "hono-test", password: "password123" }),
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.token).toBeDefined()
    expect(body.token).toBeString()
    expect(body.user.username).toBe("hono-test")
  })
})
