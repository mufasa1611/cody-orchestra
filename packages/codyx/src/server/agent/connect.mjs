#!/usr/bin/env node

// Cody Pro Remote Agent
// Usage: node connect.mjs <PAIRING_CODE>
// Connects to cody.kingkung.men WebSocket hub and serves local filesystem

const WS_URL = process.env.CODY_WS_URL || "wss://cody.kingkung.men/ws/agent"
const code = process.argv[2]

if (!code) {
  console.error("Usage: node connect.mjs <PAIRING_CODE>")
  console.error("Get a pairing code from cody.kingkung.men → Settings → Connect My PC")
  process.exit(1)
}

import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import readline from "readline"

let ws
let reconnectTimer
let running = true

async function connect() {
  if (!running) return
  
  console.log(`Connecting to ${WS_URL}...`)
  
  try {
    // Dynamic import for WebSocket (works in Node 18+)
    const WebSocket = globalThis.WebSocket || await import("ws").then(m => m.default || m).catch(() => {
      // Fallback: use built-in
      return null
    })
    
    if (WebSocket) {
      ws = new WebSocket(WS_URL)
    } else {
      // Native WebSocket in Node 18+
      ws = new globalThis.WebSocket(WS_URL)
    }
    
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
      if (running) {
        reconnectTimer = setTimeout(connect, 5000)
      }
    }
    
    ws.onerror = (err) => {
      console.error("WebSocket error:", err.message || err)
    }
    
  } catch (err) {
    console.error("Connection failed:", err.message)
    if (running) {
      reconnectTimer = setTimeout(connect, 5000)
    }
  }
}

async function handleMessage(msg) {
  switch (msg.type) {
    case "paired":
      console.log("✅ Paired successfully! Awaiting commands...")
      break
      
    case "pair-error":
      console.error("❌ Pairing failed:", msg.error)
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
  // List all available drives on Windows
  const drives = []
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i)
    try {
      fs.accessSync(letter + ':\\', fs.constants.F_OK)
      drives.push({
        name: letter + ':\\',
        path: letter + ':\\',
        type: "directory",
      })
    } catch { /* drive not available */ }
  }
  return drives
}

async function executeCommand(command, args) {
  switch (command) {
    case "list-dir": {
      const dirPath = args.path || "/"
      
      // On Windows root path, list all available drives
      if (process.platform === 'win32' && (dirPath === '/' || dirPath === '\\')) {
        const drives = await listDrives()
        return { files: drives }
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
        // Try base64 for binary files
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
          maxBuffer: 10 * 1024 * 1024, // 10MB
          timeout: 30000, // 30s
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

// Handle graceful shutdown
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

connect()
