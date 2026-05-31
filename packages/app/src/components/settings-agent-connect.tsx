import { Component, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Button } from "@cody/ui/button"
import { Icon } from "@cody/ui/icon"
import { showToast } from "@cody/ui/toast"
import { useLanguage } from "@/context/language"
import FileTreeRemote from "./file-tree-remote"

export const SettingsAgentConnect: Component = () => {
  const language = useLanguage()

  const [pairingCode, setPairingCode] = createSignal<string | null>(null)
  const [codeExpiresAt, setCodeExpiresAt] = createSignal<number | null>(null)
  const [connected, setConnected] = createSignal(false)
  const [pairedAt, setPairedAt] = createSignal<number | null>(null)
  const [generating, setGenerating] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  let intervalId: ReturnType<typeof setInterval> | undefined

  const checkStatus = async () => {
    try {
      const res = await fetch("/agent/status")
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
      const res = await fetch("/agent/pair", { method: "POST" })
      if (res.ok) {
        const data = await res.json()
        setPairingCode(data.code)
        setCodeExpiresAt(data.expiresAt)
        setCopied(false)
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
      const res = await fetch("/agent/disconnect", { method: "POST" })
      if (res.ok) {
        setConnected(false)
        setPairedAt(null)
        showToast({ title: "Remote PC disconnected", variant: "success" })
      }
    } catch {
      showToast({ title: "Failed to disconnect", variant: "error" })
    }
  }

  const copyCommand = async () => {
    const code = pairingCode()
    if (code) {
      const cmd = "bunx --yes cody-connect " + code
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      showToast({ title: "Command copied! Paste it in your PC terminal.", variant: "success" })
      setTimeout(() => setCopied(false), 3000)
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

              {/* Step 2: Show the ready-to-paste bunx command */}
              <div class="bg-blue-900/20 border border-blue-700/30 rounded-lg p-3">
                <p class="text-13-semibold text-blue-300 mb-2 flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  Step 2: Run this on your PC
                </p>
                <div class="flex items-center gap-2 bg-gray-900 rounded-lg py-2.5 px-3 border border-gray-700">
                  <span class="text-text-on-success-base text-13-mono">$</span>
                  <code class="text-14-mono text-text-on-success-base flex-1 select-all whitespace-nowrap overflow-x-auto">
                    bunx --yes cody-connect {pairingCode()}
                  </code>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={copyCommand}
                    aria-label="Copy command"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </Button>
                </div>
                <p class="text-12-regular text-text-weak mt-2">
                  {copied() ? "Copied! Paste in your PC terminal." : "Click the copy button, then paste in your PC's terminal."}
                </p>
              </div>

              {/* Expiry info */}
              <span class="text-12-regular text-text-weak">
                {"Expires in " + expiresIn()}
              </span>

              {/* Download launchers for users without Node.js */}
              <details class="text-12-regular text-text-weak mt-1">
                <summary class="cursor-pointer hover:text-text-secondary">Don't have Node.js? Download a launcher</summary>
                <div class="flex gap-2 mt-2">
                  <a
                    href={"/agent/download/launcher?code=" + pairingCode()}
                    class="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 text-white text-12-semibold hover:bg-blue-700 transition-colors"
                    download={"connect-pc-" + pairingCode() + ".bat"}
                  >Download .bat (Windows)</a>
                  <a
                    href={"/agent/download/launcher.ps1?code=" + pairingCode()}
                    class="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-600 text-white text-12-semibold hover:bg-purple-700 transition-colors"
                    download={"connect-pc-" + pairingCode() + ".ps1"}
                  >Download .ps1 (PowerShell)</a>
                </div>
              </details>
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
