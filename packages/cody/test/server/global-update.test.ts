import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@cody/core/flag/flag"
import { Server } from "../../src/server/server"
import * as Log from "@cody/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

const original = Flag.CODY_EXPERIMENTAL_HTTPAPI

function app() {
  return Server.Default().app
}

async function readFirstChunk(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)),
  ])
  await reader.cancel()
  return new TextDecoder().decode(result.value)
}

async function readFirstEvent(response: Response) {
  return JSON.parse((await readFirstChunk(response)).replace(/^data: /, ""))
}

afterEach(async () => {
  Flag.CODY_EXPERIMENTAL_HTTPAPI = original
  await disposeAllInstances()
  await resetDatabase()
})

describe("global update routes", () => {
  test("GET /global/health returns healthy status", async () => {
    const response = await app().request("/global/health")
    expect(response.status).toBe(200)
    const body = await response.json() as { healthy: boolean; version: string }
    expect(body).toMatchObject({ healthy: true })
    expect(typeof body.version).toBe("string")
  })

  test("POST /global/git-check returns updateAvailable boolean", async () => {
    const response = await app().request("/global/git-check", { method: "POST" })
    expect(response.status).toBe(200)
    const body = await response.json() as { updateAvailable: boolean }
    expect(body).toMatchObject({ updateAvailable: expect.any(Boolean) })
  })

  test("GET /global/event returns SSE stream with server.connected event", async () => {
    const response = await app().request("/global/event")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform")
    const event = await readFirstEvent(response)
    expect(event.payload).toMatchObject({ type: "server.connected", properties: {} })
  })

  test("POST /global/upgrade returns error when installation method unknown", async () => {
    const response = await app().request("/global/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const body = await response.json() as { success: boolean; error?: string }
    expect(body).toMatchObject({ success: false })
  })
})
