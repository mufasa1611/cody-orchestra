import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import * as AgentHub from "@/server/agent/hub"

export const agentHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent", (handlers) =>
  Effect.gen(function* () {
    const hub = yield* AgentHub.Service

    const createPair = Effect.fn("AgentHttpApi.createPair")(function* () {
      const code = yield* hub.createPairingCode
      return { code, expiresAt: Date.now() + 5 * 60 * 1000 }
    })

    const status = Effect.fn("AgentHttpApi.status")(function* () {
      return yield* hub.getStatus
    })

    const listDir = Effect.fn("AgentHttpApi.listDir")(function* (ctx: { query: { path?: string } }) {
      const path = ctx.query.path || "/"
      const result: unknown = yield* hub.listDir(path).pipe(Effect.orDie)
      return result as { files: Array<{ name: string; path: string; type: "file" | "directory"; size?: number; modifiedAt?: number }> }
    })

    const readFile = Effect.fn("AgentHttpApi.readFile")(function* (ctx: { query: { path: string } }) {
      const result: unknown = yield* hub.readFile(ctx.query.path).pipe(Effect.orDie)
      return result as { content: string; encoding?: string }
    })

    const writeFile = Effect.fn("AgentHttpApi.writeFile")(function* (ctx: { payload: { path: string; content: string; encoding?: string } }) {
      const content = ctx.payload.encoding === "base64"
        ? Buffer.from(ctx.payload.content, "base64").toString("utf-8")
        : ctx.payload.content
      yield* hub.writeFile(ctx.payload.path, content).pipe(Effect.orDie)
      return { success: true }
    })

    const exec = Effect.fn("AgentHttpApi.exec")(function* (ctx: { payload: { command: string } }) {
      const result: unknown = yield* hub.exec(ctx.payload.command).pipe(Effect.orDie)
      return result as { stdout: string; stderr: string; exitCode: number }
    })

    const disconnect = Effect.fn("AgentHttpApi.disconnect")(function* () {
      const s = yield* hub.getStatus
      if (s.connected && s.code) {
        yield* hub.disconnectAgent(s.code)
      }
      return { disconnected: true }
    })

    return handlers
      .handle("createPair", createPair)
      .handle("status", status)
      .handle("listDir", listDir)
      .handle("readFile", readFile)
      .handle("writeFile", writeFile)
      .handle("exec", exec)
      .handle("disconnect", disconnect)
  }),
)
