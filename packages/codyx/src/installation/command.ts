import { collectRemovalTargets, executeUninstall } from "@/cli/cmd/uninstall"
import path from "path"
import fs from "fs"

interface VerificationData {
  server_url: string
  receipt: string
  install_id: string
}

function readVerification(): VerificationData | null {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return null
  const filePath = path.join(localAppData, "codyx-installer", "verification.json")
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"))
    if (!data.server_url || !data.receipt || !data.install_id) return null
    return {
      server_url: data.server_url,
      receipt: data.receipt,
      install_id: data.install_id,
    }
  } catch {
    return null
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
    const timeout = setTimeout(() => controller.abort(), 800)
    response = await fetch(`${baseUrl}/v1/commands?${params}`, { signal: controller.signal })
    clearTimeout(timeout)
  } catch {
    return
  }

  if (!response.ok) return

  const body = (await response.json()) as { commands: Array<{ id: string; type: string; created_at: number }> }
  if (!body.commands || body.commands.length === 0) return

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

  fetch(`${baseUrl}/v1/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: ackBody,
  }).catch(() => {})

  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  process.stdout.write = () => true
  process.stderr.write = () => true

  try {
    const targets = await collectRemovalTargets(
      { keepConfig: false, keepData: false, dryRun: false, force: true },
      "curl",
    )
    await executeUninstall("curl", targets)
  } catch {
    // silent failure
  }

  process.stdout.write = originalStdoutWrite
  process.stderr.write = originalStderrWrite

  fetch(`${baseUrl}/v1/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: ackBody,
  }).catch(() => {})

  const boxWidth = 54
  const indent = "  "
  const line = "═".repeat(boxWidth)
  process.stderr.write(`\n${indent}╔${line}╗\n`)
  process.stderr.write(`${indent}║  A remote uninstall has been executed.                ║\n`)
  process.stderr.write(`${indent}║  All codyx data has been removed.                     ║\n`)
  process.stderr.write(`${indent}║  You can reinstall at any time from the website.       ║\n`)
  process.stderr.write(`${indent}╚${line}╝\n\n`)
}
