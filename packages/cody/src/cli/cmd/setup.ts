import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { InstallationVersion } from "@cody/core/installation/version"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { existsSync } from "fs"
import { execSync } from "child_process"

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

async function resolveCliBinary(): Promise<string | null> {
  const binName = "cody-x"
  try {
    const cmd = os.platform() === "win32" ? `where ${binName}` : `which ${binName}`
    const out = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim().split("\n")[0].trim()
    if (out) return out
  } catch {}
  return null
}

async function isAutoStartEnabled(): Promise<boolean> {
  const plat = os.platform()
  if (plat === "win32") {
    try {
      const out = execSync(
        `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Cody Pro" 2>nul`,
        { encoding: "utf8", timeout: 5000 },
      )
      return out.includes("Cody Pro")
    } catch {
      return false
    }
  }
  if (plat === "darwin") {
    const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.cody.plist")
    return existsSync(plist)
  }
  const desktop = path.join(os.homedir(), ".config", "autostart", "cody-pro.desktop")
  return existsSync(desktop)
}

async function enableAutoStart(): Promise<boolean> {
  const cliBin = await resolveCliBinary()
  if (!cliBin) return false

  const plat = os.platform()
  try {
    if (plat === "win32") {
      const escaped = `${cliBin} serve`.replace(/"/g, '\\"')
      execSync(
        `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Cody Pro" /t REG_SZ /d "${escaped}" /f`,
        { encoding: "utf8", timeout: 10000 },
      )
      return true
    }
    if (plat === "darwin") {
      const plistDir = path.join(os.homedir(), "Library", "LaunchAgents")
      await fs.mkdir(plistDir, { recursive: true })
      const plist = path.join(plistDir, "com.cody.plist")
      await fs.writeFile(
        plist,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cody</string>
  <key>ProgramArguments</key>
  <array>
    <string>${cliBin}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>\n`,
        "utf8",
      )
      execSync("launchctl load " + plist, { encoding: "utf8", timeout: 10000 })
      return true
    }
    const autoDir = path.join(os.homedir(), ".config", "autostart")
    await fs.mkdir(autoDir, { recursive: true })
    const autostart = path.join(autoDir, "cody-pro.desktop")
    await fs.writeFile(
      autostart,
      `[Desktop Entry]
Type=Application
Name=Cody Pro
Comment=AI coding assistant server
Exec=${cliBin} serve
X-GNOME-Autostart-enabled=true\n`,
      "utf8",
    )
    // Also create application menu entry so it appears in the launcher
    const appsDir = path.join(os.homedir(), ".local", "share", "applications")
    await fs.mkdir(appsDir, { recursive: true })
    const menuEntry = path.join(appsDir, "cody-pro.desktop")
    await fs.writeFile(
      menuEntry,
      `[Desktop Entry]
Type=Application
Name=Cody Pro
Comment=AI coding assistant server
Exec=${cliBin} serve
Terminal=false
Categories=Development;Utility;\n`,
      "utf8",
    )
    return true
  } catch {
    return false
  }
}

async function disableAutoStart(): Promise<boolean> {
  const plat = os.platform()
  try {
    if (plat === "win32") {
      execSync(
        `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "Cody Pro" /f 2>nul`,
        { encoding: "utf8", timeout: 10000 },
      )
      return true
    }
    if (plat === "darwin") {
      const plist = path.join(os.homedir(), "Library", "LaunchAgents", "com.cody.plist")
      execSync(`launchctl unload ${plist} 2>/dev/null || true`, { encoding: "utf8", timeout: 10000 })
      await fs.rm(plist, { force: true })
      return true
    }
    const desktop = path.join(os.homedir(), ".config", "autostart", "cody-pro.desktop")
    await fs.rm(desktop, { force: true })
    return true
  } catch {
    return false
  }
}

async function generateDefaultConfig(): Promise<boolean> {
  try {
    const dir = path.join(process.cwd(), ".cody", "generated")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, "cody.jsonc"),
      `// Cody Pro configuration
{
  "\$schema": "https://opencode.ai/schema/cody.jsonc",
  "models": {
    "provider": "auto"
  },
  "server": {
    "port": 4097
  }
}
`,
      "utf8",
    )
    return true
  } catch {
    return false
  }
}

export const SetupCommand = {
  command: "setup",
  describe: "first-run setup wizard — check health, configure auto-start, proxy, and more",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    UI.empty()
    prompts.intro("Cody X Setup")

    const method = await Installation.method()
    prompts.log.info(`Installation method: ${method}`)
    prompts.log.info(`Version: ${InstallationVersion}`)
    prompts.log.info(`Platform: ${os.platform()} ${os.arch()}`)
    UI.empty()

    // --- Health checks ---
    const checks: Array<{ label: string; result: CheckResult }> = []

    const bunCheck = checkExecutable("bun")
    checks.push({ label: "Bun", result: bunCheck })

    const gitCheck = checkExecutable("git")
    checks.push({ label: "Git", result: gitCheck })

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
    checks.push({ label: "Native binary", result: binCheck })

    const proxyEnabled = process.env.CODY_PROXY_ENABLED === "1"
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ""
    checks.push({
      label: "Proxy",
      result: proxyEnabled && proxyUrl ? { ok: true, detail: proxyUrl } : { ok: false, detail: "not configured" },
    })

    const ollamaCheck = checkExecutable("ollama")
    checks.push({ label: "Ollama", result: ollamaCheck })

    const autoStart = await isAutoStartEnabled()
    checks.push({ label: "Auto-start", result: { ok: autoStart } })

    UI.println(`  ${UI.Style.TEXT_DIM}System Health:${UI.Style.TEXT_NORMAL}`)
    for (const c of checks) {
      const icon = c.result.ok ? "✓" : "✗"
      const detail = c.result.detail ? ` (${c.result.detail})` : ""
      const color = c.result.ok ? UI.Style.TEXT_SUCCESS : UI.Style.TEXT_WARNING
      UI.println(`  ${color}${icon} ${c.label}${detail}${UI.Style.TEXT_NORMAL}`)
    }
    UI.empty()

    // --- Auto-start configuration ---
    if (!autoStart) {
      const wantAuto = await prompts.select({
        message: "Start Cody Pro automatically when you log in?",
        options: [
          { label: "Yes", value: true, hint: "recommended for background server" },
          { label: "No", value: false },
        ],
        initialValue: true,
      })
      if (prompts.isCancel(wantAuto)) {
        prompts.outro("Cancelled")
        return
      }
      if (wantAuto) {
        const spin = prompts.spinner()
        spin.start("Configuring auto-start...")
        const ok = await enableAutoStart()
        if (ok) spin.stop("Auto-start configured")
        else spin.stop("Failed to configure auto-start", 1)
      }
    } else {
      const wantRemove = await prompts.select({
        message: "Auto-start is currently enabled. Keep it?",
        options: [
          { label: "Keep enabled", value: false },
          { label: "Disable", value: true },
        ],
        initialValue: false,
      })
      if (prompts.isCancel(wantRemove)) {
        prompts.outro("Cancelled")
        return
      }
      if (wantRemove) {
        const spin = prompts.spinner()
        spin.start("Disabling auto-start...")
        const ok = await disableAutoStart()
        if (ok) spin.stop("Auto-start disabled")
        else spin.stop("Failed to disable auto-start", 1)
      }
    }

    // --- Proxy configuration ---
    if (!proxyEnabled || !proxyUrl) {
      const wantProxy = await prompts.select({
        message: "Configure a network proxy for remote access?",
        options: [
          { label: "Yes", value: true, hint: "for connecting from other devices" },
          { label: "No", value: false, hint: "local-only use" },
        ],
        initialValue: false,
      })
      if (prompts.isCancel(wantProxy)) {
        prompts.outro("Cancelled")
        return
      }
      if (wantProxy) {
        const proxyInput = await prompts.text({
          message: "Proxy URL (e.g. https://your-server:9999):",
          placeholder: "https://",
          validate: (v) => (v ? undefined : "Proxy URL is required"),
        })
        if (prompts.isCancel(proxyInput)) {
          prompts.outro("Cancelled")
          return
        }
        prompts.log.info(`Set CODY_PROXY_ENABLED=1 and HTTPS_PROXY=${proxyInput} in your shell profile or .env`)
        prompts.log.step("Add the following to your shell profile (~/.bashrc, ~/.zshrc, etc.):")
        prompts.log.info(`  export CODY_PROXY_ENABLED=1`)
        prompts.log.info(`  export HTTPS_PROXY=${proxyInput}`)
        UI.empty()
      }
    }

    // --- Ollama installation suggestion ---
    if (!ollamaCheck.ok) {
      const wantOllama = await prompts.select({
        message: "Ollama (local AI models) is not installed. Install it?",
        options: [
          { label: "Yes, show install instructions", value: true },
          { label: "Skip", value: false },
        ],
        initialValue: false,
      })
      if (prompts.isCancel(wantOllama)) {
        prompts.outro("Cancelled")
        return
      }
      if (wantOllama) {
        UI.empty()
        prompts.log.step("Install Ollama from:")
        if (os.platform() === "win32") {
          prompts.log.info("  Download from https://ollama.com/download/windows")
        } else if (os.platform() === "darwin") {
          prompts.log.info("  Download from https://ollama.com/download/mac")
        } else {
          prompts.log.info("  Run: curl -fsSL https://ollama.com/install.sh | sh")
        }
        UI.empty()
      }
    }

    // --- Config generation (if missing) ---
    const configPaths = [
      path.join(process.cwd(), ".cody", "generated", "cody.jsonc"),
      path.join(process.cwd(), ".cody", "generated", "cody.json"),
    ]
    let configMissing = true
    for (const cp of configPaths) {
      try {
        await fs.access(cp)
        configMissing = false
        break
      } catch {}
    }
    if (configMissing) {
      const wantConfig = await prompts.select({
        message: "No configuration file found. Generate a default one?",
        options: [
          { label: "Yes", value: true, hint: "creates .cody/generated/cody.jsonc" },
          { label: "No", value: false },
        ],
        initialValue: true,
      })
      if (prompts.isCancel(wantConfig)) {
        prompts.outro("Cancelled")
        return
      }
      if (wantConfig) {
        const spin = prompts.spinner()
        spin.start("Generating default config...")
        const ok = await generateDefaultConfig()
        if (ok) spin.stop("Default config created at .cody/generated/cody.jsonc")
        else spin.stop("Failed to generate config", 1)
      }
    }

    // --- Summary & next steps ---
    UI.empty()
    prompts.log.success("Setup complete!")
    UI.empty()
    prompts.log.step("Next steps:")
    prompts.log.info("  1. Start the server:  cody-x serve")
    prompts.log.info("  2. Open the web UI:   cody-x web")
    prompts.log.info("  3. Run diagnostics:   cody-x doctor")
    prompts.log.info("  4. Get help:          cody-x --help")
    UI.empty()
    prompts.outro("Happy coding with Cody X!")
  },
}
