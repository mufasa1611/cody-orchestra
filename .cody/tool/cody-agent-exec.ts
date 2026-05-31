/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const BASE_URL = process.env.CODY_URL ?? "http://localhost:3001"

export default tool({
  description:
    "Execute a shell command on a connected remote PC via the Cody Pro agent. Returns stdout, stderr, and exit code."
    ,
  args: {
    command: tool.schema.string().describe("Shell command to execute on the remote PC"),
  },
  async execute(args) {
    try {
      const res = await fetch(new URL("/agent/exec", BASE_URL), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: args.command }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        return "Error " + res.status + ": " + (text || res.statusText)
      }
      const data = await res.json()
      let output = ""
      if (data.stdout) output += "STDOUT:\n" + data.stdout + "\n"
      if (data.stderr) output += "STDERR:\n" + data.stderr + "\n"
      output += "Exit code: " + data.exitCode
      return output
    } catch (err) {
      return "Failed to execute remote command: " + err.message
    }
  },
})
