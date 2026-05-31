// Agent protocol types for the remote PC connection system

// === Agent → Hub messages ===
export type AgentMessage =
  | { type: "pair"; code: string }
  | { type: "result"; id: number; data: unknown }
  | { type: "error"; id: number; error: string }
  | { type: "pong" }
  | { type: "disconnect" }

// === Hub → Agent messages ===
export type HubMessage =
  | { type: "paired" }
  | { type: "pair-error"; error: string }
  | { type: "command"; id: number; command: string; args: unknown }
  | { type: "ping" }
  | { type: "disconnect" }

// === REST API types ===
export interface CreatePairingResponse {
  code: string
  expiresAt: number
}

export interface AgentStatusResponse {
  connected: boolean
  pairedAt?: number
  remotePlatform?: string
  remoteHostname?: string
}

export interface RemoteFileNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modifiedAt?: number
}

export interface AgentListDirResponse {
  files: RemoteFileNode[]
}

export interface AgentReadFileResponse {
  content: string
  encoding?: "base64"
  mimeType?: string
}

export interface AgentWriteFileResponse {
  success: boolean
}

export interface AgentExecResponse {
  stdout: string
  stderr: string
  exitCode: number
}

// === Command constants ===
export const AGENT_COMMANDS = {
  LIST_DIR: "list-dir",
  READ_FILE: "read-file",
  WRITE_FILE: "write-file",
  EXEC: "exec",
} as const
