import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as AgentHub from "@/server/agent/hub"

const CommonDescription =
  " Only available when a remote PC is paired via Connect My PC." +
  " Pair it from Settings > Connect My PC by running `bunx --yes cody-connect@latest <PAIRING_CODE>` on the target PC." +
  " Do not instruct the user to install or run the codyx TUI; cody-connect is the remote PC agent."

function formatFileList(data: { files?: Array<{ name: string; type: string; size?: number }> }): string {
  if (!data.files || data.files.length === 0) return "(empty directory)"
  const lines = data.files.map((f) => {
    const icon = f.type === "directory" ? "📁" : "📄"
    return `${icon} ${f.name}${f.size != null ? ` (${f.size} bytes)` : ""}`
  })
  return lines.join("\n")
}

const RemoteLsTool = Tool.define(
  "cody-agent-list",
  Effect.gen(function* () {
    return {
      description: "List files and directories on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "The directory path to list on the remote PC" }),
      }),
      execute: (params: { path: string }) =>
        Effect.gen(function* () {
          const result = yield* AgentHub.service.listDir(params.path)
          return { output: formatFileList(result as any), title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteReadTool = Tool.define(
  "cody-agent-read",
  Effect.gen(function* () {
    return {
      description: "Read the contents of a file on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "Absolute path to the file on the remote PC" }),
      }),
      execute: (params: { path: string }) =>
        Effect.gen(function* () {
          const result = yield* AgentHub.service.readFile(params.path)
          const data = result as { content: string; encoding?: string }
          return { output: data.content, title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteWriteTool = Tool.define(
  "cody-agent-write",
  Effect.gen(function* () {
    return {
      description: "Write content to a file on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "Absolute path to the file on the remote PC" }),
        content: Schema.String.annotate({ description: "Content to write to the file" }),
      }),
      execute: (params: { path: string; content: string }) =>
        Effect.gen(function* () {
          yield* AgentHub.service.writeFile(params.path, params.content)
          return { output: "File written successfully", title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteBashTool = Tool.define(
  "cody-agent-exec",
  Effect.gen(function* () {
    return {
      description: "Execute a shell command on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        command: Schema.String.annotate({ description: "Shell command to execute on the remote PC" }),
      }),
      execute: (params: { command: string }) =>
        Effect.gen(function* () {
          const result = yield* AgentHub.service.exec(params.command)
          const r = result as { stdout: string; stderr: string; exitCode: number }
          let output = ""
          if (r.stdout) output += r.stdout
          if (r.stderr) output += "\n" + r.stderr
          if (r.exitCode !== 0) output += `\nExit code: ${r.exitCode}`
          return { output: output || "(no output)", title: `remote: ${params.command.substring(0, 40)}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

export { RemoteLsTool, RemoteReadTool, RemoteWriteTool, RemoteBashTool }
