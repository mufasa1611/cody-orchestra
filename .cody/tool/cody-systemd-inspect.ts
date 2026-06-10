/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const CHECKS = {
  version: {
    title: "systemd version",
    local: ["systemctl", "--version"],
    remote: "systemctl --version",
  },
  failed: {
    title: "Failed systemd units",
    local: ["systemctl", "--no-pager", "--failed"],
    remote: "systemctl --no-pager --failed",
  },
  services: {
    title: "Running services",
    local: ["systemctl", "--no-pager", "--type=service", "--state=running"],
    remote: "systemctl --no-pager --type=service --state=running | head -80",
  },
  timers: {
    title: "Systemd timers",
    local: ["systemctl", "--no-pager", "list-timers", "--all"],
    remote: "systemctl --no-pager list-timers --all",
  },
  status: {
    title: "Unit status",
    local: ["systemctl", "--no-pager", "status"],
    remote: "systemctl --no-pager status",
    requiresUnit: true,
  },
  cat: {
    title: "Unit definition",
    local: ["systemctl", "--no-pager", "cat"],
    remote: "systemctl --no-pager cat",
    requiresUnit: true,
  },
  journal: {
    title: "Unit journal",
    local: ["journalctl", "--no-pager", "-u"],
    remote: "journalctl --no-pager -u",
    requiresUnit: true,
    supportsLines: true,
  },
} as const

type CheckName = keyof typeof CHECKS

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

function targetFor(host: string, user?: string) {
  return user ? `${user}@${host}` : host
}

function remoteCommand(check: (typeof CHECKS)[CheckName], unit?: string, lines?: number) {
  const parts = [check.remote]
  if (unit) parts.push(unit)
  if ("supportsLines" in check && check.supportsLines) parts.push("-n", String(lines ?? 120))
  return parts.join(" ")
}

function localCommand(check: (typeof CHECKS)[CheckName], unit?: string, lines?: number) {
  const parts = [...check.local]
  if (unit) parts.push(unit)
  if ("supportsLines" in check && check.supportsLines) parts.push("-n", String(lines ?? 120))
  return parts
}

export default tool({
  description:
    "Run a predefined read-only systemd inspection profile locally or over SSH. Does not accept arbitrary systemctl or journalctl commands.",
  args: {
    check: tool.schema
      .enum(Object.keys(CHECKS) as [CheckName, ...CheckName[]])
      .describe("The read-only inspection profile to run"),
    host: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._:-]+$/)
      .optional()
      .describe("Optional remote SSH host. If omitted, the profile runs locally."),
    user: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional()
      .describe("Optional SSH username"),
    port: tool.schema.number().int().min(1).max(65535).optional().describe("Optional SSH port"),
    unit: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9@_.:-]+$/)
      .optional()
      .describe("Required for unit-specific profiles such as status, cat, and journal"),
    journalLines: tool.schema
      .number()
      .int()
      .min(20)
      .max(300)
      .optional()
      .describe("Number of journal lines for the journal profile, default 120"),
    timeoutSeconds: tool.schema
      .number()
      .int()
      .min(1)
      .max(45)
      .optional()
      .describe("Maximum execution time in seconds, default 15"),
  },
  async execute(args) {
    const check = CHECKS[args.check]
    const timeoutMs = (args.timeoutSeconds ?? 15) * 1000

    if ("requiresUnit" in check && check.requiresUnit && !args.unit) {
      return `${args.check} requires a unit value, for example ssh.service.`
    }
    if (args.journalLines && args.check !== "journal") {
      return "journalLines is only used with the journal inspection profile."
    }

    const command = args.host
      ? [
          process.platform === "win32" ? "ssh.exe" : "ssh",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=8",
          ...(args.port ? ["-p", String(args.port)] : []),
          targetFor(args.host, args.user),
          remoteCommand(check, args.unit, args.journalLines),
        ]
      : localCommand(check, args.unit, args.journalLines)

    let proc: Bun.Subprocess<"pipe", "pipe", "inherit">
    try {
      proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      return [
        `Profile: ${check.title}`,
        `Command type: predefined read-only systemd`,
        "",
        `Failed to start command: ${error}`,
      ].join("\n")
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, timeoutMs)

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]).finally(() => clearTimeout(timer))

    return [
      `Profile: ${check.title}`,
      `Command type: predefined read-only systemd`,
      `Target: ${args.host ? targetFor(args.host, args.user) : "local host"}`,
      `Exit code: ${exitCode}${timedOut ? " (timed out)" : ""}`,
      "",
      "STDOUT:",
      truncate(stdout.trim() || "(empty)"),
      "",
      "STDERR:",
      truncate(stderr.trim() || "(empty)"),
    ].join("\n")
  },
})
