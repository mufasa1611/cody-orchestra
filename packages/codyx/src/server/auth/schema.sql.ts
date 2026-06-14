import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { UserID } from "./schema"

export const UserTable = sqliteTable(
  "user",
  {
    id: text().$type<UserID>().primaryKey(),
    username: text().notNull(),
    email: text(),
    email_normalized: text(),
    email_verified_at: integer(),
    role: text().$type<"admin" | "user">().notNull().default("user"),
    status: text().$type<"active" | "disabled">().notNull().default("active"),
    password_hash: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [
    uniqueIndex("user_username_idx").on(table.username),
    uniqueIndex("user_email_normalized_idx").on(table.email_normalized),
  ],
)
