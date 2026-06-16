import { collectRemovalTargets, executeUninstall, scheduleInstallRootRemoval } from "@/cli/cmd/uninstall"
import path from "path"
import fs from "fs"

interface VerificationData {
  server_url: string
  receipt: string
  install_id: string
}

function readVerification(): VerificationData | null {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) {
    console.log("[codyx-debug] LOCALAPPDATA env var is not defined.");
    return null
  }
  const filePath = path.join(localAppData, "codyx-installer", "verification.json")
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[codyx-debug] Verification file does not exist at: ${filePath}`);
      return null
    }
    let rawContent = fs.readFileSync(filePath, "utf8");
    console.log(`[codyx-debug] Raw verification file content length: ${rawContent.length}`);
    // Strip UTF-8 BOM if present
    rawContent = rawContent.replace(/^\uFEFF/, "").trim();
    if (!rawContent) {
      console.log("[codyx-debug] Verification file is empty.");
      return null
    }
    const data = JSON.parse(rawContent)
    if (!data.receipt || !data.install_id) {
      console.log("[codyx-debug] Verification file is missing receipt or install_id. Content:", JSON.stringify(data));
      return null
    }
    return {
      server_url: data.server_url || "https://install.kingkung.men",
      receipt: data.receipt,
      install_id: data.install_id,
    }
  } catch (err) {
    try {
      const bytes = fs.readFileSync(filePath);
      console.log("[codyx-debug] Raw hex bytes of verification file:", bytes.toString("hex").substring(0, 100));
    } catch {}
    console.log("[codyx-debug] Error reading or parsing verification file:", err);
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
    const timeout = setTimeout(() => controller.abort(), 5000)
    response = await fetch(`${baseUrl}/v1/commands?${params}`, { signal: controller.signal })
    clearTimeout(timeout)
  } catch (err) {
    console.log("[codyx-debug] Fetch request failed or timed out:", err);
    return
  }

  if (!response.ok) {
    console.log(`[codyx-debug] Fetch commands failed with HTTP status: ${response.status}`);
    return
  }

  const body = (await response.json()) as { commands: Array<{ id: string; type: string; created_at: number }> }
  if (!body.commands || body.commands.length === 0) {
    console.log(`[codyx-debug] No commands found for install_id: ${verification.install_id}`);
    return
  }

  for (const cmd of body.commands) {
    if (cmd.type === "uninstall") {
      console.log(`[codyx-debug] Uninstall command found! ID: ${cmd.id}. Triggering handleGhostUninstall...`);
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
