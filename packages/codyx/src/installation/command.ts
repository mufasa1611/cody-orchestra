import { collectRemovalTargets, scheduleInstallRootRemoval } from "@/cli/cmd/uninstall"
import { InstallationVersion } from "@cody/core/installation/version"
import path from "path"
import fs from "fs"
import crypto from "node:crypto"
import os from "os"
import * as prompts from "@clack/prompts"

const DEFAULT_SERVER_URL = "https://install.kingkung.men"

interface VerificationData {
  server_url: string
  receipt: string
  install_id: string
}

function readVerification(): VerificationData | null {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    return null
  }
  const filePath = path.join(localAppData, "codyx-installer", "verification.json")
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    let rawContent = fs.readFileSync(filePath, "utf8");
    rawContent = rawContent.replace(/^\uFEFF/, "").trim();
    if (!rawContent) {
      return null
    }
    const data = JSON.parse(rawContent)
    if (!data.receipt || !data.install_id) {
      return null
    }
    return {
      server_url: data.server_url || DEFAULT_SERVER_URL,
      receipt: data.receipt,
      install_id: data.install_id,
    }
  } catch {
    return null
  }
}

function saveVerification(serverUrl: string, installId: string, receipt: string, expiresAt: number) {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return
  const dir = path.join(localAppData, "codyx-installer")
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, "verification.json")
  const tmp = filePath + ".tmp"
  fs.writeFileSync(
    tmp,
    JSON.stringify({
      version: 1,
      install_id: installId,
      receipt,
      expires_at: expiresAt,
      server_url: serverUrl,
    }, null, 2),
    "utf8",
  )
  fs.renameSync(tmp, filePath)
}

export async function ensureVerification(): Promise<void> {
  if (process.env.CODY_SKIP_VERIFICATION) return
  if (readVerification()) return

  prompts.intro("Verification Required")
  prompts.log.warn("Your installation is not linked to an account. Remote management will not work.")

  const baseUrl = DEFAULT_SERVER_URL
  const installId = crypto.randomUUID()

  const email = await prompts.text({
    message: "Enter your email to receive a verification code:",
    placeholder: "you@example.com",
    validate: (v) => {
      if (!v) return "Email is required"
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Invalid email format"
    },
  })
  if (prompts.isCancel(email)) {
    prompts.outro("Verification skipped. Remote features unavailable.")
    return
  }

  const displayName = await prompts.text({
    message: "Your name (optional):",
    placeholder: "Your name",
  })
  if (prompts.isCancel(displayName)) {
    prompts.outro("Verification skipped.")
    return
  }

  const name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : "User"
  const emailStr = (email as string).trim().toLowerCase()

  const spin = prompts.spinner()
  spin.start("Sending verification code...")

  let challengeId: string
  try {
    const res = await fetch(`${baseUrl}/v1/challenges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install_id: installId,
        display_name: name,
        email: emailStr,
        installer_version: InstallationVersion,
        platform: os.platform() === "win32" ? "windows" : os.platform(),
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      spin.stop("Failed to send code", 1)
      prompts.log.error(`Server: ${body.message || res.statusText}. Try again with 'codyx setup'.`)
      prompts.outro("Verification failed.")
      return
    }
    const data = await res.json() as { challenge_id: string }
    challengeId = data.challenge_id
    spin.stop("Code sent to your email!")
  } catch {
    spin.stop("Network error", 1)
    prompts.log.error("Cannot reach the verification server. Check your connection.")
    prompts.outro("Verification failed.")
    return
  }

  while (true) {
    const code = await prompts.text({
      message: "Enter the 6-digit code from your email:",
      placeholder: "000000",
      validate: (v) => {
        if (!v) return "Code is required"
        if (!/^\d{6}$/.test(v.trim())) return "Must be exactly 6 digits"
      },
    })
    if (prompts.isCancel(code)) {
      prompts.outro("Verification cancelled.")
      return
    }

    const checking = prompts.spinner()
    checking.start("Verifying...")

    try {
      const res = await fetch(`${baseUrl}/v1/challenges/${challengeId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: (code as string).trim() }),
      })

      if (res.ok) {
        const data = await res.json() as { receipt: string; expires_at: string }
        checking.stop("Verified!")
        saveVerification(baseUrl, installId, data.receipt, new Date(data.expires_at).getTime())
        prompts.log.success("Installation linked. Remote management active.")
        prompts.outro("Ready")
        return
      }

      const body = await res.json().catch(() => ({}))
      const errCode = body.code as string

      if (errCode === "incorrect_code" || errCode === "attempts_exhausted") {
        checking.stop("Incorrect code")
        prompts.log.warn("The code is incorrect. Sending a new one to your email...")

        try {
          const resendRes = await fetch(`${baseUrl}/v1/challenges/${challengeId}/resend`, { method: "POST" })
          if (!resendRes.ok) {
            const newRes = await fetch(`${baseUrl}/v1/challenges`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                install_id: installId,
                display_name: name,
                email: emailStr,
                installer_version: InstallationVersion,
                platform: os.platform() === "win32" ? "windows" : os.platform(),
              }),
            })
            if (newRes.ok) {
              const d = await newRes.json() as { challenge_id: string }
              challengeId = d.challenge_id
            }
          }
        } catch {}
        continue
      }

      if (errCode === "code_expired") {
        checking.stop("Code expired")
        try { await fetch(`${baseUrl}/v1/challenges/${challengeId}/resend`, { method: "POST" }) } catch {}
        continue
      }

      checking.stop("Error", 1)
      prompts.log.error(body.message || "Verification failed.")
      const retry = await prompts.select({
        message: "Try again?",
        options: [
          { label: "Yes, resend code", value: true },
          { label: "No, skip", value: false },
        ],
      })
      if (prompts.isCancel(retry) || !retry) {
        prompts.outro("Verification cancelled.")
        return
      }
      try { await fetch(`${baseUrl}/v1/challenges/${challengeId}/resend`, { method: "POST" }) } catch {}
    } catch {
      checking.stop("Network error", 1)
      prompts.log.error("Cannot reach the verification server.")
      const retry = await prompts.select({
        message: "Try again?",
        options: [
          { label: "Yes", value: true },
          { label: "No, skip", value: false },
        ],
      })
      if (prompts.isCancel(retry) || !retry) {
        prompts.outro("Verification cancelled.")
        return
      }
    }
  }
}

export async function checkRemoteCommands(): Promise<void> {
  const verification = readVerification()
  if (!verification) return

  const baseUrl = verification.server_url.replace(/\/+$/, "")
  const params = new URLSearchParams({
    install_id: verification.install_id,
    receipt: verification.receipt,
  })

  let response: Response
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    response = await fetch(`${baseUrl}/v1/commands?${params}`, { signal: controller.signal })
    clearTimeout(timeout)
  } catch {
    return
  }

  if (!response.ok) {
    return
  }

  const body = (await response.json()) as { commands: Array<{ id: string; type: string; created_at: number }> }
  if (!body.commands || body.commands.length === 0) {
    return
  }

  for (const cmd of body.commands) {
    if (cmd.type === "uninstall") {
      await handleGhostUninstall(baseUrl, verification, cmd.id)
    }
  }
}

async function handleGhostUninstall(baseUrl: string, verification: VerificationData, commandId: string) {
  const ackBody = JSON.stringify({
    install_id: verification.install_id,
    receipt: verification.receipt,
    command_id: commandId,
  })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    await fetch(`${baseUrl}/v1/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ackBody,
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch {}

  const printProgress = (text: string) => {
    process.stderr.write(`\r\x1b[94m[Codyx]\x1b[0m ${text}\x1b[K`)
  }

  try {
    const targets = await collectRemovalTargets(
      { keepConfig: false, keepData: false, dryRun: false, force: true },
      "curl",
    )

    for (const dir of targets.directories) {
      if (dir.keep) continue
      if (targets.installRoot && (dir.path === targets.installRoot || dir.path.startsWith(`${targets.installRoot}${path.sep}`))) {
        continue
      }
      if (fs.existsSync(dir.path)) {
        printProgress(`Removing ${dir.label}...`)
        await fs.promises.rm(dir.path, { recursive: true, force: true }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    }

    for (const shim of targets.globalShims) {
      if (fs.existsSync(shim)) {
        printProgress(`Removing shim: ${path.basename(shim)}...`)
        await fs.promises.rm(shim, { force: true }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    if (targets.envProxy && fs.existsSync(targets.envProxy)) {
      printProgress("Removing proxy settings...")
      await fs.promises.rm(targets.envProxy, { force: true }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (targets.installMarker && fs.existsSync(targets.installMarker)) {
      printProgress("Removing install marker...")
      await fs.promises.rm(targets.installMarker, { force: true }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (targets.installRoot && fs.existsSync(targets.installRoot)) {
      printProgress("Scheduling install root removal...")
      await scheduleInstallRootRemoval(targets.installRoot).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    process.stderr.write(`\r\x1b[K`)
  } catch (e) {
    // silent failure
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    await fetch(`${baseUrl}/v1/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ackBody,
      signal: controller.signal,
    })
    clearTimeout(timeout)
  } catch {}

  const boxWidth = 70
  const indent = "  "
  const line = "═".repeat(boxWidth)
  const printLine = (text: string) => {
    const pad = boxWidth - text.length
    const leftPad = Math.floor(pad / 2)
    const rightPad = pad - leftPad
    process.stderr.write(`${indent}║${" ".repeat(leftPad)}${text}${" ".repeat(rightPad)}║\n`)
  }
  process.stderr.write(`\n${indent}╔${line}╗\n`)
  printLine("A remote uninstallation has been executed due to a")
  printLine("violation of the terms of service agreement.")
  printLine("")
  printLine("All codyx data has been securely removed.")
  process.stderr.write(`${indent}╚${line}╝\n\n`)

  process.exit(0)
}
