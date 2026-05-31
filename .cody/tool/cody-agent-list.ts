/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const BASE_URL = process.env.CODY_URL ?? "http://localhost:3001"

export default tool({
  description:
    "List files and directories on a connected remote PC via the Cody Pro agent. Shows detailed file info including size and modification time.",
  args: {
    path: tool.schema.string().optional().default("/").describe("Directory path to list on the remote PC"),
  },
  async execute(args) {
    const url = new URL("/agent/fs/list", BASE_URL)
    url.searchParams.set("path", args.path)

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return `Error ${res.status}: ${text || res.statusText}`
      }
      const data = await res.json()
      if (!data.files || data.files.length === 0) {
        return "No files found in directory."
      }
      const lines = data.files.map((f) => {
        const type = f.type === "directory" ? "📁" : "📄"
        const size = f.size != null ? ` ${formatSize(f.size)}` : ""
        const modified = f.modifiedAt ? ` [${new Date(f.modifiedAt).toISOString()}]` : ""
        return `${type} ${f.name}${size}${modified}`
      })
      return [`Directory listing of ${args.path}:`, ...lines].join("\n")
    } catch (err) {
      return `Failed to list remote directory: ${err.message}`
    }
  },
})

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}
