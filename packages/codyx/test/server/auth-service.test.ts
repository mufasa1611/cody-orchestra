import { afterEach, describe, expect, test } from "bun:test"
import { Database as SQLite } from "bun:sqlite"
import path from "path"
import * as AuthService from "../../src/server/auth/service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(resetDatabase)

describe("web user storage", () => {
  test("creates a verified first administrator with normalized email", () => {
    const user = AuthService.createVerifiedAdmin("owner", "OWNER@Example.com", "password123")
    expect(user).toMatchObject({
      username: "owner",
      email: "owner@example.com",
      role: "admin",
      status: "active",
    })
    expect(() => AuthService.createVerifiedAdmin("other", "other@example.com", "password123")).toThrow(
      "Server setup is already complete",
    )
  })

  test("imports valid users from a legacy database only when the current table is empty", async () => {
    await using tmp = await tmpdir()
    const legacyPath = path.join(tmp.path, "cody-x.db")
    const legacy = new SQLite(legacyPath)
    legacy.run(`CREATE TABLE "user" (
      "id" text PRIMARY KEY,
      "username" text NOT NULL,
      "password_hash" text NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`)
    legacy
      .query(
        `INSERT INTO "user" ("id", "username", "password_hash", "time_created", "time_updated")
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("user_legacy", "legacy-user", Bun.password.hashSync("password123", { algorithm: "bcrypt", cost: 4 }), 1, 2)
    legacy.close()

    expect(AuthService.userCount()).toBe(0)
    expect(AuthService.migrateLegacyUsers([legacyPath])).toBe(1)
    expect(AuthService.verifyCredentials("legacy-user", "password123").username).toBe("legacy-user")
    expect(AuthService.migrateLegacyUsers([legacyPath])).toBe(0)
  })
})
