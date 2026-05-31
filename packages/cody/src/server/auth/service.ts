import { eq } from "drizzle-orm"
import { Database } from "@/storage/db"
import { Identifier } from "@/id/id"
import { UserTable } from "./schema.sql"
import type { UserID } from "./schema"

export type UserRow = {
  id: string
  username: string
  created_at: number
}

export type UserRowWithPassword = UserRow & { password_hash: string }

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

export function createUser(username: string, password: string): UserRow {
  if (password.length < 4) throw new ValidationError("Password must be at least 4 characters")
  if (username.length < 2) throw new ValidationError("Username must be at least 2 characters")

  const existing = Database.use((db) =>
    db.select().from(UserTable).where(eq(UserTable.username, username)).get(),
  )
  if (existing) throw new ValidationError("Username already taken")

  const id = Identifier.ascending("user")
  const passwordHash = hashPassword(password)

  Database.use((db) =>
    db.insert(UserTable).values({ id, username, password_hash: passwordHash }),
  )

  return { id, username, created_at: Date.now() }
}

export function verifyCredentials(username: string, password: string): UserRow {
  const row = Database.use((db) =>
    db.select().from(UserTable).where(eq(UserTable.username, username)).get(),
  )
  if (!row) throw new AuthError("Invalid username or password")
  if (!verifyPassword(password, row.password_hash)) throw new AuthError("Invalid username or password")
  return { id: row.id, username: row.username, created_at: row.time_created }
}

export function getUser(id: string): UserRow | undefined {
  const row = Database.use((db) =>
    db.select().from(UserTable).where(eq(UserTable.id, id as UserID)).get(),
  )
  if (!row) return undefined
  return { id: row.id, username: row.username, created_at: row.time_created }
}

export function getUserByUsername(username: string): UserRowWithPassword | undefined {
  const row = Database.use((db) =>
    db.select().from(UserTable).where(eq(UserTable.username, username)).get(),
  )
  if (!row) return undefined
  return { id: row.id, username: row.username, password_hash: row.password_hash, created_at: row.time_created }
}

export function listUsers(): UserRow[] {
  const rows = Database.use((db) =>
    db.select().from(UserTable).orderBy(UserTable.username).all(),
  )
  return rows.map((r) => ({ id: r.id, username: r.username, created_at: r.time_created }))
}

export function changePassword(id: string, currentPassword: string, newPassword: string): void {
  if (newPassword.length < 4) throw new ValidationError("New password must be at least 4 characters")
  const row = Database.use((db) =>
    db.select().from(UserTable).where(eq(UserTable.id, id as UserID)).get(),
  )
  if (!row) throw new ValidationError("User not found")
  if (!verifyPassword(currentPassword, row.password_hash)) throw new ValidationError("Current password is incorrect")
  const newHash = hashPassword(newPassword)
  Database.use((db) =>
    db.update(UserTable).set({ password_hash: newHash }).where(eq(UserTable.id, id as UserID)),
  )
}

export function deleteUser(id: string): void {
  Database.use((db) => db.delete(UserTable).where(eq(UserTable.id, id as UserID)))
}

export class AuthError extends Error {
  readonly name = "AuthError"
}

export class ValidationError extends Error {
  readonly name = "ValidationError"
}
