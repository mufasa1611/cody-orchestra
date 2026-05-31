import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/agent"

const ListDirQuery = Schema.Struct({ path: Schema.optional(Schema.String) })
const ReadFileQuery = Schema.Struct({ path: Schema.String })
const WriteFilePayload = Schema.Struct({ path: Schema.String, content: Schema.String, encoding: Schema.optional(Schema.String) })
const ExecPayload = Schema.Struct({ command: Schema.String })

const PairingCodeSchema = Schema.Struct({ code: Schema.String, expiresAt: Schema.Number })
const AgentStatusSchema = Schema.Struct({
  connected: Schema.Boolean,
  code: Schema.optional(Schema.String),
  pairedAt: Schema.optional(Schema.Number),
})
const RemoteFileNodeSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  type: Schema.Literals(["file", "directory"]),
  size: Schema.optional(Schema.Number),
  modifiedAt: Schema.optional(Schema.Number),
})
const RemoteFileListSchema = Schema.Struct({ files: Schema.Array(RemoteFileNodeSchema) })
const FileContentSchema = Schema.Struct({ content: Schema.String, encoding: Schema.optional(Schema.String) })
const WriteOutputSchema = Schema.Struct({ success: Schema.Boolean })
const ExecOutputSchema = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, exitCode: Schema.Number })
const DisconnectOutputSchema = Schema.Struct({ disconnected: Schema.Boolean })

export const AgentApi = HttpApi.make("agent")
  .add(
    HttpApiGroup.make("agent")
      .add(
        HttpApiEndpoint.post("createPair", `${root}/pair`, {
          success: described(PairingCodeSchema, "Pairing code created"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.createPairingCode",
            summary: "Create pairing code",
            description: "Generate a new one-time pairing code for remote PC connection.",
          }),
        ),
        HttpApiEndpoint.get("status", `${root}/status`, {
          success: described(AgentStatusSchema, "Agent connection status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.status",
            summary: "Get agent connection status",
            description: "Check if a remote PC agent is currently connected.",
          }),
        ),
        HttpApiEndpoint.get("listDir", `${root}/fs/list`, {
          success: described(RemoteFileListSchema, "Directory listing"), query: ListDirQuery,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.fs.list",
            summary: "List remote directory",
            description: "List files and directories on the connected remote PC.",
          }),
        ),
        HttpApiEndpoint.get("readFile", `${root}/fs/read`, {
          success: described(FileContentSchema, "File content"), query: ReadFileQuery,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.fs.read",
            summary: "Read remote file",
            description: "Read a file on the connected remote PC.",
          }),
        ),
        HttpApiEndpoint.post("writeFile", `${root}/fs/write`, {
          success: described(WriteOutputSchema, "Write result"), payload: WriteFilePayload,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.fs.write",
            summary: "Write remote file",
            description: "Write content to a file on the connected remote PC.",
          }),
        ),
        HttpApiEndpoint.post("exec", `${root}/exec`, {
          success: described(ExecOutputSchema, "Command result"), payload: ExecPayload,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.exec",
            summary: "Execute remote command",
            description: "Execute a shell command on the connected remote PC.",
          }),
        ),
        HttpApiEndpoint.post("disconnect", `${root}/disconnect`, {
          success: described(DisconnectOutputSchema, "Disconnect result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "agent.disconnect",
            summary: "Disconnect agent",
            description: "Disconnect the currently connected remote PC agent.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "agent",
          description: "Remote PC agent connection endpoints.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Cody Pro experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )


