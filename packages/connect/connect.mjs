#!/usr/bin/env bun

// codyx Remote Agent
// Usage: bunx cody-connect <PAIRING_CODE> [--ws <WEBSOCKET_URL>]
// Connects to the codyx WebSocket hub and serves local filesystem

import fs from "fs"
import path from "path"
import os from "os"
import { exec, execSync, spawnSync } from "child_process"

const DEFAULT_WS_URL = "wss://codyx.kingkung.men/ws/agent"

function parseArgs(argv) {
  let code
  let wsUrl = process.env.CODY_WS_URL || DEFAULT_WS_URL

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--ws" || arg === "--url") {
      wsUrl = argv[++i] || wsUrl
      continue
    }
    if (arg.startsWith("--ws=")) {
      wsUrl = arg.slice("--ws=".length)
      continue
    }
    if (arg.startsWith("--url=")) {
      wsUrl = arg.slice("--url=".length)
      continue
    }
    if (!code) code = arg
  }

  return { code, wsUrl }
}

const { code: mode, wsUrl: WS_URL } = parseArgs(process.argv.slice(2))
let ws
let reconnectTimer
let running = true
const activeChildren = new Set()

// --- Uninstall ---

if (mode === "--uninstall" || mode === "--cleanup") {
  if (process.platform === "win32" && !isWindowsAdmin()) elevateWindows("Elevating to administrator privileges for cleanup...")
  uninstallAll()
  process.exit(0)
}

if (!mode || mode.startsWith("--")) {
  console.error("Usage: bunx --yes cody-connect@latest <PAIRING_CODE> [--ws <WEBSOCKET_URL>]")
  console.error("       bunx --yes cody-connect@latest --uninstall")
  console.error("")
  console.error("Get a pairing code from codyx.kingkung.men > Settings > Connect My PC")
  console.error("")
  console.error("Example:")
  console.error("  bunx --yes cody-connect@latest ABC123")
  if (mode === "--help") console.log("  --uninstall  Remove all installed files, Bun, and cloned repo")
  process.exit(mode === "--help" ? 0 : 1)
}

// Auto-elevate on Windows if not already admin
if (process.platform === "win32" && !isWindowsAdmin()) {
  elevateWindows("Elevating to administrator privileges for full remote control...")
}

console.log("Cody Connect Agent (admin mode)")
startAgent(mode)

// --- Helper ---

function trySync(fn, fallback) {
  try { return fn() } catch { return fallback }
}

function isWindowsAdmin() {
  return trySync(() => {
    execSync("net session", { stdio: "ignore", timeout: 3000 })
    return true
  }, false)
}

function quoteWindowsArgument(value) {
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/, "$1$1")}"`
}

function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function elevateWindows(message) {
  console.log(message)
  const commandLine = process.argv.slice(1).map(quoteWindowsArgument).join(" ")
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    `$process = Start-Process -Verb RunAs -FilePath ${quotePowerShellLiteral(process.execPath)} -ArgumentList ${quotePowerShellLiteral(commandLine)} -Wait -PassThru`,
    "exit $process.ExitCode",
  ].join("\n")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { stdio: "inherit" },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

// --- Uninstall ---

function uninstallAll() {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const appData = process.env.APPDATA || (process.platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".local", "share"))
  const os = process.platform
  let removed = []

  // 1. Remove our temp scripts
  const tempDir = process.env.TEMP || process.env.TMPDIR || "/tmp"
  if (tempDir) {
    for (const f of fs.readdirSync(tempDir).filter(f => f.startsWith("cody-x-connect-") || f === "cody-x-connect.mjs")) {
      try { fs.rmSync(path.join(tempDir, f)); removed.push(path.join(tempDir, f)) } catch {}
    }
  }

  // 2. Remove config directory
  const configDir = os === "win32" ? path.join(process.env.APPDATA || "", "cody-connect") : path.join(home, ".cody-connect")
  if (fs.existsSync(configDir)) {
    try { fs.rmSync(configDir, { recursive: true, force: true }); removed.push(configDir) } catch {}
  }

  // 3. Remove cloned repo at default location
  const defaultRoot = os === "win32" ? path.join(process.env.LOCALAPPDATA || "", "cody-x") : path.join(home, ".local", "share", "cody-x")
  const repoDir = process.env.CODY_INSTALL_ROOT || defaultRoot
  if (fs.existsSync(repoDir) && fs.existsSync(path.join(repoDir, "package.json"))) {
    console.log(`Found cody-x installation at: ${repoDir}`)
    console.log("Removing...")
    try { fs.rmSync(repoDir, { recursive: true, force: true }); removed.push(repoDir) } catch (e) { console.error(`Failed to remove ${repoDir}: ${e.message}`) }
  }

  // 4. Remove bun (installed via our launcher)
  const bunDir = os === "win32" ? path.join(home, ".bun") : path.join(home, ".bun")
  if (fs.existsSync(bunDir)) {
    console.log(`Found Bun installation at: ${bunDir}`)
    console.log("Removing Bun (this won't affect system-installed Bun)...")
    try { fs.rmSync(bunDir, { recursive: true, force: true }); removed.push(bunDir) } catch (e) { console.error(`Failed to remove Bun: ${e.message}`) }
  }

  if (removed.length === 0) {
    console.log("Nothing to uninstall. No cody-x files found.")
  } else {
    console.log("")
    console.log(`Removed ${removed.length} item(s):`)
    for (const r of removed) console.log(`  - ${r}`)
    console.log("")
    console.log("Uninstall complete.")
  }
}

// --- WebSocket Agent ---

function killActiveChildren(reason = "disconnect") {
  for (const child of Array.from(activeChildren)) {
    try {
      child.kill("SIGTERM")
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL")
        } catch {}
      }, 1000).unref?.()
    } catch {}
  }
  if (activeChildren.size) console.log(`Stopped ${activeChildren.size} active command(s) because of ${reason}`)
}

async function startAgent(code) {
  if (!running) return

  console.log(`Connecting to ${WS_URL}...`)

  try {
    if (typeof globalThis.WebSocket !== "function") {
      console.error("WebSocket not available. This agent requires Bun or Node.js 18+.")
      process.exit(1)
    }

    ws = new globalThis.WebSocket(WS_URL)
    ws.onopen = () => {
      console.log("Connected! Sending pairing code...")
      ws.send(JSON.stringify({
        type: "pair",
        code,
        platform: process.platform,
        hostname: os.hostname(),
      }))
    }

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data.toString())
        await handleMessage(msg)
      } catch (err) {
        console.error("Failed to parse message:", err.message)
      }
    }

    ws.onclose = (event) => {
      console.log(`Disconnected (code: ${event.code}), reconnecting in 5s...`)
      killActiveChildren("websocket close")
      if (running) reconnectTimer = setTimeout(() => startAgent(code), 5000)
    }

    ws.onerror = (err) => {
      console.error("WebSocket error:", err.message || err)
    }

  } catch (err) {
    console.error("Connection failed:", err.message)
    if (running) reconnectTimer = setTimeout(() => startAgent(code), 5000)
  }
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "paired":
      console.log("Paired successfully! Awaiting commands...")
      break
    case "pair-error":
      console.error("Pairing failed:", msg.error)
      ws.close()
      running = false
      process.exit(1)
      break
    case "command":
      try {
        const result = await executeCommand(msg.command, msg.args)
        ws.send(JSON.stringify({ type: "result", id: msg.id, data: result }))
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", id: msg.id, error: err.message }))
      }
      break
    case "ping":
      ws.send(JSON.stringify({ type: "pong" }))
      break
    case "disconnect":
      console.log("Server requested disconnect")
      killActiveChildren("server disconnect")
      ws.close()
      running = false
      process.exit(0)
      break
  }
}

async function listDrives() {
  const drives = []
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i)
    try {
      fs.accessSync(letter + ":\\", fs.constants.F_OK)
      drives.push({ name: letter + ":\\", path: letter + ":\\", type: "directory" })
    } catch {}
  }
  return drives
}

async function executeCommand(command, args) {
  switch (command) {
    case "list-dir": {
      const dirPath = args.path || "/"
      if (process.platform === "win32" && (dirPath === "/" || dirPath === "\\")) {
        return { files: await listDrives() }
      }
      const entries = []
      try {
        const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true })
        for (const entry of dirEntries) {
          try {
            const fullPath = path.join(dirPath, entry.name)
            const stat = await fs.promises.stat(fullPath)
            entries.push({
              name: entry.name,
              path: fullPath,
              type: entry.isDirectory() ? "directory" : "file",
              size: stat.size,
              modifiedAt: stat.mtimeMs,
            })
          } catch {
            entries.push({
              name: entry.name,
              path: path.join(dirPath, entry.name),
              type: entry.isDirectory() ? "directory" : "file",
            })
          }
        }
      } catch (err) {
        throw new Error(`Cannot list directory: ${err.message}`)
      }
      return { files: entries }
    }
    case "read-file": {
      const filePath = args.path
      try {
        const content = await fs.promises.readFile(filePath, "utf-8")
        return { content, encoding: "utf8" }
      } catch {
        const buf = await fs.promises.readFile(filePath)
        return { content: buf.toString("base64"), encoding: "base64" }
      }
    }
    case "write-file": {
      const filePath = args.path
      const content = args.content
      const encoding = args.encoding || "utf8"
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      if (encoding === "base64") {
        await fs.promises.writeFile(filePath, Buffer.from(content, "base64"))
      } else {
        await fs.promises.writeFile(filePath, content, "utf-8")
      }
      return { success: true }
    }
    case "exec": {
      const commandStr = args.command
      return await new Promise((resolve) => {
        const child = exec(commandStr, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000,
        }, (err, stdout, stderr) => {
          activeChildren.delete(child)
          if (err) {
            resolve({
              stdout: stdout || err.stdout || "",
              stderr: stderr || err.stderr || err.message,
              exitCode: typeof err.code === "number" ? err.code : 1,
            })
            return
          }
          resolve({ stdout: stdout || "", stderr: stderr || "", exitCode: 0 })
        })
        activeChildren.add(child)
      })
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

process.on("SIGINT", () => {
  console.log("\nShutting down...")
  running = false
  clearTimeout(reconnectTimer)
  killActiveChildren("SIGINT")
  if (ws) ws.close()
  process.exit(0)
})

process.on("SIGTERM", () => {
  running = false
  clearTimeout(reconnectTimer)
  killActiveChildren("SIGTERM")
  if (ws) ws.close()
  process.exit(0)
})
