import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import * as Shared from "@/server/agent/shared"

const CommonDescription =
  " Only available when a remote PC is paired via Connect My PC." +
  " Generate a pairing code in Settings > Connect My PC, then run `bunx cody-connect <CODE>` on the target PC."

function formatFileList(data: { files?: Array<{ name: string; type: string; size?: number }> }): string {
  if (!data.files || data.files.length === 0) return "(empty directory)"
  const lines = data.files.map((f) => {
    const icon = f.type === "directory" ? "📁" : "📄"
    return `${icon} ${f.name}${f.size != null ? ` (${f.size} bytes)` : ""}`
  })
  return lines.join("\n")
}

const RemoteLsTool = Tool.define(
  "remote_ls",
  Effect.gen(function* () {
    return {
      description: "List files and directories on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "The directory path to list on the remote PC" }),
      }),
      execute: (params: { path: string }) =>
        Effect.gen(function* () {
          const hub = Shared.getRemoteHub()
          if (!hub) return yield* Effect.fail(new Error("No remote PC connected"))
          const result = yield* hub.listDir(params.path)
          return { output: formatFileList(result as any), title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteReadTool = Tool.define(
  "remote_read",
  Effect.gen(function* () {
    return {
      description: "Read the contents of a file on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "Absolute path to the file on the remote PC" }),
      }),
      execute: (params: { path: string }) =>
        Effect.gen(function* () {
          const hub = Shared.getRemoteHub()
          if (!hub) return yield* Effect.fail(new Error("No remote PC connected"))
          const result = yield* hub.readFile(params.path)
          const data = result as { content: string; encoding?: string }
          return { output: data.content, title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteWriteTool = Tool.define(
  "remote_write",
  Effect.gen(function* () {
    return {
      description: "Write content to a file on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        path: Schema.String.annotate({ description: "Absolute path to the file on the remote PC" }),
        content: Schema.String.annotate({ description: "Content to write to the file" }),
      }),
      execute: (params: { path: string; content: string }) =>
        Effect.gen(function* () {
          const hub = Shared.getRemoteHub()
          if (!hub) return yield* Effect.fail(new Error("No remote PC connected"))
          yield* hub.writeFile(params.path, params.content)
          return { output: "File written successfully", title: `remote: ${params.path}`, metadata: {} }
        }).pipe(Effect.orDie),
    }
  }),
)

const RemoteBashTool = Tool.define(
  "remote_bash",
  Effect.gen(function* () {
    return {
      description: "Execute a shell command on the connected remote PC." + CommonDescription,
      parameters: Schema.Struct({
        command: Schema.String.annotate({ description: "Shell command to execute on the remote PC" }),
      }),
      execute: (params: { command: string }) =>
        Effect.gen(function* () {
          const hub = Shared.getRemoteHub()
          if (!hub) return yield* Effect.fail(new Error("No remote PC connected"))
          const result = yield* hub.exec(params.command)
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
