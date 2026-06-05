import type { Argv } from "yargs"
import { Global } from "@cody/core/global"
import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import os from "os"
import { execSync } from "child_process"
import { InstallationVersion } from "@cody/core/installation/version"

interface CheckResult {
  ok: boolean
  detail?: string
}

function checkExecutable(name: string): CheckResult {
  const paths = process.env.PATH?.split(path.delimiter) ?? []
  const isWin = os.platform() === "win32"
  const extensions = isWin ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""]
  for (const dir of paths) {
    for (const ext of extensions) {
      const full = path.join(dir, `${name}${ext}`)
      if (existsSync(full)) return { ok: true, detail: `${name} found` }
    }
  }
  return { ok: false, detail: `"${name}" not found on PATH` }
}

function checkPort(port: number): CheckResult {
  try {
    if (os.platform() === "win32") {
      const out = execSync(`netstat -an | findstr "LISTEN" | findstr ":${port} "`, {
        encoding: "utf8",
        timeout: 3000,
      }).trim()
      if (out) return { ok: true, detail: `Port ${port} is in use` }
    } else {
      const out = execSync(`lsof -i :${port} 2>/dev/null || ss -tlnp sport = :${port} 2>/dev/null`, {
        encoding: "utf8",
        timeout: 3000,
      }).trim()
      if (out) return { ok: true, detail: `Port ${port} is in use` }
    }
    return { ok: false, detail: `Port ${port} is free` }
  } catch {
    return { ok: false, detail: `Could not check port ${port}` }
  }
}

function style(label: string, result: CheckResult): string {
  const icon = result.ok ? "✓" : "✗"
  const detail = result.detail ? ` (${result.detail})` : ""
  return `${icon} ${label}${detail}`
}

function findNativeBinary(startDir: string): string | null {
  const platformMap: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" }
  const archMap: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" }
  const platform = platformMap[os.platform()] || os.platform()
  const arch = archMap[os.arch()] || os.arch()
  const base = `cody-${platform}-${arch}`
  const binary = platform === "windows" ? "cody.exe" : "cody"

  let current = startDir
  for (;;) {
    const modules = path.join(current, "node_modules")
    const candidate = path.join(modules, base, "bin", binary)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

export const DoctorCommand = {
  command: "doctor",
  describe: "run system diagnostics to check installation health",
  builder: (yargs: Argv) =>
    yargs.option("verbose", {
      alias: "v",
      type: "boolean",
      describe: "show detailed output for all checks",
      default: false,
    }),
  handler: async (args: { verbose?: boolean }) => {
    const verbose = Boolean(args.verbose)
    const results: string[] = []
    const errors: string[] = []

    results.push("")
    results.push(`  Cody version: ${InstallationVersion}`)
    results.push(`  Platform: ${os.platform()} ${os.arch()}`)
    results.push(`  Node/exec: ${process.execPath}`)
    results.push("")

    // 1. Check Bun
    const bunCheck = checkExecutable("bun")
    results.push(style("Bun", bunCheck))
    if (!bunCheck.ok) errors.push("Bun is not installed. Run: powershell irm https://bun.sh/install.ps1 | iex")

    // 2. Check Git
    const gitCheck = checkExecutable("git")
    results.push(style("Git", gitCheck))
    if (!gitCheck.ok) errors.push("Git is not installed. Required for auto-updates.")

    // 3. Check native binary
    const scriptDir = path.dirname(process.execPath)
    const cached = path.join(scriptDir, ".cody")
    let binCheck: CheckResult
    if (existsSync(cached)) {
      binCheck = { ok: true, detail: "cached binary" }
    } else {
      const checkDir = path.dirname(path.dirname(scriptDir))
      const found = findNativeBinary(checkDir)
      if (found) {
        binCheck = { ok: true, detail: path.basename(found) }
      } else {
        binCheck = { ok: false, detail: "native binary not found" }
      }
    }
    results.push(style("Native binary", binCheck))
    if (!binCheck.ok) errors.push("Native binary (.cody) not found. Did you run postinstall?")

    // 4. Check config file
    const configPaths = [
      path.join(Global.Path.config, "cody.jsonc"),
      path.join(process.cwd(), ".cody", "generated", "cody.jsonc"),
      path.join(process.cwd(), ".cody", "generated", "cody.json"),
    ]
    let configFound = false
    for (const cp of configPaths) {
      try {
        await fs.access(cp)
        const content = await fs.readFile(cp, "utf8")
        if (content.trim()) {
          results.push(style(`Config (${path.basename(cp)})`, { ok: true, detail: cp }))
          configFound = true
          break
        }
      } catch {
        // not found or unreadable, try next
      }
    }
    if (!configFound) {
      results.push(style("Config file", { ok: false, detail: "not found" }))
      errors.push("No config file found. Run `cody setup` or ensure-default-config.ps1")
    }

    // 5. Check proxy env
    const proxyEnabled = process.env.CODY_PROXY_ENABLED === "1"
    const httpsProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    if (proxyEnabled && httpsProxy) {
      results.push(style("Proxy configured", { ok: true, detail: httpsProxy }))
    } else {
      results.push(style("Proxy", { ok: false, detail: "not configured (OK for local-only use)" }))
    }

    // 6. Check cloudflared if proxy is enabled
    if (proxyEnabled) {
      const cfCheck = checkExecutable("cloudflared")
      results.push(style("cloudflared", cfCheck))
      if (!cfCheck.ok) errors.push("Proxy is enabled but cloudflared is not installed.")
    }

    // 7. Check port 4097
    const portCheck = checkPort(4097)
    if (portCheck.ok) {
      results.push(`✓ Port 4097 is in use (cody-x may be running)`)
    } else if (verbose) {
      results.push(`- Port 4097 is free (cody-x not running)`)
    }

    // 8. Check Ollama
    const ollamaCheck = checkExecutable("ollama")
    results.push(style("Ollama", ollamaCheck))

    // Print results
    for (const line of results) {
      process.stderr.write(line + "\n")
    }

    // Print summary
    if (errors.length === 0) {
      process.stderr.write(`\n  ✓ All checks passed. Cody is healthy.\n\n`)
    } else {
      process.stderr.write(`\n  ${errors.length} issue(s) found:\n\n`)
      for (const err of errors) {
        process.stderr.write(`  ✗ ${err}\n`)
      }
      process.stderr.write("\n")
      process.exitCode = 1
    }
  },
}
