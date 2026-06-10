/// <reference path="../env.d.ts" />
import { tool } from "@cody/plugin"

const CHECKS = {
  system: {
    title: "Windows system summary",
    command: [
      "$os = Get-CimInstance Win32_OperatingSystem",
      "$cs = Get-CimInstance Win32_ComputerSystem",
      "[pscustomobject]@{ Computer=$env:COMPUTERNAME; User=$env:USERNAME; OS=$os.Caption; Version=$os.Version; Build=$os.BuildNumber; Manufacturer=$cs.Manufacturer; Model=$cs.Model; RAM_GB=[math]::Round($cs.TotalPhysicalMemory/1GB,2); LastBoot=$os.LastBootUpTime } | Format-List | Out-String -Width 200",
    ].join("; "),
  },
  drives: {
    title: "Local drive summary",
    command:
      "Get-PSDrive -PSProvider FileSystem | Select-Object Name,Root,@{n='UsedGB';e={[math]::Round($_.Used/1GB,2)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}} | Format-Table -AutoSize | Out-String -Width 200",
  },
  network: {
    title: "Network IP configuration",
    command:
      "Get-NetIPConfiguration | Select-Object InterfaceAlias,InterfaceDescription,IPv4Address,IPv4DefaultGateway,DNSServer | Format-List | Out-String -Width 220",
  },
  processes: {
    title: "Top processes by CPU",
    command:
      "Get-Process | Sort-Object CPU -Descending | Select-Object -First 25 Id,ProcessName,CPU,WorkingSet64,Path | Format-Table -AutoSize | Out-String -Width 240",
  },
  services: {
    title: "Running services",
    command:
      "Get-Service | Where-Object Status -eq 'Running' | Sort-Object Name | Select-Object -First 80 Status,Name,DisplayName | Format-Table -AutoSize | Out-String -Width 240",
  },
  docker: {
    title: "Docker status",
    command:
      "if (Get-Command docker -ErrorAction SilentlyContinue) { docker version; docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' } else { 'docker executable not found on PATH' }",
  },
} as const

type CheckName = keyof typeof CHECKS

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

export default tool({
  description:
    "Run a predefined read-only Windows inspection profile. Does not accept arbitrary PowerShell and does not mutate the system.",
  args: {
    check: tool.schema
      .enum(Object.keys(CHECKS) as [CheckName, ...CheckName[]])
      .describe("The read-only inspection profile to run"),
    timeoutSeconds: tool.schema
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Maximum execution time in seconds, default 15"),
  },
  async execute(args) {
    if (process.platform !== "win32") {
      return "cody-windows-inspect is only available on Windows."
    }

    const check = CHECKS[args.check]
    const timeoutMs = (args.timeoutSeconds ?? 15) * 1000
    const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", check.command], {
      stdout: "pipe",
      stderr: "pipe",
    })

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
      `Command type: predefined read-only PowerShell`,
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
