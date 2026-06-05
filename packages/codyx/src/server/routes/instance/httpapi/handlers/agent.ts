import { Effect } from "effect"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { UserRef } from "@/effect/instance-ref"
import { InstanceHttpApi } from "../api"
import * as Jwt from "@/server/auth/jwt"
import * as AgentHub from "@/server/agent/hub"
import fs from "node:fs/promises"
import path from "node:path"

function requestIsLocal(request: HttpServerRequest.HttpServerRequest) {
  const host = (() => {
    const headerHost = request.headers.host?.split(":")[0]
    if (headerHost) return headerHost
    try {
      return new URL(request.url).hostname
    } catch {
      return undefined
    }
  })()
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
}

async function listWindowsDrives() {
  const drives: Array<{ name: string; path: string; type: "directory" }> = []
  for (let i = 65; i <= 90; i++) {
    const drive = `${String.fromCharCode(i)}:\\`
    try {
      await fs.access(drive)
      drives.push({ name: drive, path: drive, type: "directory" })
    } catch {
      // drive is not mounted
    }
  }
  return drives
}

async function localListDir(input: string) {
  const dir = input || "/"
  if (process.platform === "win32" && (dir === "/" || dir === "\\")) {
    return { files: await listWindowsDrives() }
  }

  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name)
      try {
        const stat = await fs.stat(full)
        return {
          name: entry.name,
          path: full,
          type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
          size: stat.size,
          modifiedAt: stat.mtimeMs,
        }
      } catch {
        return {
          name: entry.name,
          path: full,
          type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
        }
      }
    }),
  )
  return { files }
}

async function localReadFile(filePath: string) {
  try {
    return { content: await fs.readFile(filePath, "utf-8") }
  } catch {
    return { content: (await fs.readFile(filePath)).toString("base64"), encoding: "base64" }
  }
}

async function localWriteFile(filePath: string, content: string, encoding?: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, encoding === "base64" ? Buffer.from(content, "base64") : content, encoding === "base64" ? undefined : "utf-8")
}

export const agentHandlers = HttpApiBuilder.group(InstanceHttpApi, "agent", (handlers) =>
  Effect.gen(function* () {
    const hub = yield* AgentHub.Service
    const withUser = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const userID = (yield* UserRef) ?? Jwt.userIdFromBearer(request.headers.authorization ?? "")
        if (!userID) return yield* new HttpApiError.Unauthorized({})
        return yield* effect.pipe(Effect.provideService(UserRef, userID))
      })

    const createPair = Effect.fn("AgentHttpApi.createPair")(function* () {
      return yield* withUser(
        Effect.gen(function* () {
          const code = yield* hub.createPairingCode
          return { code, expiresAt: Date.now() + 5 * 60 * 1000 }
        }),
      )
    })

    const status = Effect.fn("AgentHttpApi.status")(function* () {
      return yield* withUser(hub.getStatus)
    })

    const listDir = Effect.fn("AgentHttpApi.listDir")(function* (ctx: { query: { path?: string } }) {
      return yield* withUser(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const target = ctx.query.path || "/"
          const result: unknown = yield* hub.listDir(target).pipe(
            Effect.catch((error) =>
              requestIsLocal(request)
                ? Effect.promise(() => localListDir(target))
                : Effect.fail(error),
            ),
            Effect.orDie,
          )
          return result as { files: Array<{ name: string; path: string; type: "file" | "directory"; size?: number; modifiedAt?: number }> }
        }),
      )
    })

    const readFile = Effect.fn("AgentHttpApi.readFile")(function* (ctx: { query: { path: string } }) {
      return yield* withUser(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const result: unknown = yield* hub.readFile(ctx.query.path).pipe(
            Effect.catch((error) =>
              requestIsLocal(request)
                ? Effect.promise(() => localReadFile(ctx.query.path))
                : Effect.fail(error),
            ),
            Effect.orDie,
          )
          return result as { content: string; encoding?: string }
        }),
      )
    })

    const writeFile = Effect.fn("AgentHttpApi.writeFile")(function* (ctx: { payload: { path: string; content: string; encoding?: string } }) {
      return yield* withUser(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const content = ctx.payload.encoding === "base64"
            ? Buffer.from(ctx.payload.content, "base64").toString("utf-8")
            : ctx.payload.content
          yield* hub.writeFile(ctx.payload.path, content).pipe(
            Effect.catch((error) =>
              requestIsLocal(request)
                ? Effect.promise(() => localWriteFile(ctx.payload.path, ctx.payload.content, ctx.payload.encoding))
                : Effect.fail(error),
            ),
            Effect.orDie,
          )
          return { success: true }
        }),
      )
    })

    const exec = Effect.fn("AgentHttpApi.exec")(function* (ctx: { payload: { command: string } }) {
      return yield* withUser(
        Effect.gen(function* () {
          const result: unknown = yield* hub.exec(ctx.payload.command).pipe(Effect.orDie)
          return result as { stdout: string; stderr: string; exitCode: number }
        }),
      )
    })

    const disconnect = Effect.fn("AgentHttpApi.disconnect")(function* () {
      return yield* withUser(
        Effect.gen(function* () {
          const s = yield* hub.getStatus
          if (s.connected && s.code) {
            yield* hub.disconnectAgent(s.code)
          }
          return { disconnected: true }
        }),
      )
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
