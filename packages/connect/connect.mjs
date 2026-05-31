#!/usr/bin/env bun

// Cody Pro Remote Agent
// Usage: bunx cody-connect <PAIRING_CODE>
// Connects to cody.kingkung.men WebSocket hub and serves local filesystem

import fs from "fs"
import path from "path"
import { execSync } from "child_process"

const WS_URL = process.env.CODY_WS_URL || "wss://cody.kingkung.men/ws/agent"
const mode = process.argv[2]

// --- Uninstall ---

if (mode === "--uninstall" || mode === "--cleanup") {
  if (process.platform === "win32" && !(trySync(() => execSync("net session", { encoding: "utf-8", timeout: 3000 }), false))) {
    console.log("Elevating to administrator privileges for cleanup...")
    const args = process.argv.slice(1).map(a => `"${a}"`).join(" ")
    execSync(`powershell -Command "Start-Process -Verb RunAs -FilePath '${process.execPath}' -ArgumentList ${args} -Wait"`, { timeout: 15000 })
    process.exit(0)
  }
  uninstallAll()
  process.exit(0)
}

if (!mode || mode.startsWith("--")) {
  console.error("Usage: bunx cody-connect <PAIRING_CODE>")
  console.error("       bunx cody-connect --uninstall")
  console.error("")
  console.error("Get a pairing code from cody.kingkung.men > Settings > Connect My PC")
  if (mode === "--help") console.log("  --uninstall  Remove all installed files, Bun, and cloned repo")
  process.exit(mode === "--help" ? 0 : 1)
}

// Auto-elevate on Windows if not already admin
if (process.platform === "win32" && !(trySync(() => execSync("net session", { encoding: "utf-8", timeout: 3000 }), false))) {
  console.log("Elevating to administrator privileges for full remote control...")
  const args = process.argv.slice(1).map(a => `"${a}"`).join(" ")
  execSync(`powershell -Command "Start-Process -Verb RunAs -FilePath '${process.execPath}' -ArgumentList ${args} -Wait"`, { timeout: 15000 })
  process.exit(0)
}

console.log("Cody Connect Agent (admin mode)")
startAgent(mode)

// --- Helper ---

function trySync(fn, fallback) {
  try { return fn() } catch { return fallback }
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

let ws, reconnectTimer, running = true

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
      ws.send(JSON.stringify({ type: "pair", code }))
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
      try {
        const output = execSync(commandStr, {
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000,
        })
        return { stdout: output, stderr: "", exitCode: 0 }
      } catch (err) {
        return {
          stdout: err.stdout || "",
          stderr: err.stderr || err.message,
          exitCode: err.status || 1,
        }
      }
    }
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

process.on("SIGINT", () => {
  console.log("\nShutting down...")
  running = false
  clearTimeout(reconnectTimer)
  if (ws) ws.close()
  process.exit(0)
})

process.on("SIGTERM", () => {
  running = false
  clearTimeout(reconnectTimer)
  if (ws) ws.close()
  process.exit(0)
})
