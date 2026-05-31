/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const CHECKS = {
  version: {
    title: "Proxmox version",
    path: "/api2/json/version",
  },
  nodes: {
    title: "Proxmox nodes",
    path: "/api2/json/nodes",
  },
  cluster: {
    title: "Cluster status",
    path: "/api2/json/cluster/status",
  },
  resources: {
    title: "Cluster resources",
    path: "/api2/json/cluster/resources",
  },
  storage: {
    title: "Storage configuration",
    path: "/api2/json/storage",
  },
  guestStatus: {
    title: "Guest status",
    requiresGuest: true,
  },
  guestConfig: {
    title: "Guest config",
    requiresGuest: true,
  },
  snapshots: {
    title: "Guest snapshots",
    requiresGuest: true,
  },
  backups: {
    title: "Storage backups",
    requiresStorage: true,
  },
} as const

type CheckName = keyof typeof CHECKS
type GuestKind = "qemu" | "lxc"

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "")
}

function guestPath(check: CheckName, guestKind: GuestKind, node: string, vmid: number) {
  const base = `/api2/json/nodes/${encodeURIComponent(node)}/${guestKind}/${vmid}`
  if (check === "guestStatus") return `${base}/status/current`
  if (check === "guestConfig") return `${base}/config`
  return `${base}/snapshot`
}

function backupsPath(node: string, storage: string) {
  return `/api2/json/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=backup`
}

export default tool({
  description:
    "Run a predefined read-only Proxmox API inspection profile. Does not accept arbitrary API paths and does not mutate nodes, guests, storage, or cluster configuration.",
  args: {
    check: tool.schema
      .enum(Object.keys(CHECKS) as [CheckName, ...CheckName[]])
      .describe("The read-only inspection profile to run"),
    endpoint: tool.schema
      .string()
      .url()
      .optional()
      .describe("Proxmox base URL, for example https://pve.local:8006. Defaults to CODY_PROXMOX_URL"),
    tokenId: tool.schema
      .string()
      .optional()
      .describe("Proxmox API token id. Defaults to CODY_PROXMOX_TOKEN_ID"),
    tokenSecret: tool.schema
      .string()
      .optional()
      .describe("Proxmox API token secret. Defaults to CODY_PROXMOX_TOKEN_SECRET"),
    node: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional()
      .describe("Required for guest and backup checks"),
    guestKind: tool.schema.enum(["qemu", "lxc"]).optional().describe("Guest type for guest checks"),
    vmid: tool.schema.number().int().min(1).max(999999999).optional().describe("VMID or CTID for guest checks"),
    storage: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional()
      .describe("Storage id for backup checks"),
    timeoutSeconds: tool.schema
      .number()
      .int()
      .min(1)
      .max(45)
      .optional()
      .describe("Maximum execution time in seconds, default 15"),
  },
  async execute(args) {
    const endpoint = args.endpoint ?? process.env.CODY_PROXMOX_URL
    const tokenId = args.tokenId ?? process.env.CODY_PROXMOX_TOKEN_ID
    const tokenSecret = args.tokenSecret ?? process.env.CODY_PROXMOX_TOKEN_SECRET
    const check = CHECKS[args.check]

    if (!endpoint || !tokenId || !tokenSecret) {
      return [
        `Profile: ${check.title}`,
        `Command type: predefined read-only Proxmox API`,
        "",
        "Missing Proxmox API configuration.",
        "Set CODY_PROXMOX_URL, CODY_PROXMOX_TOKEN_ID, and CODY_PROXMOX_TOKEN_SECRET or pass endpoint/tokenId/tokenSecret as tool args.",
      ].join("\n")
    }

    if ("requiresGuest" in check && check.requiresGuest && (!args.node || !args.guestKind || !args.vmid)) {
      return `${args.check} requires node, guestKind, and vmid.`
    }
    if ("requiresStorage" in check && check.requiresStorage && (!args.node || !args.storage)) {
      return `${args.check} requires node and storage.`
    }

    const path =
      args.check === "guestStatus" || args.check === "guestConfig" || args.check === "snapshots"
        ? guestPath(args.check, args.guestKind!, args.node!, args.vmid!)
        : args.check === "backups"
          ? backupsPath(args.node!, args.storage!)
          : "path" in check
            ? check.path
            : "/api2/json/version"

    const url = new URL(path, normalizeEndpoint(endpoint))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), (args.timeoutSeconds ?? 15) * 1000)

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
        },
        signal: controller.signal,
      })
      const text = await response.text()
      let output = text
      try {
        output = JSON.stringify(JSON.parse(text), null, 2)
      } catch {}

      return [
        `Profile: ${check.title}`,
        `Command type: predefined read-only Proxmox API`,
        `URL path: ${path}`,
        `HTTP status: ${response.status} ${response.statusText}`,
        "",
        truncate(output || "(empty)"),
      ].join("\n")
    } catch (error) {
      return [
        `Profile: ${check.title}`,
        `Command type: predefined read-only Proxmox API`,
        `URL path: ${path}`,
        "",
        `Request failed: ${error}`,
      ].join("\n")
    } finally {
      clearTimeout(timer)
    }
  },
})
