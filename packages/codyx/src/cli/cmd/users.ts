import { Effect } from "effect"
import { EOL } from "os"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as Auth from "@/server/auth/service"

export const UsersCommand = effectCmd({
  command: "users <action> [username]",
  describe: "manage web UI users",
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "action to perform",
        type: "string",
        choices: ["create", "list", "reset-password", "delete"] as const,
      })
      .positional("username", {
        describe: "username (required for create, reset-password, delete)",
        type: "string",
      })
      .option("password", {
        describe: "password (for create / reset-password)",
        type: "string",
      }),
  instance: false,
  handler: Effect.fn("Cli.users")(function* (args) {
    const action = args.action as string
    const username = args.username as string | undefined
    const password = args.password as string | undefined

    switch (action) {
      case "create": {
        if (!username) return yield* fail("Username is required")
        if (!password) return yield* fail("Password is required (use --password)")
        try {
          const user = Auth.createUser(username, password)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `User created: ${user.username}` + UI.Style.TEXT_NORMAL)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return yield* fail(msg)
        }
        break
      }
      case "list": {
        const users = Auth.listUsers()
        if (users.length === 0) {
          UI.println("No users found.")
          return
        }
        UI.println(UI.Style.TEXT_HIGHLIGHT_BOLD + `${"Username".padEnd(24)} Created` + UI.Style.TEXT_NORMAL)
        UI.println("─".repeat(40))
        for (const user of users) {
          const date = new Date(user.created_at).toISOString().slice(0, 10)
          UI.println(`${user.username.padEnd(24)} ${date}`)
        }
        UI.println(EOL + `Total: ${users.length} user(s)`)
        break
      }
      case "reset-password": {
        if (!username) return yield* fail("Username is required")
        if (!password) return yield* fail("New password is required (use --password)")
        try {
          const user = Auth.getUserByUsername(username)
          if (!user) return yield* fail(`User not found: ${username}`)
          Auth.changePassword(user.id, user.password_hash, password)
          UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Password reset for: ${username}` + UI.Style.TEXT_NORMAL)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return yield* fail(msg)
        }
        break
      }
      case "delete": {
        if (!username) return yield* fail("Username is required")
        try {
          const user = Auth.getUserByUsername(username)
          if (!user) return yield* fail(`User not found: ${username}`)
          Auth.deleteUser(user.id)
          UI.println(UI.Style.TEXT_WARNING_BOLD + `User deleted: ${username}` + UI.Style.TEXT_NORMAL)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return yield* fail(msg)
        }
        break
      }
      default:
        return yield* fail(`Unknown action: ${action}`)
    }
  }),
})
