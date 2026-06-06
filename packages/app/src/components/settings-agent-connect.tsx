import { Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@cody/ui/button"
import { Icon } from "@cody/ui/icon"
import { showToast } from "@cody/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { fetchForServer } from "@/utils/server"
import FileTreeRemote from "./file-tree-remote"

export const SettingsAgentConnect: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const platform = usePlatform()

  const [pairingCode, setPairingCode] = createSignal<string | null>(null)
  const [codeExpiresAt, setCodeExpiresAt] = createSignal<number | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [pairedAt, setPairedAt] = createSignal<number | null>(null)
  const [generating, setGenerating] = createSignal(false)
  const [copiedCommand, setCopiedCommand] = createSignal<string | null>(null)

  let intervalId: ReturnType<typeof setInterval> | undefined

  const agentFetch = () => {
    const current = server.current
    if (!current) throw new Error("Server is not available")
    return fetchForServer(current.http, platform.fetch ?? globalThis.fetch)
  }

  const serverOrigin = () => server.current?.http.url ?? window.location.origin

  const wsUrl = () => {
    const url = new URL(serverOrigin())
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.pathname = "/ws/agent"
    url.search = ""
    url.hash = ""
    return url.toString()
  }

  const launcherUrl = (kind: "bat" | "ps1") => {
    const code = pairingCode()
    const endpoint = kind === "ps1" ? "/agent/download/launcher.ps1" : "/agent/download/launcher"
    const url = new URL(endpoint, serverOrigin())
    if (code) url.searchParams.set("code", code)
    url.searchParams.set("server", serverOrigin())
    url.searchParams.set("ws", wsUrl())
    return url.toString()
  }

  const scriptUrl = () => new URL("/agent/download/script", serverOrigin()).toString()

  const powershellCommand = () =>
    `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; iex ((New-Object Net.WebClient).DownloadString('${launcherUrl("ps1")}'))`

  const cmdCommand = () =>
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; iex ((New-Object Net.WebClient).DownloadString('${launcherUrl("ps1")}'))"`

  const unixCommand = () =>
    `tmp="$(mktemp)"; curl -fsSL "${scriptUrl()}" -o "$tmp"; (bun "$tmp" "${pairingCode()}" --ws "${wsUrl()}" || node "$tmp" "${pairingCode()}" --ws "${wsUrl()}")`

  const checkStatus = async () => {
    try {
      const res = await agentFetch()("/agent/status")
      if (res.ok) {
        const data = await res.json()
        setConnected(data.connected)
        setPairedAt(data.pairedAt ?? null)
      }
    } catch {
      // server not available
    }
  }

  onMount(() => {
    checkStatus()
    intervalId = setInterval(checkStatus, 3000)
  })

  onCleanup(() => {
    if (intervalId) clearInterval(intervalId)
  })

  const generateCode = async () => {
    setGenerating(true)
    try {
      const res = await agentFetch()("/agent/pair", { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setPairingCode(data.code)
        setCodeExpiresAt(data.expiresAt)
        setCopiedCommand(null)
      } else {
        showToast({ title: "Failed to generate pairing code", variant: "error" })
      }
    } catch {
      showToast({ title: "Failed to generate pairing code", variant: "error" })
    } finally {
      setGenerating(false)
    }
  }

  const disconnect = async () => {
    try {
      const res = await agentFetch()("/agent/disconnect", { method: "POST" })
      if (res.ok) {
        setConnected(false)
        setPairedAt(null)
        showToast({ title: "Remote PC disconnected", variant: "success" })
      }
    } catch {
      showToast({ title: "Failed to disconnect", variant: "error" })
    }
  }

  const disconnectOnPageHide = () => {
    if (!connected()) return
    void agentFetch()("/agent/disconnect", { method: "POST", keepalive: true }).catch(() => {})
  }

  onMount(() => {
    window.addEventListener("pagehide", disconnectOnPageHide)
  })

  onCleanup(() => {
    window.removeEventListener("pagehide", disconnectOnPageHide)
  })

  const downloadLauncher = async (kind: "bat" | "ps1") => {
    const code = pairingCode()
    if (!code) return
    const url = launcherUrl(kind)
    try {
      const res = await agentFetch()(url)
      if (!res.ok) throw new Error(res.statusText)
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = "connect-pc-" + code + "." + kind
      document.body.append(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } catch {
      showToast({ title: "Failed to download launcher", variant: "error" })
    }
  }

  const copyCommand = async (label: string, command: string) => {
    const code = pairingCode()
    if (code) {
      await navigator.clipboard.writeText(command)
      setCopiedCommand(label)
      showToast({ title: label + " command copied", variant: "success" })
      setTimeout(() => setCopiedCommand((current) => (current === label ? null : current)), 3000)
    }
  }

  const copyCode = async () => {
    const code = pairingCode()
    if (code) {
      await navigator.clipboard.writeText(code)
      showToast({ title: "Code copied!", variant: "success" })
    }
  }

  const expiresIn = () => {
    const exp = codeExpiresAt()
    if (!exp) return ""
    const remaining = Math.max(0, Math.floor((exp - Date.now()) / 1000))
    const mins = Math.floor(remaining / 60)
    const secs = remaining % 60
    return mins + "m " + secs + "s"
  }

  return (
    <div class="flex flex-col gap-4 p-4">
      <div class="bg-surface-base px-4 rounded-lg">
        <h2 class="text-16-semibold text-text-primary pt-4 pb-1">{language.t("settings.agentConnect.title")}</h2>
        <p class="text-13-regular text-text-secondary pb-3">{language.t("settings.agentConnect.description")}</p>

        {/* Connection status */}
        <div class="flex items-center gap-2 py-3 border-t border-border-secondary">
          <div class={"w-2 h-2 rounded-full " + (connected() ? "bg-green-500" : "bg-gray-400")} />
          <span class="text-14-regular text-text-secondary">
            {connected()
              ? language.t("settings.agentConnect.connected")
              : language.t("settings.agentConnect.disconnected")}
          </span>
          <Show when={connected() && pairedAt() !== null}>
            <span class="text-12-regular text-text-weak">
              {"(" + language.t("settings.agentConnect.pairedAt") + ": " + new Date(pairedAt()!).toLocaleTimeString() + ")"}
            </span>
          </Show>
        </div>

        {/* Generate pairing code section */}
        <Show when={!connected()}>
          <div class="flex flex-col gap-3 py-3 border-t border-border-secondary">
            <Button variant="primary" onClick={generateCode} disabled={generating()}>
              {generating()
                ? language.t("settings.agentConnect.generating")
                : language.t("settings.agentConnect.generateCode")}
            </Button>

            <Show when={pairingCode() !== null}>
              {/* Step 1: Show code */}
              <div class="flex items-center gap-2 bg-background-secondary rounded-lg py-2 px-3">
                <span class="text-12-regular text-text-weak mr-1">Code:</span>
                <code class="text-16-mono font-bold tracking-widest text-text-primary flex-1 select-all">
                  {pairingCode()}
                </code>
                <Button variant="ghost" size="small" onClick={copyCode} aria-label="Copy code">
                  <Icon name="checklist" />
                </Button>
              </div>

              {/* Step 2: Show hosted connector launchers and shell-specific commands */}
              <div class="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
                <p class="text-13-semibold text-blue-300 mb-2 flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  Step 2: Connect this PC
                </p>
                <div class="flex flex-wrap gap-2 mb-3">
                  <Button variant="primary" size="small" onClick={() => downloadLauncher("bat")}>
                    Download Windows launcher
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => downloadLauncher("ps1")}>
                    Download PowerShell launcher
                  </Button>
                </div>

                <p class="text-12-semibold text-blue-200 mb-1">PowerShell</p>
                <div class="flex items-center gap-2 bg-gray-900 rounded-lg py-2.5 px-3 border border-gray-700">
                  <span class="text-text-on-success-base text-13-mono">&gt;</span>
                  <code class="text-14-mono text-text-on-success-base flex-1 select-all whitespace-nowrap overflow-x-auto">
                    {powershellCommand()}
                  </code>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => copyCommand("PowerShell", powershellCommand())}
                    aria-label="Copy PowerShell command"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </Button>
                </div>

                <p class="text-12-semibold text-blue-200 mb-1 mt-3">Command Prompt</p>
                <div class="flex items-center gap-2 bg-gray-900 rounded-lg py-2.5 px-3 border border-gray-700">
                  <span class="text-text-on-success-base text-13-mono">&gt;</span>
                  <code class="text-14-mono text-text-on-success-base flex-1 select-all whitespace-nowrap overflow-x-auto">
                    {cmdCommand()}
                  </code>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => copyCommand("Command Prompt", cmdCommand())}
                    aria-label="Copy Command Prompt command"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </Button>
                </div>

                <p class="text-12-semibold text-blue-200 mb-1 mt-3">macOS / Linux</p>
                <div class="flex items-center gap-2 bg-gray-900 rounded-lg py-2.5 px-3 border border-gray-700">
                  <span class="text-text-on-success-base text-13-mono">&gt;</span>
                  <code class="text-14-mono text-text-on-success-base flex-1 select-all whitespace-nowrap overflow-x-auto">
                    {unixCommand()}
                  </code>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => copyCommand("macOS/Linux", unixCommand())}
                    aria-label="Copy macOS or Linux command"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </Button>
                </div>
                <p class="text-12-regular text-text-weak mt-2">
                  {copiedCommand()
                    ? copiedCommand() + " command copied."
                    : "These commands use the live connector from this server, not the npm package."}
                </p>
              </div>

              {/* Expiry info */}
              <span class="text-12-regular text-text-weak">
                {"Expires in " + expiresIn()}
              </span>

            </Show>
          </div>
        </Show>

        {/* Disconnect section */}
        <Show when={connected()}>
          <div class="flex flex-col gap-3 py-3 border-t border-border-secondary">
            <Button variant="secondary" onClick={disconnect}>
              {language.t("settings.agentConnect.disconnect")}
            </Button>
          </div>
        </Show>
      </div>

      {/* Remote file tree — only visible when connected */}
      <Show when={connected()}>
        <div class="bg-surface-base rounded-lg overflow-hidden">
          <div class="text-14-semibold text-text-primary px-4 pt-3 pb-2 border-b border-border-secondary flex items-center gap-2">
            <Icon name="file-tree" size="small" />
            Remote PC Files
          </div>
          <div class="py-2 max-h-96 overflow-y-auto">
            <FileTreeRemote />
          </div>
        </div>
      </Show>
    </div>
  )
}
