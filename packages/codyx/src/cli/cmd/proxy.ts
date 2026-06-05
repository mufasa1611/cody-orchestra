import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import * as net from "net"
import * as http from "http"
import * as fs from "fs"
import * as path from "path"
import { Global } from "@cody/core/global"

const PORTS = [
  { type: "direct", port: 0, ctrl: 0 },
  { type: "tor", port: 9050, ctrl: 9051 },
  { type: "tor", port: 9052, ctrl: 9053 },
  { type: "tor", port: 9054, ctrl: 9055 },
  { type: "tor", port: 9056, ctrl: 9057 },
]

let currentState = 0

async function rotate() {
  currentState = (currentState + 1) % PORTS.length
  const state = PORTS[currentState]
  const stateStr = state.type === 'direct' ? 'Direct' : 'Tor on port ' + state.port;
  UI.println(UI.Style.TEXT_WARNING_BOLD + `[Proxy] Rotated to State ${currentState}: ${stateStr}`);
  
  const ip = await getCurrentIP(state);
  UI.println(UI.Style.TEXT_INFO_BOLD + `[Proxy] Active Public IP: [${ip}] (${state.type.toUpperCase()})`);
  
  if (state.type === "tor") {
    // Signal NEWNYM to get a new IP
    const client = net.connect({ port: state.ctrl, host: "127.0.0.1" }, () => {
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
  const parts = req.url!.split(':')
  const hostname = parts[0]
  const port = parts[1] || "443"
  UI.println(UI.Style.TEXT_NORMAL + `[Proxy] TOR [${proxyPort}] -> ${hostname}:${port}`)
  
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

  socksSocket.on("error", (e) => {
    UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] SOCKS Socket Error: ${e.message}`)
    if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
  })
  
  clientSocket.on("error", (e) => {
    UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Client Socket Error: ${e.message}`)
    if (!socksSocket.destroyed) socksSocket.destroy()
  })
}


async function getCurrentIP(state: typeof PORTS[0]): Promise<string> {
  return new Promise((resolve) => {
    const options = {
      host: "api.ipify.org",
      port: 80,
      path: "/",
      method: "GET",
    };

    if (state.type === "direct") {
      http.get("http://api.ipify.org", (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve(data.trim()));
      }).on("error", () => resolve("Error fetching IP"));
    } else {
      // SOCKS5 request for IP
      const socksSocket = net.connect(state.port, "127.0.0.1", () => {
        socksSocket.write(Buffer.from([0x05, 0x01, 0x00]));
      });

      socksSocket.on("data", (data) => {
        if (data[0] === 0x05 && data[1] === 0x00) {
          // Greeting OK, send connect to api.ipify.org:80
          const req = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, 13]),
            Buffer.from("api.ipify.org"),
            Buffer.from([0x00, 80])
          ]);
          socksSocket.write(req);
        } else if (data[0] === 0x05 && data[1] === 0x00 && data.length > 2) {
          // Connected, send HTTP GET
          socksSocket.write("GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n");
        } else {
          const str = data.toString();
          if (str.includes("HTTP/1.1 200")) {
            const body = str.split("\r\n\r\n")[1];
            if (body) resolve(body.trim());
          }
        }
      });
      socksSocket.on("error", () => resolve("Error via TOR"));
      setTimeout(() => resolve("Timeout"), 5000);
    }
  });
}

export const ProxyCommand = effectCmd({
  command: "proxy",
  describe: "starts the autonomous multi-layered proxy rotator (Tinyproxy/Tor alternative)",
  instance: false,
  handler: Effect.fn("Cli.proxy")(function* () {
    UI.println(UI.Style.TEXT_INFO_BOLD + "[Proxy] Starting cody-x autonomous proxy rotator on port 8888...")
    
    const server = http.createServer((req, res) => {
      // Allow manual trigger via simple HTTP request
      if (req.url === "/__cody_rotate") {
        rotate()
        res.writeHead(200)
        res.end("Rotated")
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
                res.writeHead(502)
                res.end()
            })
        } else {
            res.writeHead(403)
            res.end("Plain HTTP over TOR not yet fully implemented, use HTTPS.")
        }
      } catch (e: any) {
        res.writeHead(400)
        res.end(e.message)
      }
    })

    server.on("connect", (req, clientSocket, head) => {
      const state = PORTS[currentState]
      
      const parts = req.url!.split(':')
      const hostname = parts[0]
      const port = parseInt(parts[1] || "443", 10)

      if (state.type === "direct") {
        UI.println(UI.Style.TEXT_NORMAL + `[Proxy] DIRECT -> ${hostname}:${port}`)

        const serverSocket = net.connect(port, hostname, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          if (head && head.length > 0) serverSocket.write(head)
          serverSocket.pipe(clientSocket)
          clientSocket.pipe(serverSocket)
        })
        serverSocket.on("error", (e) => {
          UI.println(UI.Style.TEXT_DANGER_BOLD + `[Proxy] Direct Connect Error: ${e.message}`)
          if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
        })
        clientSocket.on("error", () => {
          if (!serverSocket.destroyed) serverSocket.destroy()
        })
      } else {
        handleSocks5Connect(req, clientSocket as net.Socket, head, state.port)
      }
    })

    server.listen(8888, "0.0.0.0", () => {
      UI.println(UI.Style.TEXT_INFO_BOLD + "[Proxy] Proxy listening on http://0.0.0.0:8888")
      UI.println(UI.Style.TEXT_NORMAL + `[Proxy] Current State: Direct (Home IP)`)
    })

    yield* Effect.never
  }),
})
