/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const CHECKS = {
  version: {
    title: "Docker version",
    args: ["version"],
  },
  contexts: {
    title: "Docker contexts",
    args: ["context", "ls"],
  },
  containers: {
    title: "Container status",
    args: ["ps", "--all", "--format", "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
  },
  images: {
    title: "Docker images",
    args: ["images", "--format", "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}"],
  },
  volumes: {
    title: "Docker volumes",
    args: ["volume", "ls"],
  },
  networks: {
    title: "Docker networks",
    args: ["network", "ls"],
  },
  system: {
    title: "Docker disk usage",
    args: ["system", "df"],
  },
  compose: {
    title: "Docker Compose project status",
    args: ["compose", "ps", "--all"],
  },
} as const

type CheckName = keyof typeof CHECKS

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

export default tool({
  description:
    "Run a predefined read-only Docker inspection profile. Does not accept arbitrary Docker arguments and does not mutate containers, images, volumes, or networks.",
  args: {
    check: tool.schema
      .enum(Object.keys(CHECKS) as [CheckName, ...CheckName[]])
      .describe("The read-only inspection profile to run"),
    projectPath: tool.schema
      .string()
      .regex(/^[^<>"|?*\r\n]+$/)
      .optional()
      .describe("Optional working directory for the compose profile"),
    timeoutSeconds: tool.schema
      .number()
      .int()
      .min(1)
      .max(45)
      .optional()
      .describe("Maximum execution time in seconds, default 15"),
  },
  async execute(args) {
    if (args.projectPath && args.check !== "compose") {
      return "projectPath is only used with the compose inspection profile."
    }

    const check = CHECKS[args.check]
    const docker = process.platform === "win32" ? "docker.exe" : "docker"
    const timeoutMs = (args.timeoutSeconds ?? 15) * 1000

    let proc: Bun.Subprocess<"pipe", "pipe", "inherit">
    try {
      proc = Bun.spawn([docker, ...check.args], {
        cwd: args.projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      return [
        `Profile: ${check.title}`,
        `Command type: predefined read-only Docker`,
        "",
        `Failed to start Docker: ${error}`,
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
      `Command type: predefined read-only Docker`,
      `Working directory: ${args.projectPath ?? process.cwd()}`,
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
