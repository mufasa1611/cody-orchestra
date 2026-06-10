/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const CHECKS = {
  client: {
    title: "Local SSH client version",
    command: "",
  },
  system: {
    title: "Remote system summary",
    command: "uname -a; uptime; whoami; hostname",
  },
  disk: {
    title: "Remote disk usage",
    command: "df -hT",
  },
  memory: {
    title: "Remote memory summary",
    command: "free -h 2>/dev/null || vm_stat 2>/dev/null || echo 'memory summary command not available'",
  },
  processes: {
    title: "Remote top processes",
    command: "ps aux --sort=-%cpu 2>/dev/null | head -30 || ps aux | head -30",
  },
  docker: {
    title: "Remote Docker summary",
    command: "command -v docker >/dev/null 2>&1 && { docker ps; docker system df; } || echo 'docker executable not found'",
  },
  services: {
    title: "Remote running services",
    command:
      "command -v systemctl >/dev/null 2>&1 && systemctl --no-pager --type=service --state=running | head -80 || echo 'systemctl not available'",
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

export default tool({
  description:
    "Run a predefined read-only SSH inspection profile. Does not accept arbitrary remote shell commands and does not mutate the remote host.",
  args: {
    check: tool.schema
      .enum(Object.keys(CHECKS) as [CheckName, ...CheckName[]])
      .describe("The read-only inspection profile to run"),
    host: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._:-]+$/)
      .optional()
      .describe("Remote host for non-client checks, for example server.local or 192.168.1.20"),
    user: tool.schema
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional()
      .describe("Optional SSH username"),
    port: tool.schema.number().int().min(1).max(65535).optional().describe("Optional SSH port"),
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
    const ssh = process.platform === "win32" ? "ssh.exe" : "ssh"
    const timeoutMs = (args.timeoutSeconds ?? 15) * 1000

    if (args.check !== "client" && !args.host) {
      return "Host is required for remote SSH inspection profiles."
    }

    const command =
      args.check === "client"
        ? [ssh, "-V"]
        : [
            ssh,
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=8",
            ...(args.port ? ["-p", String(args.port)] : []),
            targetFor(args.host!, args.user),
            check.command,
          ]

    let proc: Bun.Subprocess<"pipe", "pipe", "inherit">
    try {
      proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      return [`Profile: ${check.title}`, `Command type: predefined read-only SSH`, "", `Failed to start SSH: ${error}`].join(
        "\n",
      )
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
      `Command type: predefined read-only SSH`,
      `Target: ${args.check === "client" ? "local client" : targetFor(args.host!, args.user)}`,
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
