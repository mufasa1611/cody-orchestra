import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { Global } from "@cody/core/global"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"

interface UninstallArgs {
  keepConfig: boolean
  keepData: boolean
  dryRun: boolean
  force: boolean
}

interface RemovalTargets {
  directories: Array<{ path: string; label: string; keep: boolean }>
  shellConfig: string | null
  binary: string | null
  startMenu: string | null
  globalShims: string[]
  envProxy: string | null
}

export const UninstallCommand = {
  command: "uninstall",
  describe: "uninstall codyx and remove all related files",
  builder: (yargs: Argv) =>
    yargs
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "keep configuration files",
        default: false,
      })
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "keep session data and snapshots",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "show what would be removed without removing",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "skip confirmation prompts",
        default: false,
      }),

  handler: async (args: UninstallArgs) => {
    UI.empty()
    prompts.intro("Uninstall codyx")

    const method = await Installation.method()
    prompts.log.info(`Installation method: ${method}`)

    const targets = await collectRemovalTargets(args, method)

    await showRemovalSummary(targets, method, args.dryRun)

    if (!args.force && !args.dryRun) {
      const confirm = await prompts.confirm({
        message: "Are you sure you want to uninstall?",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("Cancelled")
        return
      }
    }

    if (args.dryRun) {
      prompts.log.warn("Dry run - no changes made")
      prompts.outro("Done")
      return
    }

    const removalLog = await executeUninstall(method, targets)

    await generateRemovalLog(removalLog)

    if (!args.force) await askRemoveOptionalDeps()

    prompts.outro("Done")
  },
}

async function collectRemovalTargets(args: UninstallArgs, method: Installation.Method): Promise<RemovalTargets> {
  const directories: RemovalTargets["directories"] = [
    { path: Global.Path.data, label: "Data", keep: args.keepData },
    { path: Global.Path.cache, label: "Cache", keep: false },
    { path: Global.Path.config, label: "Config", keep: args.keepConfig },
    { path: Global.Path.state, label: "State", keep: false },
  ]

  const shellConfig = method === "curl" ? await getShellConfigFile() : null
  const binary = method === "curl" ? process.execPath : null

  // Find Start Menu shortcut
  const startMenu = await findStartMenuShortcut()

  // Find global command shims
  const globalShims = await findGlobalShims()

  // Find .env.proxy
  const envProxy = await findEnvProxy()

  return { directories, shellConfig, binary, startMenu, globalShims, envProxy }
}

async function showRemovalSummary(targets: RemovalTargets, method: Installation.Method, dryRun: boolean) {
  const prefix = dryRun ? "[DRY RUN] " : ""
  prompts.log.message(`${prefix}The following will be removed:`)

  for (const dir of targets.directories) {
    const exists = await fs.access(dir.path).then(() => true).catch(() => false)
    if (!exists) continue

    const size = await getDirectorySize(dir.path)
    const sizeStr = formatSize(size)
    const status = dir.keep ? UI.Style.TEXT_DIM + "(keeping)" : ""
    const mark = dir.keep ? "○" : "✓"
    prompts.log.info(`  ${mark} ${dir.label}: ${shortenPath(dir.path)} ${UI.Style.TEXT_DIM}(${sizeStr})${status}`)
  }

  if (targets.startMenu) {
    prompts.log.info(`  ✓ Start Menu: ${shortenPath(targets.startMenu)}`)
  }

  for (const shim of targets.globalShims) {
    prompts.log.info(`  ✓ Shim: ${shortenPath(shim)}`)
  }

  if (targets.envProxy) {
    prompts.log.info(`  ✓ .env.proxy: ${shortenPath(targets.envProxy)}`)
  }

  if (targets.binary) {
    prompts.log.info(`  ✓ Binary: ${shortenPath(targets.binary)}`)
  }

  if (targets.shellConfig) {
    prompts.log.info(`  ✓ Shell PATH in ${shortenPath(targets.shellConfig)}`)
  }

  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string> = {
      npm: "npm uninstall -g codyx-ai",
      pnpm: "pnpm uninstall -g codyx-ai",
      bun: "bun remove -g codyx-ai",
      yarn: "yarn global remove codyx-ai",
      brew: "brew uninstall codyx",
      choco: "choco uninstall codyx",
      scoop: "scoop uninstall codyx",
    }
    if (cmds[method]) prompts.log.info(`  ✓ Package: ${cmds[method]}`)
  }
}

async function executeUninstall(method: Installation.Method, targets: RemovalTargets) {
  const spinner = prompts.spinner()
  const errors: string[] = []
  const removed: string[] = []

  for (const dir of targets.directories) {
    if (dir.keep) {
      prompts.log.step(`Skipping ${dir.label} (--keep-${dir.label.toLowerCase()})`)
      continue
    }
    const exists = await fs.access(dir.path).then(() => true).catch(() => false)
    if (!exists) continue

    spinner.start(`Removing ${dir.label}...`)
    const err = await fs.rm(dir.path, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop(`Failed to remove ${dir.label}`, 1)
      errors.push(`${dir.label}: ${err.message}`)
      continue
    }
    removed.push(dir.path)
    spinner.stop(`Removed ${dir.label}`)
  }

  // Remove Start Menu shortcut
  if (targets.startMenu) {
    spinner.start("Removing Start Menu shortcuts...")
    const parent = path.dirname(targets.startMenu)
    const err = await fs.rm(parent, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop("Failed to remove Start Menu shortcuts", 1)
      errors.push(`Start Menu: ${err.message}`)
    } else {
      removed.push(parent)
      spinner.stop("Removed Start Menu shortcuts")
    }
  }

  // Remove global shims
  for (const shim of targets.globalShims) {
    spinner.start(`Removing shim: ${path.basename(shim)}...`)
    const err = await fs.rm(shim, { force: true }).catch((e) => e)
    if (err) {
      spinner.stop(`Failed to remove ${path.basename(shim)}`, 1)
      errors.push(`Shim ${shim}: ${err.message}`)
    } else {
      removed.push(shim)
      spinner.stop(`Removed ${path.basename(shim)}`)
    }
  }

  // Remove .env.proxy
  if (targets.envProxy) {
    spinner.start("Removing .env.proxy...")
    const err = await fs.rm(targets.envProxy, { force: true }).catch((e) => e)
    if (err) {
      spinner.stop("Failed to remove .env.proxy", 1)
      errors.push(`.env.proxy: ${err.message}`)
    } else {
      removed.push(targets.envProxy)
      spinner.stop("Removed .env.proxy")
    }
  }

  // Clean shell config
  if (targets.shellConfig) {
    spinner.start("Cleaning shell config...")
    const err = await cleanShellConfig(targets.shellConfig).catch((e) => e)
    if (err) {
      spinner.stop("Failed to clean shell config", 1)
      errors.push(`Shell config: ${err.message}`)
    } else {
      spinner.stop("Cleaned shell config")
    }
  }

  // Package manager uninstall
  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string[]> = {
      npm: ["npm", "uninstall", "-g", "codyx-ai"],
      pnpm: ["pnpm", "uninstall", "-g", "codyx-ai"],
      bun: ["bun", "remove", "-g", "codyx-ai"],
      yarn: ["yarn", "global", "remove", "codyx-ai"],
      brew: ["brew", "uninstall", "codyx"],
      choco: ["choco", "uninstall", "codyx"],
      scoop: ["scoop", "uninstall", "codyx"],
    }

    const cmd = cmds[method]
    if (cmd) {
      spinner.start(`Running ${cmd.join(" ")}...`)
      const result = await Process.run(cmd, { nothrow: true })
      if (result.code !== 0) {
        spinner.stop(`Package manager uninstall failed: exit code ${result.code}`, 1)
        const text = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`
        if (method === "choco" && text.includes("not running from an elevated command shell")) {
          prompts.log.warn("Run choco uninstall from an elevated command shell")
        } else {
          prompts.log.warn("Run manually: " + cmd.join(" "))
        }
      } else {
        removed.push(`package: ${method}`)
        spinner.stop("Package removed")
      }
    }
  }

  if (method === "curl" && targets.binary) {
    UI.empty()
    prompts.log.message("To finish removing the binary, run:")
    prompts.log.info(`  rm "${targets.binary}"`)
    const binDir = path.dirname(targets.binary)
    if (binDir.includes(".cody")) {
      prompts.log.info(`  rmdir "${binDir}" 2>/dev/null`)
    }
  }

  if (errors.length > 0) {
    UI.empty()
    prompts.log.warn("Some operations failed:")
    for (const err of errors) {
      prompts.log.error(`  ${err}`)
    }
  }

  UI.empty()
  prompts.log.success("Thank you for using codyx!")

  return { removed, errors }
}

async function generateRemovalLog(log: { removed: string[]; errors: string[] }) {
  const logDir = path.join(os.homedir(), ".codyx")
  await fs.mkdir(logDir, { recursive: true }).catch(() => {})
  const logPath = path.join(logDir, `uninstall-${Date.now()}.log`)
  const lines = [
    `# codyx Uninstall Log`,
    `# Date: ${new Date().toISOString()}`,
    `# OS: ${os.platform()} ${os.release()}`,
    ``,
    `## Removed`,
    ...log.removed.map((r) => `  - ${r}`),
    ``,
    log.errors.length > 0
      ? `## Errors\n${log.errors.map((e) => `  - ${e}`).join("\n")}`
      : "## Errors\n  (none)",
  ]
  await fs.writeFile(logPath, lines.join("\n"), "utf-8").catch(() => {})
  prompts.log.info(`Removal log: ${logPath}`)
}

async function askRemoveOptionalDeps() {
  const removeBun = await prompts.confirm({
    message: "Remove Bun (installed specifically for codyx)?",
    initialValue: false,
  })

  if (removeBun) {
    prompts.log.step("To remove Bun, run: rm -rf ~/.bun")
    prompts.log.step("Or on Windows: rmdir /s /q %USERPROFILE%\\.bun")
  }

  const removeCloudflared = await prompts.confirm({
    message: "Remove cloudflared (installed for codyx proxy tunnel)?",
    initialValue: false,
  })

  if (removeCloudflared) {
    prompts.log.step("To remove cloudflared:")
    prompts.log.step("  winget uninstall Cloudflare.cloudflared")
    prompts.log.step("  Or manual: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/")
  }
}

async function findStartMenuShortcut(): Promise<string | null> {
  if (os.platform() !== "win32") return null
  const paths = [
    path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "codyx", "Uninstall codyx.lnk"),
    path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "codyx"),
  ]
  for (const p of paths) {
    const exists = await fs.access(p).then(() => true).catch(() => false)
    if (exists) return p
  }
  return null
}

async function findGlobalShims(): Promise<string[]> {
  const shims: string[] = []
  const candidates =
    os.platform() === "win32"
      ? [
          path.join(process.env.APPDATA || "", "npm", "codyx.cmd"),
          path.join(process.env.APPDATA || "", "npm", "codyx.ps1"),
        ]
      : [
          ...(process.env.CODY_GLOBAL_BIN_DIR
            ? [path.join(process.env.CODY_GLOBAL_BIN_DIR, "codyx")]
            : []),
          path.join(os.homedir(), ".local", "bin", "codyx"),
          path.join(
            process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
            "codyx",
            "bin",
            "codyx",
          ),
        ]
  for (const c of candidates) {
    const exists = await fs.access(c).then(() => true).catch(() => false)
    if (exists) shims.push(c)
  }
  return shims
}

async function findEnvProxy(): Promise<string | null> {
  try {
    const root = process.env.CODY_INSTALL_ROOT || ""
    if (!root) return null
    const envProxy = path.join(root, ".env.proxy")
    const exists = await fs.access(envProxy).then(() => true).catch(() => false)
    return exists ? envProxy : null
  } catch {
    return null
  }
}

async function getShellConfigFile(): Promise<string | null> {
  const shell = path.basename(process.env.SHELL || "bash")
  const home = os.homedir()
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")

  const configFiles: Record<string, string[]> = {
    fish: [path.join(xdgConfig, "fish", "config.fish")],
    zsh: [
      path.join(home, ".zshrc"),
      path.join(home, ".zshenv"),
      path.join(xdgConfig, "zsh", ".zshrc"),
      path.join(xdgConfig, "zsh", ".zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdgConfig, "bash", ".bashrc"),
      path.join(xdgConfig, "bash", ".bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".profile")],
  }

  const candidates = configFiles[shell] || configFiles.bash

  for (const file of candidates) {
    const exists = await fs.access(file).then(() => true).catch(() => false)
    if (!exists) continue

    const content = await Filesystem.readText(file).catch(() => "")
    if (
      content.includes("# >>> codyx installer >>>") ||
      content.includes("# codyx") ||
      content.includes(".cody/bin") ||
      content.includes("/codyx/bin")
    ) {
      return file
    }
  }

  return null
}

async function cleanShellConfig(file: string) {
  const content = await Filesystem.readText(file)
  const lines = content.split("\n")

  const filtered: string[] = []
  let skip = false
  let skipInstallerBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === "# >>> codyx installer >>>") {
      skipInstallerBlock = true
      continue
    }

    if (skipInstallerBlock) {
      if (trimmed === "# <<< codyx installer <<<") skipInstallerBlock = false
      continue
    }

    if (trimmed === "# cody" || trimmed === "# codyx") {
      skip = true
      continue
    }

    if (skip) {
      skip = false
      if (trimmed.includes(".cody/bin") || trimmed.includes("/codyx/bin") || trimmed.includes("fish_add_path")) {
        continue
      }
    }

    if (
      (trimmed.startsWith("export PATH=") &&
        (trimmed.includes(".cody/bin") || trimmed.includes("/codyx/bin"))) ||
      (trimmed.startsWith("fish_add_path") && trimmed.includes("codyx/bin"))
    ) {
      continue
    }

    filtered.push(line)
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop()
  }

  const output = filtered.join("\n") + "\n"
  await Filesystem.write(file, output)
}

async function getDirectorySize(dir: string): Promise<number> {
  let total = 0

  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }

  await walk(dir)
  return total
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function shortenPath(p: string): string {
  const home = os.homedir()
  if (p.startsWith(home)) {
    return p.replace(home, "~")
  }
  return p
}
