import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import * as net from "net"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import { Global } from "@cody/core/global"

const PORTS = [
  { type: "direct", port: 0 },
  { type: "tor", port: 9050, ctrl: 9051 },
  { type: "tor", port: 9052, ctrl: 9053 },
  { type: "tor", port: 9054, ctrl: 9055 },
  { type: "tor", port: 9056, ctrl: 9057 },
]

let currentState = 0

function rotate() {
  currentState = (currentState + 1) % PORTS.length
  const state = PORTS[currentState]
  UI.println(UI.Style.TEXT_WARNING_BOLD + `[Proxy] Rotated to State ${currentState}: ${state.type === 'direct' ? 'Direct' : 'Tor on port ' + state.port}`)
  
  if (state.type === "tor") {
    // Signal NEWNYM to get a new IP
    const client = net.connect({ port: state.ctrl!, host: "127.0.0.1" }, () => {
      client.write('AUTHENTICATE ""\r\n')
      client.write('SIGNAL NEWNYM\r\n')
      client.write('QUIT\r\n')
    })
    client.on("error", (e) => {
      UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Failed to send NEWNYM to ${state.ctrl}: ${e.message}`)
    })
  }
}

function handleSocks5Connect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer, proxyPort: number) {
  const { port, hostname } = new URL(`http://${req.url}`)
  
  const socksSocket = net.connect(proxyPort, "127.0.0.1", () => {
    // SOCKS5 greeting: Version 5, 1 Auth Method (No Auth)
    socksSocket.write(Buffer.from([0x05, 0x01, 0x00]))
  })

  let step = 0

  socksSocket.on("data", (data) => {
    if (step === 0) {
      if (data[0] !== 0x05 || data[1] !== 0x00) {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        socksSocket.destroy()
        return
      }
      
      // Send SOCKS5 connect request
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(parseInt(port || "443", 10), 0)
      
      let hostBuf: Buffer
      let hostType: number
      
      if (net.isIPv4(hostname)) {
        hostType = 0x01
        hostBuf = Buffer.from(hostname.split('.').map(Number))
      } else {
        hostType = 0x03
        hostBuf = Buffer.concat([Buffer.from([hostname.length]), Buffer.from(hostname)])
      }
      
      const reqBuf = Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, hostType]),
        hostBuf,
        portBuf
      ])
      
      socksSocket.write(reqBuf)
      step = 1
    } else if (step === 1) {
      if (data[0] !== 0x05 || data[1] !== 0x00) {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        socksSocket.destroy()
        return
      }
      
      // Connection established
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head && head.length > 0) socksSocket.write(head)
      
      // Pipe data
      clientSocket.pipe(socksSocket)
      socksSocket.pipe(clientSocket)
      step = 2
    }
  })

  socksSocket.on("error", () => {
    if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
  })
  
  clientSocket.on("error", () => {
    if (!socksSocket.destroyed) socksSocket.destroy()
  })
}

function tailLogAndWatchFor429() {
  // Try server.log and standard output files
  const logPaths = [
    path.join(process.cwd(), "server.log"),
    path.join(Global.Path.data, "cody-x.db") // Just a placeholder dir to find right place
  ]
  
  let targetLog = path.join(process.cwd(), "server.log")
  
  // Create an explicit HTTP endpoint for the app to trigger rotation just in case
  // but also implement a polling watcher.
  let pos = 0
  if (fs.existsSync(targetLog)) {
    pos = fs.statSync(targetLog).size
  }

  setInterval(() => {
    if (!fs.existsSync(targetLog)) return
    const stat = fs.statSync(targetLog)
    if (stat.size < pos) {
      pos = stat.size // File was truncated
    }
    if (stat.size > pos) {
      const stream = fs.createReadStream(targetLog, { start: pos, end: stat.size })
      let data = ""
      stream.on("data", (chunk) => { data += chunk })
      stream.on("end", () => {
        pos = stat.size
        if (data.includes("429") || data.includes("Rate limit exceeded") || data.includes("FreeUsageLimitError")) {
          UI.println(UI.Style.TEXT_WARNING_BOLD + "[Proxy] Detected rate limit error in logs. Triggering rotation.")
          rotate()
        }
      })
    }
  }, 1000)
}

export const ProxyCommand = effectCmd({
  command: "proxy",
  describe: "starts the autonomous multi-layered proxy rotator (Tinyproxy/Tor alternative)",
  instance: false,
  handler: Effect.fn("Cli.proxy")(function* () {
    UI.println(UI.Style.TEXT_INFO_BOLD + "[Proxy] Starting cody-x autonomous proxy rotator on port 8888...")
    
    tailLogAndWatchFor429()
    
    const server = http.createServer((req, res) => {
      // Allow manual trigger via simple HTTP request
      if (req.url === "/__cody_rotate") {
        rotate()
        res.writeHead(200)
        res.end("Rotated")
        return
      }
      res.writeHead(403)
      res.end("Direct HTTP proxying not supported, use CONNECT.")
    })

    server.on("connect", (req, clientSocket, head) => {
      const state = PORTS[currentState]
      
      if (state.type === "direct") {
        const { port, hostname } = new URL(`http://${req.url}`)
        const serverSocket = net.connect(parseInt(port || "443", 10), hostname, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          if (head && head.length > 0) serverSocket.write(head)
          serverSocket.pipe(clientSocket)
          clientSocket.pipe(serverSocket)
        })
        serverSocket.on("error", () => {
          if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        })
        clientSocket.on("error", () => {
          if (!serverSocket.destroyed) serverSocket.destroy()
        })
      } else {
        handleSocks5Connect(req, clientSocket as net.Socket, head, state.port)
      }
    })

    server.listen(8888, "127.0.0.1", () => {
      UI.println(UI.Style.TEXT_INFO_BOLD + "[Proxy] Proxy listening on http://127.0.0.1:8888")
      UI.println(UI.Style.TEXT_NORMAL + `[Proxy] Current State: Direct (Home IP)`)
    })

    yield* Effect.never
  }),
})
