import { createCodyClient } from "@cody/sdk/v2/client"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "cody-pro"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "cody-pro",
    password: decoded.slice(separator + 1),
  }
}

export function authHeadersForServer(server: ServerConnection.HttpBase): HeadersInit | undefined {
  if (server.token) {
    return { Authorization: `Bearer ${server.token}` }
  }
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

export function fetchForServer(server: ServerConnection.HttpBase, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  return (path: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const auth = authHeadersForServer(server)
    if (auth) {
      for (const [key, value] of Object.entries(auth)) headers.set(key, value)
    }
    const url = path instanceof URL ? path : new URL(path, server.url)
    return fetcher(url, { ...init, headers })
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createCodyClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = authHeadersForServer(server)

  return createCodyClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}
