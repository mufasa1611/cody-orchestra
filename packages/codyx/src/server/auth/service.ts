import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Global } from "@cody/core/global"
import * as Log from "@cody/core/util/log"
import { init } from "#db"
import { existsSync } from "fs"
import path from "path"
import { UserTable } from "./schema.sql"
import { UserID } from "./schema"

const log = Log.create({ service: "server.auth" })

export type UserRow = {
  id: string
  username: string
  created_at: number
}

export type UserRowWithPassword = UserRow & { password_hash: string }

type LegacyUserRow = {
  id: string
  username: string
  password_hash: string
  time_created: number
  time_updated: number
}

function hashPassword(password: string): string {
  return Bun.password.hashSync(password, { algorithm: "bcrypt", cost: 10 })
}

function verifyPassword(password: string, hash: string): boolean {
  try {
    return Bun.password.verifySync(password, hash)
  } catch {
    return false
  }
}

function legacyUserDatabasePaths() {
  const root = path.dirname(Global.Path.data)
  return [
    path.join(root, "opencode", "cody-x.db"),
    path.join(root, "cody-x", "opencode", "cody-x.db"),
    path.join(path.dirname(root), "cody-x", "opencode", "cody-x.db"),
  ]
}

function isLegacyUserRow(row: unknown): row is LegacyUserRow {
  if (typeof row !== "object" || row === null) return false
  const value = row as Record<string, unknown>
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.username === "string" &&
    value.username.length >= 2 &&
    typeof value.password_hash === "string" &&
    /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value.password_hash) &&
    typeof value.time_created === "number" &&
    Number.isSafeInteger(value.time_created) &&
    typeof value.time_updated === "number" &&
    Number.isSafeInteger(value.time_updated)
  )
}

function readLegacyUsers(file: string) {
  const db = init(file)
  try {
    const table = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`)
    if (table.length === 0) return []
    const columns = new Set((db.all(`PRAGMA table_info("user")`) as { name: string }[]).map((item) => item.name))
    if (!["id", "username", "password_hash", "time_created", "time_updated"].every((column) => columns.has(column))) {
      return []
    }
    return (
      db.all(`SELECT "id", "username", "password_hash", "time_created", "time_updated" FROM "user"`) as unknown[]
    ).filter(isLegacyUserRow)
  } finally {
    db.$client.close()
  }
}

export function migrateLegacyUsers(files = legacyUserDatabasePaths()): number {
  if (Database.use((db) => db.select().from(UserTable).all().length) > 0) return 0

  for (const file of files) {
    if (path.resolve(file) === path.resolve(Database.Path) || !existsSync(file)) continue
    const users = (() => {
      try {
        return readLegacyUsers(file)
      } catch {
        log.warn("failed to inspect legacy web user database")
        return []
      }
    })()
    if (users.length === 0) continue

    const imported = Database.transaction(
      (tx) => {
        if (tx.select().from(UserTable).all().length > 0) return 0
        tx.insert(UserTable)
          .values(
            users.map((user) => ({
              id: user.id as UserID,
              username: user.username,
              password_hash: user.password_hash,
              time_created: user.time_created,
              time_updated: user.time_updated,
            })),
          )
          .onConflictDoNothing()
          .run()
        return tx.select().from(UserTable).all().length
      },
      { behavior: "immediate" },
    )
    if (imported > 0) log.info("migrated legacy web users", { count: imported })
    return imported
  }

  return 0
}

function ensureSchema(): void {
  // Auth routes can be exercised through direct app handlers that do not call
  // Server.listen(), so keep auth-owned schema creation next to auth storage.
  const db = Database.Client()
  db.run(`CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY,
    "username" text NOT NULL,
    "password_hash" text NOT NULL,
    "time_created" integer NOT NULL,
    "time_updated" integer NOT NULL
  )`)
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS "user_username_idx" ON "user" ("username")`)

  const sessionTable = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'`)
  if (sessionTable.length > 0) {
    const columns = db.all(`PRAGMA table_info("session")`) as { name: string }[]
    if (!columns.some((c) => c.name === "user_id")) {
      db.run(`ALTER TABLE "session" ADD "user_id" text`)
    }
    db.run(`CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id")`)
  }

  const workspaceTable = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace'`)
  if (workspaceTable.length > 0) {
    const columns = db.all(`PRAGMA table_info("workspace")`) as { name: string }[]
    if (!columns.some((c) => c.name === "user_id")) {
      db.run(`ALTER TABLE "workspace" ADD "user_id" text`)
    }
    db.run(`CREATE INDEX IF NOT EXISTS "workspace_user_idx" ON "workspace" ("user_id")`)
  }

  const projectTable = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'`)
  if (projectTable.length > 0) {
    const columns = db.all(`PRAGMA table_info("project")`) as { name: string }[]
    if (!columns.some((c) => c.name === "user_id")) {
      db.run(`ALTER TABLE "project" ADD "user_id" text`)
    }
    db.run(`CREATE INDEX IF NOT EXISTS "project_user_idx" ON "project" ("user_id")`)
  }

  const permissionTable = db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'permission'`)
  if (permissionTable.length > 0) {
    const permColumns = db.all(`PRAGMA table_info("permission")`) as { name: string }[]
    if (!permColumns.some((c) => c.name === "mode")) {
      db.run(`ALTER TABLE "permission" ADD "mode" text DEFAULT 'standard' NOT NULL`)
    }
  }

  migrateLegacyUsers()
}

export function createUser(username: string, password: string): UserRow {
  ensureSchema()
  if (password.length < 8) throw new ValidationError("Password must be at least 8 characters")
  if (username.length < 2) throw new ValidationError("Username must be at least 2 characters")

  const existing = Database.use((db) => db.select().from(UserTable).where(eq(UserTable.username, username)).get())
  if (existing) throw new ValidationError("Username already taken")

  const id = Identifier.ascending("user") as UserID
  const passwordHash = hashPassword(password)

  Database.use((db) => db.insert(UserTable).values({ id, username, password_hash: passwordHash }).run())

  return { id, username, created_at: Date.now() }
}

export function verifyCredentials(username: string, password: string): UserRow {
  ensureSchema()
  const row = Database.use((db) => db.select().from(UserTable).where(eq(UserTable.username, username)).get())
  if (!row) throw new AuthError("Invalid username or password")
  if (!verifyPassword(password, row.password_hash)) throw new AuthError("Invalid username or password")
  return { id: row.id, username: row.username, created_at: row.time_created }
}

export function getUser(id: string): UserRow | undefined {
  ensureSchema()
  const row = Database.use((db) =>
    db
      .select()
      .from(UserTable)
      .where(eq(UserTable.id, id as UserID))
      .get(),
  )
  if (!row) return undefined
  return { id: row.id, username: row.username, created_at: row.time_created }
}

export function getUserByUsername(username: string): UserRowWithPassword | undefined {
  ensureSchema()
  const row = Database.use((db) => db.select().from(UserTable).where(eq(UserTable.username, username)).get())
  if (!row) return undefined
  return { id: row.id, username: row.username, password_hash: row.password_hash, created_at: row.time_created }
}

export function listUsers(): UserRow[] {
  ensureSchema()
  const rows = Database.use((db) => db.select().from(UserTable).orderBy(UserTable.username).all())
  return rows.map((r) => ({ id: r.id, username: r.username, created_at: r.time_created }))
}

export function changePassword(id: string, currentPassword: string, newPassword: string): void {
  ensureSchema()
  if (newPassword.length < 8) throw new ValidationError("New password must be at least 8 characters")
  const row = Database.use((db) =>
    db
      .select()
      .from(UserTable)
      .where(eq(UserTable.id, id as UserID))
      .get(),
  )
  if (!row) throw new ValidationError("User not found")
  if (!verifyPassword(currentPassword, row.password_hash)) throw new ValidationError("Current password is incorrect")
  const newHash = hashPassword(newPassword)
  Database.use((db) =>
    db
      .update(UserTable)
      .set({ password_hash: newHash })
      .where(eq(UserTable.id, id as UserID))
      .run(),
  )
}

export function deleteUser(id: string): void {
  ensureSchema()
  Database.use((db) =>
    db
      .delete(UserTable)
      .where(eq(UserTable.id, id as UserID))
      .run(),
  )
}

export function userCount(): number {
  ensureSchema()
  return Database.use((db) => db.select().from(UserTable).all().length)
}

export function ensureAdmin(): void {
  ensureSchema()

  const username = process.env["CODY_ADMIN_USERNAME"]
  const password = process.env["CODY_ADMIN_PASSWORD"]
  if (!username || !password) return

  const existing = Database.use((db) => db.select().from(UserTable).where(eq(UserTable.username, username)).get())
  if (existing) return

  const id = Identifier.ascending("user") as UserID
  const passwordHash = hashPassword(password)
  Database.use((db) => db.insert(UserTable).values({ id, username, password_hash: passwordHash }).run())
  console.log(`[codyx] Created admin user: ${username}`)
}

export class AuthError extends Error {
  override readonly name = "AuthError"
}

export class ValidationError extends Error {
  override readonly name = "ValidationError"
}
