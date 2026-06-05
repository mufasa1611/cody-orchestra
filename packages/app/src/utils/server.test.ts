import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, authUserFromJwt } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to codyx", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "codyx", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("codyx:secret"))
  })
})

describe("authUserFromJwt", () => {
  test("extracts the signed-in username from a JWT payload", () => {
    const payload = btoa(JSON.stringify({ sub: "usr_123", username: "cody" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    expect(authUserFromJwt(`header.${payload}.signature`)).toEqual({ id: "usr_123", username: "cody" })
  })

  test("ignores malformed JWTs", () => {
    expect(authUserFromJwt("not-a-jwt")).toBeUndefined()
    expect(authUserFromJwt("header.not-json.signature")).toBeUndefined()
  })
})
