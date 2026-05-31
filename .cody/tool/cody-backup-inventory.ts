/// <reference path="../env.d.ts" />
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { tool } from "@cody/plugin"

const BACKUP_EXTENSIONS = [
  ".7z",
  ".bak",
  ".backup",
  ".bkf",
  ".dump",
  ".gz",
  ".img",
  ".iso",
  ".qcow2",
  ".sql",
  ".tar",
  ".tgz",
  ".vhd",
  ".vhdx",
  ".vib",
  ".vma",
  ".vbk",
  ".xz",
  ".zip",
  ".zst",
]

const CHECKS = ["summary", "inventory", "recent", "large", "checksum"] as const
type CheckName = (typeof CHECKS)[number]

type BackupEntry = {
  path: string
  size: number
  modified: Date
  extension: string
}

function truncate(text: string, max = 12000) {
  if (text.length <= max) return text
  return text.slice(0, max) + `\n...[truncated ${text.length - max} chars]`
}

function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function backupExtension(filePath: string) {
  const lower = filePath.toLowerCase()
  const match = BACKUP_EXTENSIONS.find((extension) => lower.endsWith(extension))
  return match ?? ""
}

async function walk(root: string, maxDepth: number, maxItems: number) {
  const entries: BackupEntry[] = []
  let directoriesVisited = 0
  let filesVisited = 0
  let stoppedEarly = false

  async function visit(directory: string, depth: number) {
    if (stoppedEarly) return
    directoriesVisited++

    let children: string[]
    try {
      children = await readdir(directory)
    } catch {
      return
    }

    for (const child of children) {
      if (stoppedEarly) return
      const childPath = path.join(directory, child)

      let info
      try {
        info = await lstat(childPath)
      } catch {
        continue
      }

      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        if (depth < maxDepth) await visit(childPath, depth + 1)
        continue
      }
      if (!info.isFile()) continue

      filesVisited++
      const extension = backupExtension(childPath)
      if (!extension) continue

      entries.push({
        path: childPath,
        size: info.size,
        modified: info.mtime,
        extension,
      })
      if (entries.length >= maxItems) stoppedEarly = true
    }
  }

  await visit(root, 0)
  return { entries, directoriesVisited, filesVisited, stoppedEarly }
}

function renderEntries(entries: BackupEntry[]) {
  if (entries.length === 0) return "(no backup-like files found)"
  return entries
    .map((entry) =>
      [`Path: ${entry.path}`, `Size: ${formatBytes(entry.size)}`, `Modified: ${entry.modified.toISOString()}`, ""].join(
        "\n",
      ),
    )
    .join("\n")
}

async function sha256(filePath: string) {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

export default tool({
  description:
    "Run a bounded read-only backup inventory or checksum check. Does not restore, delete, rotate, prune, or mutate backup files.",
  args: {
    check: tool.schema.enum(CHECKS).describe("The read-only backup profile to run"),
    root: tool.schema
      .string()
      .optional()
      .describe("Root directory to scan for backup-like files. Defaults to the current working directory."),
    filePath: tool.schema.string().optional().describe("File to checksum when check is checksum"),
    maxDepth: tool.schema.number().int().min(0).max(8).optional().describe("Maximum directory depth, default 3"),
    maxItems: tool.schema.number().int().min(1).max(200).optional().describe("Maximum matching files, default 50"),
  },
  async execute(args) {
    const check = args.check as CheckName

    if (check === "checksum") {
      if (!args.filePath) return "checksum requires filePath."
      const target = path.resolve(args.filePath)
      const info = await stat(target)
      if (!info.isFile()) return `${target} is not a file.`
      const digest = await sha256(target)
      return [
        "Profile: Backup checksum",
        "Command type: bounded read-only filesystem check",
        `Path: ${target}`,
        `Size: ${formatBytes(info.size)}`,
        `Modified: ${info.mtime.toISOString()}`,
        `SHA256: ${digest}`,
      ].join("\n")
    }

    const root = path.resolve(args.root ?? process.cwd())
    const maxDepth = args.maxDepth ?? 3
    const maxItems = args.maxItems ?? 50
    const result = await walk(root, maxDepth, maxItems)
    const totalSize = result.entries.reduce((total, entry) => total + entry.size, 0)

    const byExtension = new Map<string, { count: number; size: number }>()
    for (const entry of result.entries) {
      const current = byExtension.get(entry.extension) ?? { count: 0, size: 0 }
      current.count++
      current.size += entry.size
      byExtension.set(entry.extension, current)
    }

    let body: string
    if (check === "summary") {
      body =
        byExtension.size === 0
          ? "(no backup-like files found)"
          : [...byExtension.entries()]
              .sort((a, b) => b[1].size - a[1].size)
              .map(([extension, value]) => `${extension}: ${value.count} file(s), ${formatBytes(value.size)}`)
              .join("\n")
    } else if (check === "recent") {
      body = renderEntries([...result.entries].sort((a, b) => b.modified.getTime() - a.modified.getTime()))
    } else if (check === "large") {
      body = renderEntries([...result.entries].sort((a, b) => b.size - a.size))
    } else {
      body = renderEntries([...result.entries].sort((a, b) => a.path.localeCompare(b.path)))
    }

    return [
      `Profile: Backup ${check}`,
      "Command type: bounded read-only filesystem check",
      `Root: ${root}`,
      `Max depth: ${maxDepth}`,
      `Directories visited: ${result.directoriesVisited}`,
      `Files visited: ${result.filesVisited}`,
      `Matches: ${result.entries.length}${result.stoppedEarly ? " (item limit reached)" : ""}`,
      `Total matched size: ${formatBytes(totalSize)}`,
      "",
      truncate(body),
    ].join("\n")
  },
})
