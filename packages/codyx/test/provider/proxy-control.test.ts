import { describe, expect, test } from "bun:test"
import { retryableError, retryableStatus, usageLimitResponse } from "../../src/provider/proxy-control"

describe("provider proxy control", () => {
  test("rotates only for temporary provider statuses", () => {
    expect(retryableStatus(429)).toBe(true)
    expect(retryableStatus(502)).toBe(true)
    expect(retryableStatus(503)).toBe(true)
    expect(retryableStatus(504)).toBe(true)
    expect(retryableStatus(401)).toBe(false)
    expect(retryableStatus(403)).toBe(false)
    expect(retryableStatus(404)).toBe(false)
  })

  test("classifies network and timeout errors as retryable", () => {
    expect(retryableError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true)
    expect(retryableError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }))).toBe(true)
    expect(retryableError(new DOMException("The operation was aborted", "AbortError"))).toBe(true)
    expect(retryableError(new Error("invalid api key"))).toBe(false)
  })

  test("detects usage-limit responses that should bypass proxy rotation", async () => {
    expect(
      await usageLimitResponse(
        new Response(JSON.stringify({ error: { type: "FreeUsageLimitError" } }), { status: 429 }),
      ),
    ).toBe(true)
    expect(
      await usageLimitResponse(
        new Response(JSON.stringify({ error: { type: "GoUsageLimitError" } }), { status: 429 }),
      ),
    ).toBe(true)
    expect(await usageLimitResponse(new Response("rate limit", { status: 429 }))).toBe(false)
    expect(
      await usageLimitResponse(
        new Response(JSON.stringify({ error: { type: "FreeUsageLimitError" } }), { status: 500 }),
      ),
    ).toBe(false)
  })
})
