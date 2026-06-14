export type ServerMode = "local" | "server"

export function serverMode(): ServerMode {
  return process.env["CODY_SERVER_MODE"] === "server" ? "server" : "local"
}

export function serverAuthRequired() {
  return serverMode() === "server"
}

export function isLoopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
}
