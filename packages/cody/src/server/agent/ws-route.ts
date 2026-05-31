import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import * as AgentHub from "./hub"
import * as Shared from "./shared"
import type { AgentMessage } from "./types"

export const agentWebSocketRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const hub = yield* AgentHub.Service

    yield* router.add(
      "GET",
      "/ws/agent",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const socket = yield* Effect.orDie(request.upgrade)
        const rawWrite = yield* socket.writer
        const write = (data: string | Uint8Array) => rawWrite(data).pipe(Effect.catch(() => Effect.void))

        // Close callback: sends a CloseEvent through the WebSocket writer
        const closeSocket: Effect.Effect<void> = (rawWrite as (data: any) => Effect.Effect<void>)(
          new Socket.CloseEvent(1000, "server disconnect"),
        ).pipe(Effect.catch(() => Effect.void))

        // The agent should send a "pair" message as its first message
        let paired = false
        let pairedCode = ""

        yield* socket
          .runRaw((message) =>
            Effect.gen(function* () {
              const text = typeof message === "string" ? message : new TextDecoder().decode(message as Uint8Array)

              let parsed: AgentMessage
              try {
                parsed = JSON.parse(text) as AgentMessage
              } catch {
                return
              }

              if (parsed.type === "pair" && !paired) {
                const ok = yield* hub.connectAgent(parsed.code, write, closeSocket)
                if (ok) {
                  paired = true
                  pairedCode = parsed.code
                  Shared.registerHub(hub)
                  yield* write(JSON.stringify({ type: "paired" }))
                } else {
                  yield* write(JSON.stringify({ type: "pair-error", error: "Invalid or expired pairing code" }))
                }
                return
              }

              if (paired) {
                yield* hub.dispatch(parsed, pairedCode)
              }
            }).pipe(Effect.catch(() => Effect.void)),
          )
          .pipe(
            Effect.ensuring(
              pairedCode
                ? hub.disconnectAgent(pairedCode).pipe(
                    Effect.ensuring(Effect.sync(() => Shared.clearHub())),
                  )
                : Effect.void,
            ),
          )

        return HttpServerResponse.empty()
      }),
    )
  }),
)
