import { Context, Deferred, Duration, Effect, Layer } from "effect"
import { UserRef } from "@/effect/instance-ref"
import * as Log from "@cody/core/util/log"
import type { AgentMessage, HubMessage } from "./types"

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const CODE_LENGTH = 6
const CODE_TTL_DURATION = Duration.minutes(5)
const AGENT_MAX_CONNECTION_DURATION = Duration.hours(24)
const CLIENT_LEASE_DURATION = Duration.seconds(60)
const COMMAND_TIMEOUT_DURATION = Duration.seconds(30)

interface PendingCommand {
  deferred: Deferred.Deferred<unknown, Error>
  code: string
  command: string
  startedAt: number
}

type AgentWriter = (data: string | Uint8Array) => Effect.Effect<void>

interface PairedAgent {
  code: string
  userID?: string
  write: AgentWriter
  close: Effect.Effect<void>
  connectedAt: number
  expiresAt: number
  remotePlatform?: string
  remoteHostname?: string
  lastPong?: number
  reconnectToken?: string
}

interface PairingCode {
  code: string
  userID?: string
  createdAt: number
  expiresAt: number
  used: boolean
}

export interface Interface {
  readonly createPairingCode: Effect.Effect<string>
  readonly connectAgent: (
    code: string,
    write: AgentWriter,
    close: Effect.Effect<void>,
    metadata?: { platform?: string; hostname?: string },
  ) => Effect.Effect<{ success: boolean; reconnectToken?: string }, Error>
  readonly reconnectAgent: (
    token: string,
    write: AgentWriter,
    close: Effect.Effect<void>,
    metadata?: { platform?: string; hostname?: string },
  ) => Effect.Effect<{ success: boolean; code?: string }, Error>
  readonly disconnectAgent: (code: string) => Effect.Effect<void>
  readonly touchClient: Effect.Effect<void>
  readonly dispatch: (message: AgentMessage, senderCode?: string) => Effect.Effect<void>
  readonly getStatus: Effect.Effect<{
    connected: boolean
    code?: string
    pairedAt?: number
    expiresAt?: number
    remotePlatform?: string
    remoteHostname?: string
    activeCommands?: number
    lastPong?: number
  }>
  readonly invalidateUserReconnectTokens: (userID: string) => Effect.Effect<void>
  readonly listDir: (path: string) => Effect.Effect<unknown, Error>
  readonly readFile: (path: string) => Effect.Effect<unknown, Error>
  readonly writeFile: (path: string, content: string) => Effect.Effect<unknown, Error>
  readonly exec: (command: string) => Effect.Effect<unknown, Error>
}

export class Service extends Context.Service<Service, Interface>()("@cody/AgentHub") {}

const pairingCodes = new Map<string, PairingCode>()
const agents = new Map<string, PairedAgent>()
const clientHeartbeats = new Map<string, number>()
const reconnectTokens = new Map<string, string>() // token → agent code
let nextCommandId = 1
const pendingCommands = new Map<number, PendingCommand>()
const log = Log.create({ service: "agent-hub" })

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

function shouldDisconnectAgent(agent: PairedAgent, now = Date.now()) {
  if (now > agent.expiresAt) return true
  if (!agent.userID) return false
  const lastClientSeen = clientHeartbeats.get(agent.userID)
  return lastClientSeen !== undefined && now - lastClientSeen > Duration.toMillis(CLIENT_LEASE_DURATION)
}

function cleanupExpiredAgents(): void {
  const now = Date.now()
  for (const agent of agents.values()) {
    if (!shouldDisconnectAgent(agent, now)) continue
    Effect.runFork(disconnectAgent(agent.code))
  }
  // Clean up stale reconnect tokens for expired agents
  for (const [token, code] of reconnectTokens) {
    const agent = agents.get(code)
    if (!agent || now > agent.expiresAt) reconnectTokens.delete(token)
  }
}

function invalidateUserReconnectTokens(userID: string): void {
  for (const [token, code] of reconnectTokens) {
    const agent = agents.get(code)
    if (agent?.userID === userID) reconnectTokens.delete(token)
  }
}

const cleanupInterval = setInterval(() => {
  cleanupExpiredCodes()
  cleanupExpiredAgents()
}, Duration.toMillis(Duration.seconds(15)))
if (typeof cleanupInterval.unref === "function") cleanupInterval.unref()

// Keepalive: send ping to all connected agents every 30s to prevent
// client lease expiry when there is no active LLM interaction.
const keepaliveInterval = setInterval(() => {
  for (const agent of agents.values()) {
    Effect.runFork(
      agent.write(JSON.stringify({ type: "ping" })).pipe(Effect.catch(() => Effect.void)),
    )
  }
}, Duration.toMillis(Duration.seconds(30)))
if (typeof keepaliveInterval.unref === "function") keepaliveInterval.unref()

const createPairingCode = Effect.fn("AgentHub.createPairingCode")(function* () {
  cleanupExpiredCodes()
  const userID = yield* UserRef
  if (userID) clientHeartbeats.set(userID, Date.now())

  let code: string
  do {
    code = generateCode()
  } while (pairingCodes.has(code))

  const now = Date.now()
  pairingCodes.set(code, {
    code,
    userID,
    createdAt: now,
    expiresAt: now + Duration.toMillis(CODE_TTL_DURATION),
    used: false,
  })

  log.info("pairing code created", { code, userID, expiresIn: Duration.toMillis(CODE_TTL_DURATION) })
  return code
})

const connectAgent = Effect.fn("AgentHub.connectAgent")(function* (
  code: string,
  write: AgentWriter,
  close: Effect.Effect<void>,
  metadata?: { platform?: string; hostname?: string },
) {
  const pairing = pairingCodes.get(code)
  if (!pairing || pairing.used || Date.now() > pairing.expiresAt) {
    log.warn("pair rejected", { code, reason: !pairing ? "missing" : pairing.used ? "used" : "expired" })
    return { success: false }
  }

  pairing.used = true

  if (pairing.userID) {
    for (const existing of Array.from(agents.values())) {
      if (existing.userID === pairing.userID) {
        yield* disconnectAgent(existing.code)
      }
    }
  }

  const reconnectToken = generateCode()
  const agent: PairedAgent = {
    code,
    userID: pairing.userID,
    write,
    close,
    connectedAt: Date.now(),
    expiresAt: Date.now() + Duration.toMillis(AGENT_MAX_CONNECTION_DURATION),
    remotePlatform: metadata?.platform,
    remoteHostname: metadata?.hostname,
    reconnectToken,
  }
  if (pairing.userID) clientHeartbeats.set(pairing.userID, Date.now())
  agents.set(code, agent)
  reconnectTokens.set(reconnectToken, code)

  log.info("agent paired", {
    code,
    userID: pairing.userID,
    remotePlatform: metadata?.platform,
    remoteHostname: metadata?.hostname,
    expiresAt: agent.expiresAt,
    reconnectToken,
  })
  return { success: true, reconnectToken }
})

const reconnectAgent = Effect.fn("AgentHub.reconnectAgent")(function* (
  token: string,
  write: AgentWriter,
  close: Effect.Effect<void>,
  metadata?: { platform?: string; hostname?: string },
) {
  const code = reconnectTokens.get(token)
  if (!code) {
    log.warn("reconnect rejected", { token, reason: "token not found" })
    return { success: false }
  }
  const agent = agents.get(code)
  if (!agent || Date.now() > agent.expiresAt) {
    log.warn("reconnect rejected", { token, code, reason: agent ? "expired" : "no agent" })
    reconnectTokens.delete(token)
    return { success: false }
  }

  agent.write = write
  agent.close = close
  agent.connectedAt = Date.now()
  if (metadata) {
    agent.remotePlatform = metadata.platform
    agent.remoteHostname = metadata.hostname
  }
  if (agent.userID) clientHeartbeats.set(agent.userID, Date.now())

  log.info("agent reconnected", { code, token, userID: agent.userID })
  return { success: true, code }
})

const disconnectAgent = Effect.fn("AgentHub.disconnectAgent")(function* (code: string) {
  const agent = agents.get(code)
  if (agent) {
    agents.delete(code)
    log.info("agent disconnecting", {
      code,
      userID: agent.userID,
      remotePlatform: agent.remotePlatform,
      remoteHostname: agent.remoteHostname,
      pendingCommands: Array.from(pendingCommands.values()).filter((pending) => pending.code === code).length,
    })

    // Notify the remote PC that it was disconnected
    yield* agent.write(JSON.stringify({ type: "disconnect" })).pipe(Effect.catch(() => Effect.void))

    // Close the WebSocket connection
    yield* agent.close.pipe(Effect.catch(() => Effect.void))

    // Reject all pending commands for this agent
    for (const [id, pending] of pendingCommands) {
      if (pending.code !== code) continue
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
        log.info("agent command completed", {
          code: pending.code,
          id: message.id,
          command: pending.command,
          ok: message.type === "result",
          duration: Date.now() - pending.startedAt,
        })
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
        if (agent) {
          agent.lastPong = Date.now()
          if (agent.userID) clientHeartbeats.set(agent.userID, Date.now())
        }
      }
      break
    }
    case "disconnect":
      break
  }
})

const agentForCurrentUser = Effect.fn("AgentHub.agentForCurrentUser")(function* () {
  const userID = yield* UserRef
  if (!userID) return yield* Effect.fail(new Error("Authentication required for remote PC access"))
  cleanupExpiredAgents()
  const agentsList = Array.from(agents.values())
    .filter((agent) => agent.userID === userID)
    .filter((agent) => !shouldDisconnectAgent(agent))
    .sort((a, b) => b.connectedAt - a.connectedAt)
  return agentsList[0]
})

const touchClient = Effect.fn("AgentHub.touchClient")(function* () {
  const userID = yield* UserRef
  if (userID) clientHeartbeats.set(userID, Date.now())
})

const sendCommand = (command: string, args: unknown): Effect.Effect<unknown, Error> =>
  Effect.gen(function* () {
    const agent = yield* agentForCurrentUser()
    if (!agent) {
      return yield* Effect.fail(new Error("No agent connected"))
    }

    const id = nextCommandId++
    const deferred = yield* Deferred.make<unknown, Error>()

    pendingCommands.set(id, { deferred, code: agent.code, command, startedAt: Date.now() })

    const message: HubMessage = { type: "command", id, command, args }
    const encoded = JSON.stringify(message)
    log.info("agent command started", {
      code: agent.code,
      userID: agent.userID,
      id,
      command,
      remotePlatform: agent.remotePlatform,
      remoteHostname: agent.remoteHostname,
    })

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
        log.warn("agent command timed out", { code: agent.code, userID: agent.userID, id, command })
        return Effect.fail(new Error("Command timed out after " + Duration.toMillis(COMMAND_TIMEOUT_DURATION) + "ms"))
      }),
    )

    return result
  })

const getStatus = Effect.fn("AgentHub.getStatus")(function* () {
  const userID = yield* UserRef;
  log.info("status check", { userID, agentsCount: agents.size, activeAgents: Array.from(agents.values()).map(a => ({ code: a.code, user: a.userID })) });
  yield* touchClient()
  const agent = yield* agentForCurrentUser().pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!agent) {
    return { connected: false } as const
  }
  return {
    connected: true,
    code: agent.code,
    pairedAt: agent.connectedAt,
    expiresAt: agent.expiresAt,
    remotePlatform: agent.remotePlatform,
    remoteHostname: agent.remoteHostname,
    activeCommands: Array.from(pendingCommands.values()).filter((pending) => pending.code === agent.code).length,
    lastPong: agent.lastPong,
  } as const
})

export const service: Interface = {
  createPairingCode: createPairingCode(),
  connectAgent: (code, write, close, metadata) => connectAgent(code, write, close, metadata),
  reconnectAgent: (token, write, close, metadata) => reconnectAgent(token, write, close, metadata),
  disconnectAgent: (code) => disconnectAgent(code),
  touchClient: touchClient(),
  dispatch: (message, code) => dispatch(message, code),
  getStatus: getStatus(),
  invalidateUserReconnectTokens: (userID) => Effect.sync(() => invalidateUserReconnectTokens(userID)),
  listDir: (path) => sendCommand("list-dir", { path }),
  readFile: (path) => sendCommand("read-file", { path }),
  writeFile: (path, content) => sendCommand("write-file", { path, content }),
  exec: (command) => sendCommand("exec", { command }),
}

export const layer: Layer.Layer<Service> = Layer.succeed(Service, Service.of(service))
