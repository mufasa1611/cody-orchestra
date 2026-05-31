/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const BASE_URL = process.env.CODY_URL ?? "http://localhost:3001"

export default tool({
  description:
    "Read the contents of a file on a connected remote PC via the Cody Pro agent. Returns the file content as text."
    ,
  args: {
    path: tool.schema.string().describe("Absolute path to the file on the remote PC"),
  },
  async execute(args) {
    const url = new URL("/agent/fs/read", BASE_URL)
    url.searchParams.set("path", args.path)

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return "Error " + res.status + ": " + (text || res.statusText)
      }
      const data = await res.json()
      if (data.encoding === "base64") {
        const decoded = Buffer.from(data.content, "base64").toString("utf-8")
        return decoded
      }
      return data.content ?? "(empty file)"
    } catch (err) {
      return "Failed to read remote file: " + err.message
    }
  },
})
