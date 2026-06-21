import { describe, expect, test } from "bun:test"
import { createLocalCliFetch } from "@/cli/cmd/run/local-fetch"

describe("run local CLI fetch", () => {
  test("marks every in-process request as trusted local CLI traffic", async () => {
    let seen: Request | undefined
    const fetch = createLocalCliFetch((request) => {
      seen = request
      return new Response("ok")
    })

    await fetch("http://cody.internal/session/ses_test", {
      headers: {
        "x-existing-header": "kept",
      },
    })

    expect(seen?.headers.get("x-cody-cli-local")).toBe("1")
    expect(seen?.headers.get("x-existing-header")).toBe("kept")
  })
})
