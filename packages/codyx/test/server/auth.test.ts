import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { ServerAuth } from "../../src/server/auth"

const original = {
  CODY_SERVER_PASSWORD: process.env["CODY_SERVER_PASSWORD"],
  CODY_SERVER_USERNAME: process.env["CODY_SERVER_USERNAME"],
}

afterEach(() => {
  process.env["CODY_SERVER_PASSWORD"] = original.CODY_SERVER_PASSWORD
  process.env["CODY_SERVER_USERNAME"] = original.CODY_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    delete process.env["CODY_SERVER_PASSWORD"]
    process.env["CODY_SERVER_USERNAME"] = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the cody-x username", () => {
    process.env["CODY_SERVER_PASSWORD"] = "secret"
    delete process.env["CODY_SERVER_USERNAME"]

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("cody-x:secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    process.env["CODY_SERVER_PASSWORD"] = "secret"
    process.env["CODY_SERVER_USERNAME"] = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    process.env["CODY_SERVER_PASSWORD"] = "secret"
    process.env["CODY_SERVER_USERNAME"] = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "cody", password: Redacted.make("secret") }, config)).toBe(false)
  })
})
