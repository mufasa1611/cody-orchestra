import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"
import * as AgentHub from "./hub"
import type { AgentMessage } from "./types"

export const agentWebSocketRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const hub = yield* AgentHub.Service

    yield* router.add(
      "GET",
      "/ws/agent",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        console.log("Agent WS connected from", request.headers.host, "path", request.url);
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
                const result = yield* hub.connectAgent(parsed.code, write, closeSocket, {
                  platform: parsed.platform,
                  hostname: parsed.hostname,
                })
                if (result.success) {
                  paired = true
                  pairedCode = parsed.code
                  yield* write(JSON.stringify({ type: "paired", reconnectToken: result.reconnectToken }))
                } else {
                  yield* write(JSON.stringify({ type: "pair-error", error: "Invalid or expired pairing code" }))
                }
                return
              }

              if (parsed.type === "reconnect" && !paired) {
                const result = yield* hub.reconnectAgent(parsed.token, write, closeSocket, {
                  platform: parsed.platform,
                  hostname: parsed.hostname,
                })
                if (result.success && result.code) {
                  paired = true
                  pairedCode = result.code
                  yield* write(JSON.stringify({ type: "reconnect-ok" }))
                } else {
                  yield* write(JSON.stringify({ type: "pair-error", error: "Invalid or expired reconnect token" }))
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
              Effect.suspend(() =>
                pairedCode
                  ? hub.disconnectAgent(pairedCode)
                  : Effect.void,
              ),
            ),
          )

        return HttpServerResponse.empty()
      }),
    )
  }),
)
