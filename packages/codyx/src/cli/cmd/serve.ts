import { Effect } from "effect"
import { Server } from "../../server/server"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@cody/core/flag/flag"
import { isLoopbackHostname } from "@/server/auth/mode"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) =>
    withNetworkOptions(yargs).option("mode", {
      type: "string",
      choices: ["local", "server"] as const,
      default: process.env["CODY_SERVER_MODE"] === "server" ? "server" : "local",
      describe: "local disables account auth; server requires verified WebUI accounts",
    }),
  describe: "starts a headless codyx server",
  // Server loads instances per-request via x-cody-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const opts = yield* resolveNetworkOptions(args)
    if (args.mode !== "server" && !isLoopbackHostname(opts.hostname)) {
      throw new Error("Remote listening requires --mode server. Local mode may only bind to a loopback address.")
    }
    process.env["CODY_SERVER_MODE"] = args.mode
    if (args.mode === "local" && !Flag.CODY_SERVER_PASSWORD && process.env.CODY_PRO !== "1") {
      console.log("Warning: CODY_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`codyx server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
