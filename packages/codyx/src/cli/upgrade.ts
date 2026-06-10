import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@cody/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@cody/core/installation/version"
import { Rpc } from "@/util/rpc"
import { execSync } from "child_process"

let _upgrading = false
function currentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", timeout: 3000 }).trim()
  } catch {
    return "main"
  }
}

function gitPullRestart(repoRoot: string) {
  if (_upgrading) return
  _upgrading = true
  execSync("git pull --ff-only", { cwd: repoRoot, encoding: "utf8", timeout: 30000 })
  Rpc.emit("restart", {})
}

async function codyProUpgrade() {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8", timeout: 5000 }).trim()
    if (!repoRoot) return
    const branch = process.env.CODY_BRANCH || currentBranch()
    execSync("git fetch origin " + branch + " --quiet", { cwd: repoRoot, encoding: "utf8", timeout: 15000 })
    const behind = execSync("git rev-list --count HEAD..origin/" + branch, { cwd: repoRoot, encoding: "utf8", timeout: 5000 }).trim()
    if (behind === "0" || behind === "") return

    await Bus.publish(Installation.Event.UpdateAvailable, { version: "latest" })

    const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
    if (config.autoupdate === true) {
      await new Promise((r) => setTimeout(r, 5000))
      gitPullRestart(repoRoot)
    }
  } catch (e) {
    console.error("[upgrade] codyProUpgrade failed:", e instanceof Error ? e.message : String(e))
  }
}

export function gitUpgrade() {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8", timeout: 5000 }).trim()
    gitPullRestart(repoRoot)
  } catch {
    // Best-effort
  }
}

export function checkForUpdates() {
  try {
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8", timeout: 5000 }).trim()
    if (!repoRoot) return { updateAvailable: false }
    const branch = process.env.CODY_BRANCH || currentBranch()
    execSync("git fetch origin " + branch + " --quiet", { cwd: repoRoot, encoding: "utf8", timeout: 15000 })
    const behind = execSync("git rev-list --count HEAD..origin/" + branch, { cwd: repoRoot, encoding: "utf8", timeout: 5000 }).trim()
    if (behind === "0" || behind === "") return { updateAvailable: false }
    return { updateAvailable: true }
  } catch (e) {
    console.error("[upgrade] checkForUpdates failed:", e instanceof Error ? e.message : String(e))
    return { updateAvailable: false }
  }
}

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.CODY_DISABLE_AUTOUPDATE) return

  // Auto-detect git-based installs
  if (process.env.CODY_PRO) {
    return codyProUpgrade()
  }
  try {
    execSync("git rev-parse --git-dir", { encoding: "utf8", timeout: 3000 })
    return codyProUpgrade()
  } catch {
    // Not a git repo, fall through to npm/brew/scoop method
  }

  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.CODY_ALWAYS_NOTIFY_UPDATE) {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (InstallationVersion === latest) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    return
  }

  if (method === "unknown") return
  await Installation.upgrade(method, latest)
    .then(() => Bus.publish(Installation.Event.Updated, { version: latest }))
    .catch(() => {})
}
