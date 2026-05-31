import { Context, Deferred, Duration, Effect, Layer } from "effect"
import type { AgentMessage, HubMessage } from "./types"

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 6
const CODE_TTL_DURATION = Duration.minutes(5)
const COMMAND_TIMEOUT_DURATION = Duration.seconds(30)

interface PendingCommand {
  deferred: Deferred.Deferred<unknown, Error>
}

type AgentWriter = (data: string | Uint8Array) => Effect.Effect<void>

interface PairedAgent {
  code: string
  write: AgentWriter
  close: Effect.Effect<void>
  connectedAt: number
  remotePlatform?: string
  remoteHostname?: string
  lastPong?: number
}

interface PairingCode {
  code: string
  createdAt: number
  expiresAt: number
  used: boolean
}

export interface Interface {
  readonly createPairingCode: Effect.Effect<string>
  readonly connectAgent: (code: string, write: AgentWriter, close: Effect.Effect<void>) => Effect.Effect<boolean, Error>
  readonly disconnectAgent: (code: string) => Effect.Effect<void>
  readonly dispatch: (message: AgentMessage, senderCode?: string) => Effect.Effect<void>
  readonly getStatus: Effect.Effect<{ connected: boolean; code?: string; pairedAt?: number }>
  readonly listDir: (path: string) => Effect.Effect<unknown, Error>
  readonly readFile: (path: string) => Effect.Effect<unknown, Error>
  readonly writeFile: (path: string, content: string) => Effect.Effect<unknown, Error>
  readonly exec: (command: string) => Effect.Effect<unknown, Error>
}

export class Service extends Context.Service<Service, Interface>()("@cody/AgentHub") {}

const pairingCodes = new Map<string, PairingCode>()
const agents = new Map<string, PairedAgent>()
let nextCommandId = 1
const pendingCommands = new Map<number, PendingCommand>()

function generateCode(): string {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

function cleanupExpiredCodes(): void {
  const now = Date.now()
  for (const [code, info] of pairingCodes) {
    if (now > info.expiresAt || info.used) {
      pairingCodes.delete(code)
    }
  }
}

const cleanupInterval = setInterval(() => cleanupExpiredCodes(), Duration.toMillis(Duration.minutes(1)))
if (typeof cleanupInterval.unref === "function") cleanupInterval.unref()

const createPairingCode = Effect.fn("AgentHub.createPairingCode")(function* () {
  cleanupExpiredCodes()

  let code: string
  do {
    code = generateCode()
  } while (pairingCodes.has(code))

  const now = Date.now()
  pairingCodes.set(code, {
    code,
    createdAt: now,
    expiresAt: now + Duration.toMillis(CODE_TTL_DURATION),
    used: false,
  })

  return code
})

const connectAgent = Effect.fn("AgentHub.connectAgent")(function* (
  code: string,
  write: AgentWriter,
  close: Effect.Effect<void>,
) {
  const pairing = pairingCodes.get(code)
  if (!pairing || pairing.used || Date.now() > pairing.expiresAt) {
    return false
  }

  pairing.used = true

  const agent: PairedAgent = {
    code,
    write,
    close,
    connectedAt: Date.now(),
  }
  agents.set(code, agent)

  return true
})

const disconnectAgent = Effect.fn("AgentHub.disconnectAgent")(function* (code: string) {
  const agent = agents.get(code)
  if (agent) {
    agents.delete(code)

    // Notify the remote PC that it was disconnected
    yield* agent.write(JSON.stringify({ type: "disconnect" })).pipe(Effect.catch(() => Effect.void))

    // Close the WebSocket connection
    yield* agent.close.pipe(Effect.catch(() => Effect.void))

    // Reject all pending commands for this agent
    for (const [id, pending] of pendingCommands) {
      pendingCommands.delete(id)
      yield* Deferred.fail(pending.deferred, new Error("Agent disconnected"))
    }
  }
})

const dispatch = Effect.fn("AgentHub.dispatch")(function* (message: AgentMessage, senderCode?: string) {
  switch (message.type) {
    case "result":
    case "error": {
      const pending = pendingCommands.get(message.id)
      if (pending) {
        pendingCommands.delete(message.id)
        if (message.type === "error") {
          yield* Deferred.fail(pending.deferred, new Error(message.error))
        } else {
          yield* Deferred.succeed(pending.deferred, message.data)
        }
      }
      break
    }
    case "pong": {
      if (senderCode) {
        const agent = agents.get(senderCode)
        if (agent) agent.lastPong = Date.now()
      }
      break
    }
    case "disconnect":
      break
  }
})

const sendCommand = (command: string, args: unknown): Effect.Effect<unknown, Error> =>
  Effect.gen(function* () {
    const agentsList = Array.from(agents.values())
    if (agentsList.length === 0) {
      return yield* Effect.fail(new Error("No agent connected"))
    }

    const agent = agentsList[0]
    const id = nextCommandId++
    const deferred = yield* Deferred.make<unknown, Error>()

    pendingCommands.set(id, { deferred })

    const message: HubMessage = { type: "command", id, command, args }
    const encoded = JSON.stringify(message)

    yield* agent.write(encoded).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.catch((err) => {
        pendingCommands.delete(id)
        return Effect.fail(err instanceof Error ? err : new Error("Write failed: " + String(err)))
      }),
    )

    const result = yield* Deferred.await(deferred).pipe(
      Effect.timeout(COMMAND_TIMEOUT_DURATION),
      Effect.catch(() => {
        pendingCommands.delete(id)
        return Effect.fail(new Error("Command timed out after " + Duration.toMillis(COMMAND_TIMEOUT_DURATION) + "ms"))
      }),
    )

    return result
  })

const getStatus = Effect.fn("AgentHub.getStatus")(function* () {
  const agentsList = Array.from(agents.values())
  if (agentsList.length === 0) {
    return { connected: false } as const
  }
  const agent = agentsList[0]
  return {
    connected: true,
    code: agent.code,
    pairedAt: agent.connectedAt,
  } as const
})

const instance: Interface = {
  createPairingCode: createPairingCode(),
  connectAgent: (code, write, close) => connectAgent(code, write, close),
  disconnectAgent: (code) => disconnectAgent(code),
  dispatch: (message, code) => dispatch(message, code),
  getStatus: getStatus(),
  listDir: (path) => sendCommand("list-dir", { path }),
  readFile: (path) => sendCommand("read-file", { path }),
  writeFile: (path, content) => sendCommand("write-file", { path, content }),
  exec: (command) => sendCommand("exec", { command }),
}

export const layer: Layer.Layer<Service> = Layer.succeed(Service, Service.of(instance))
