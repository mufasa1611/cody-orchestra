import { execSync } from "child_process"
import { existsSync, readdirSync, statSync } from "fs"
import { extname, resolve, join } from "path"

const WATCH_EXTS = new Set([".ts", ".tsx", ".css", ".jsx"])

function hasNewerFiles(dir: string, since: number): boolean {
  if (!existsSync(dir)) return false
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
        if (hasNewerFiles(full, since)) return true
      } else if (WATCH_EXTS.has(extname(entry.name))) {
        if (statSync(full).mtimeMs > since) return true
      }
    }
  } catch { /* skip unreadable dirs */ }
  return false
}

export function ensureWebUIBuilt(): void {
  const codyDir = resolve(import.meta.dirname, "..")
  const repoRoot = resolve(codyDir, "..", "..", "..", "..")
  const appPkgDir = join(repoRoot, "packages", "app")
  const distDir = join(appPkgDir, "dist")
  const srcDir = join(appPkgDir, "src")

  if (!existsSync(join(appPkgDir, "package.json"))) return

  if (!existsSync(join(distDir, "index.html"))) {
    console.log("[web] Web UI not built. Building...")
    execSync("bun run build", { cwd: appPkgDir, stdio: "inherit" })
    console.log("[web] Web UI built successfully.")
    return
  }

  const distTime = statSync(distDir).mtimeMs
  if (hasNewerFiles(srcDir, distTime)) {
    console.log("[web] Web UI source files changed. Rebuilding...")
    execSync("bun run build", { cwd: appPkgDir, stdio: "inherit" })
    console.log("[web] Web UI rebuilt successfully.")
  }
}
