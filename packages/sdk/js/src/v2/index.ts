export * from "./client.js"
export * from "./server.js"

import { createCodyClient } from "./client.js"
import { createCodyServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createCody(options?: ServerOptions) {
  const server = await createCodyServer({
    ...options,
  })

  const client = createCodyClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
