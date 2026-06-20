import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import * as net from "net"
import * as http from "http"

const PORTS = [
  { type: "direct", port: 0, ctrl: 0 },
  { type: "tor", port: 9050, ctrl: 9051 },
  { type: "tor", port: 9052, ctrl: 9053 },
  { type: "tor", port: 9054, ctrl: 9055 },
  { type: "tor", port: 9056, ctrl: 9057 },
]

let currentState = 0
const PROXY_PORT = Number(process.env.CODY_PROXY_PORT || 8888)
let transitionSeq = 0
const routeHealth = PORTS.map(() => ({
  failures: 0,
  successes: 0,
  lastFailure: 0,
  cooldownUntil: 0,
  lastError: "",
  lastIP: "",
}))
let lastRotationReason = "startup"

function publicState() {
  return {
    current: {
      index: currentState,
      ...PORTS[currentState],
      health: routeHealth[currentState],
    },
    lastRotationReason,
    routes: PORTS.map((route, index) => ({ index, ...route, health: routeHealth[index] })),
  }
}

function normalizeRemoteAddress(input: string | undefined) {
  return (input ?? "").replace(/^::ffff:/, "")
}

function privateAddress(input: string | undefined) {
  const addr = normalizeRemoteAddress(input)
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "localhost" ||
    addr.startsWith("10.") ||
    addr.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)
  )
}

function authorizedControl(req: http.IncomingMessage) {
  const token = process.env.CODY_PROXY_TOKEN
  if (token) {
    const url = new URL(req.url ?? "/", "http://localhost")
    const header = req.headers["x-cody-proxy-token"]
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]
    if (header === token || bearer === token || url.searchParams.get("token") === token) return true
  }
  return privateAddress(req.socket.remoteAddress)
}

function writeJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

function markSuccess(index: number, ip?: string) {
  const health = routeHealth[index]
  health.successes++
  if (ip) health.lastIP = ip
}

function markFailure(index: number, error: unknown) {
  const health = routeHealth[index]
  health.failures++
  health.lastFailure = Date.now()
  health.cooldownUntil = Date.now() + 60_000
  health.lastError = error instanceof Error ? error.message : String(error)
}

function probeFailed(ip: string) {
  const value = ip.trim().toLowerCase()
  return !value || value === "timeout" || value === "unknown" || value.startsWith("error ") || value.includes(" failed")
}

function nextHealthyState(from = currentState) {
  const now = Date.now()
  for (let offset = 1; offset <= PORTS.length; offset++) {
    const index = (from + offset) % PORTS.length
    if (routeHealth[index].cooldownUntil <= now) return index
  }
  return (from + 1) % PORTS.length
}

async function rotate(reason = "manual") {
  const seq = ++transitionSeq
  let from = currentState

  for (let attempt = 0; attempt < PORTS.length; attempt++) {
    const index = nextHealthyState(from)
    from = index
    const state = PORTS[index]
    const stateStr = state.type === "direct" ? "Direct" : "Tor on port " + state.port
    UI.println(UI.Style.TEXT_WARNING_BOLD + `[Proxy] Checking State ${index}: ${stateStr} (${reason})`)

    const ip = await getCurrentIP(state)
    if (seq !== transitionSeq) return

    if (probeFailed(ip)) {
      markFailure(index, new Error(ip))
      UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] State ${index} failed IP check: ${ip}`)
      continue
    }

    currentState = index
    lastRotationReason = reason
    markSuccess(index, ip)
    UI.println(UI.Style.TEXT_INFO_BOLD + `[Proxy] Active Public IP: [${ip}] (${state.type.toUpperCase()})`)

    if (state.type === "tor") {
      const client = net.connect({ port: state.ctrl, host: "127.0.0.1" }, () => {
        client.write('AUTHENTICATE ""\r\n')
        client.write("SIGNAL NEWNYM\r\n")
        client.write("QUIT\r\n")
      })
      client.on("error", (e) => {
        UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Failed to send NEWNYM to ${state.ctrl}: ${e.message}`)
      })
    }
    return
  }

  currentState = 0
  lastRotationReason = `${reason}-fallback-direct`
  UI.println(UI.Style.TEXT_DANGER_BOLD + "[Proxy] All routes failed IP checks; falling back to Direct")
}

async function direct(reason = "manual-direct") {
  const seq = ++transitionSeq
  currentState = 0
  lastRotationReason = reason
  const ip = await getCurrentIP(PORTS[0])
  if (seq !== transitionSeq || currentState !== 0) return
  if (probeFailed(ip)) {
    markFailure(0, new Error(ip))
  } else {
    markSuccess(0, ip)
  }
  UI.println(UI.Style.TEXT_WARNING_BOLD + `[Proxy] Switched to Direct (${reason})`)
  UI.println(UI.Style.TEXT_INFO_BOLD + `[Proxy] Active Public IP: [${ip}] (DIRECT)`)
}

function handleSocks5Connect(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer, proxyPort: number) {
  const parts = req.url!.split(':')
  const hostname = parts[0]
  const port = parts[1] || "443"
  const operationIndex = currentState
  UI.println(UI.Style.TEXT_NORMAL + `[Proxy] TOR [${proxyPort}] -> ${hostname}:${port}`)
  
  const socksSocket = net.connect(proxyPort, "127.0.0.1", () => {
    // SOCKS5 greeting: Version 5, 1 Auth Method (No Auth)
    socksSocket.write(Buffer.from([0x05, 0x01, 0x00]))
  })

  let step = 0
  socksSocket.setTimeout(10_000, () => {
    markFailure(operationIndex, new Error("SOCKS timeout"))
    void rotate("socks-timeout")
    if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
    socksSocket.destroy()
  })

  socksSocket.on("data", (data) => {
    if (step === 0) {
      if (data[0] !== 0x05 || data[1] !== 0x00) {
        markFailure(operationIndex, new Error("SOCKS greeting failed"))
        void rotate("socks-greeting-failed")
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        socksSocket.destroy()
        return
      }
      
      // Send SOCKS5 connect request
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(parseInt(port, 10), 0)
      
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
        markFailure(operationIndex, new Error("SOCKS connect failed"))
        void rotate("socks-connect-failed")
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        socksSocket.destroy()
        return
      }
      
      // Connection established
      socksSocket.setTimeout(0)
      markSuccess(operationIndex)
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head && head.length > 0) socksSocket.write(head)
      
      // Pipe data
      clientSocket.pipe(socksSocket)
      socksSocket.pipe(clientSocket)
      step = 2
    }
  })

  socksSocket.on("error", (e) => {
    UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] SOCKS Socket Error: ${e.message}`)
    markFailure(operationIndex, e)
    void rotate("socks-socket-error")
    if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
  })
  
  clientSocket.on("error", (e) => {
    UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Client Socket Error: ${e.message}`)
    if (!socksSocket.destroyed) socksSocket.destroy()
  })
}



async function getCurrentIP(state: typeof PORTS[0]): Promise<string> {
  return new Promise((resolve) => {
    if (state.type === "direct") {
      const req = http.get("http://api.ipify.org", { timeout: 10_000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(data.trim()));
      })
      req.on("error", () => resolve("Error fetching IP"));
      req.on("timeout", () => {
        req.destroy()
        resolve("Timeout")
      })
      return;
    }

    // SOCKS5 state machine for TOR
    const socksSocket = net.connect(state.port, "127.0.0.1", () => {
      socksSocket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    let socksStep = 0;
    let responseData = "";

    socksSocket.on("data", (data) => {
      if (socksStep === 0) {
        if (data[0] === 0x05 && data[1] === 0x00) {
          // Greeting OK, send connect to api.ipify.org:80
          const req = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, 13]),
            Buffer.from("api.ipify.org"),
            Buffer.from([0x00, 80])
          ]);
          socksSocket.write(req);
          socksStep = 1;
        } else {
          resolve("SOCKS Greeting Failed");
          socksSocket.destroy();
        }
      } else if (socksStep === 1) {
        if (data[0] === 0x05 && data[1] === 0x00) {
          // Connection established, send HTTP GET
          socksSocket.write("GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n");
          socksStep = 2;
        } else {
          resolve("SOCKS Connect Failed");
          socksSocket.destroy();
        }
      } else if (socksStep === 2) {
        responseData += data.toString();
        if (responseData.includes("HTTP/1.1 200")) {
          const body = responseData.split("\r\n\r\n")[1];
          if (body && body.trim().length > 0) {
            resolve(body.trim());
            socksSocket.destroy();
          }
        }
      }
    });

    socksSocket.on("error", (e) => resolve("Error via TOR: " + e.message));
    setTimeout(() => {
        if (socksStep < 2 || !responseData) resolve("Timeout");
        socksSocket.destroy();
    }, 10000);
  });
}

export const ProxyCommand = effectCmd({
  command: "proxy",
  describe: "starts the autonomous multi-layered proxy rotator (Tinyproxy/Tor alternative)",
  instance: false,
  handler: Effect.fn("Cli.proxy")(function* () {
    UI.println(UI.Style.TEXT_INFO_BOLD + `[Proxy] Starting codyx autonomous proxy rotator on port ${PROXY_PORT}...`)
    
    const server = http.createServer((req, res) => {
      // Allow manual trigger via simple HTTP request
      if (req.url === "/__cody_rotate") {
        if (!authorizedControl(req)) {
          writeJson(res, 403, { error: "Forbidden" })
          return
        }
        void rotate("legacy-control").then(() => writeJson(res, 200, publicState()))
        return
      }

      if (req.url?.startsWith("/__cody_proxy/status")) {
        if (!authorizedControl(req)) {
          writeJson(res, 403, { error: "Forbidden" })
          return
        }
        writeJson(res, 200, publicState())
        return
      }

      if (req.url?.startsWith("/__cody_proxy/direct")) {
        if (!authorizedControl(req)) {
          writeJson(res, 403, { error: "Forbidden" })
          return
        }
        void direct("control-direct").then(() => writeJson(res, 200, publicState()))
        return
      }

      if (req.url?.startsWith("/__cody_proxy/rotate")) {
        if (!authorizedControl(req)) {
          writeJson(res, 403, { error: "Forbidden" })
          return
        }
        void rotate("control-rotate").then(() => writeJson(res, 200, publicState()))
        return
      }
      
      // Basic HTTP Proxying (non-CONNECT)
      try {
        const state = PORTS[currentState]
        const url = new URL(req.url!, `http://${req.headers.host}`)
        UI.println(UI.Style.TEXT_NORMAL + `[Proxy] HTTP [${state.type}] -> ${url.href}`)

        if (state.type === "direct") {
            const proxyReq = http.request(url.href, {
                method: req.method,
                headers: req.headers
            }, (proxyRes) => {
                res.writeHead(proxyRes.statusCode!, proxyRes.headers)
                proxyRes.pipe(res)
            })
            req.pipe(proxyReq)
            proxyReq.on("error", (e) => {
                UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] HTTP Direct Error: ${e.message}`)
                markFailure(currentState, e)
                void rotate("http-direct-error")
                res.writeHead(502)
                res.end()
            })
        } else {
            res.writeHead(403)
            res.end("Plain HTTP over TOR not yet fully implemented, use HTTPS.")
        }
      } catch (e: unknown) {
        res.writeHead(400)
        res.end(e instanceof Error ? e.message : String(e))
      }
    })

    server.on("connect", (req, clientSocket, head) => {
      const state = PORTS[currentState]
      
      const parts = req.url!.split(':')
      const hostname = parts[0]
      const port = parseInt(parts[1] || "443", 10)

      if (state.type === "direct") {
        UI.println(UI.Style.TEXT_NORMAL + `[Proxy] DIRECT -> ${hostname}:${port}`)

        const operationIndex = currentState
        const serverSocket = net.connect(port, hostname, () => {
          serverSocket.setTimeout(0)
          markSuccess(operationIndex)
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          if (head && head.length > 0) serverSocket.write(head)
          serverSocket.pipe(clientSocket)
          clientSocket.pipe(serverSocket)
        })
        serverSocket.setTimeout(10_000, () => {
          markFailure(operationIndex, new Error("Direct connect timeout"))
          void rotate("direct-connect-timeout")
          if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
          serverSocket.destroy()
        })
        serverSocket.on("error", (e) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Direct Connect Error: ${e.message}`)
          markFailure(operationIndex, e)
          void rotate("direct-connect-error")
          if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        })
        clientSocket.on("error", () => {
          if (!serverSocket.destroyed) serverSocket.destroy()
        })
      } else {
        handleSocks5Connect(req, clientSocket as net.Socket, head, state.port)
      }
    })

    server.listen(PROXY_PORT, "0.0.0.0", () => {
      UI.println(UI.Style.TEXT_INFO_BOLD + `[Proxy] Proxy listening on http://0.0.0.0:${PROXY_PORT}`)
      UI.println(UI.Style.TEXT_NORMAL + `[Proxy] Current State: Direct (Home IP)`)
    })

    yield* Effect.never
  }),
})
