import { env } from "node:process"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

function loadEnvFile(file: string) {
  if (!existsSync(file)) return false
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const sep = trimmed.indexOf("=")
    if (sep === -1) continue
    const key = trimmed.slice(0, sep).trim()
    const value = trimmed.slice(sep + 1).trim()
    if (key && !(key in env)) env[key] = value
  }
  return true
}

loadEnvFile(resolve(process.cwd(), ".env.proxy")) || loadEnvFile(resolve(process.cwd(), ".env"))

import { ProxyCommand } from "./cli/cmd/proxy"
import * as Log from "@cody/core/util/log"

async function main() {
  await Log.init({
    print: true,
    dev: false,
    level: "INFO"
  })

  console.log("[Proxy] Initializing standalone rotator...");
  // ProxyCommand.handler is already an async function that runs the Effect.
  // DO NOT use Effect.runPromise on its result.
  // @ts-ignore
  await ProxyCommand.handler({ 
    $0: "codyx", 
    _: ["proxy"] 
  })
}

main().catch((err) => {
  console.error("[Proxy] Fatal error:", err);
  process.exit(1);
})
