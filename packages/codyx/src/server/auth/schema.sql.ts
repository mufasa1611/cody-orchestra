import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"
import type { UserID } from "./schema"

export const UserTable = sqliteTable(
  "user",
  {
    id: text().$type<UserID>().primaryKey(),
    username: text().notNull(),
    password_hash: text().notNull(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
    time_updated: integer()
      .notNull()
      .$onUpdate(() => Date.now()),
  },
  (table) => [uniqueIndex("user_username_idx").on(table.username)],
)
