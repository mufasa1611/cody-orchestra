/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const BASE_URL = process.env.CODY_URL ?? "http://localhost:3001"

export default tool({
  description:
    "Write content to a file on a connected remote PC via the Cody Pro agent. Can overwrite existing files or create new ones."
    ,
  args: {
    path: tool.schema.string().describe("Absolute path to the file on the remote PC"),
    content: tool.schema.string().describe("Text content to write to the file"),
    encoding: tool.schema.enum(["utf-8", "base64"]).optional().default("utf-8").describe("Content encoding"),
  },
  async execute(args) {
    try {
      const res = await fetch(new URL("/agent/fs/write", BASE_URL), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: args.path,
          content: args.content,
          encoding: args.encoding === "base64" ? "base64" : undefined,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return "Error " + res.status + ": " + (text || res.statusText)
      }
      return "Successfully wrote " + args.content.length + " bytes to " + args.path
    } catch (err) {
      return "Failed to write remote file: " + err.message
    }
  },
})
