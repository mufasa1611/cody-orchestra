import { basename, dirname, join } from "path"
import { Effect, FileSystem, Layer, Option } from "effect"
import { AppFileSystem } from "@cody/core/filesystem"
import { Glob } from "@cody/core/util/glob"
import * as AgentHub from "./hub"
import type { AgentListDirResponse, AgentReadFileResponse } from "./types"

const STAT_ERROR = "AgentFS.stat would fail remotely" as const

const remoteStat = (hub: AgentHub.Interface, path: string): Effect.Effect<FileSystem.File.Info> =>
  Effect.gen(function* () {
    if (path === "/" || path === "\\") {
      return {
        type: "Directory" as const,
        size: FileSystem.Size(0),
        mtime: Option.none(),
        atime: Option.none(),
        birthtime: Option.none(),
        dev: 0,
        ino: Option.none(),
        mode: 0o755,
        nlink: Option.none(),
        uid: Option.none(),
        gid: Option.none(),
        rdev: Option.none(),
        blksize: Option.none(),
        blocks: Option.none(),
      }
    }
    const parent = dirname(path)
    if (parent === path) return yield* Effect.die(STAT_ERROR)
    const name = basename(path)
    const result = yield* hub.listDir(parent).pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!result) return yield* Effect.die(STAT_ERROR)
    const list = result as AgentListDirResponse
    const entry = list.files?.find((f) => f.name === name)
    if (!entry) return yield* Effect.die(STAT_ERROR)
    return {
      type: entry.type === "directory" ? ("Directory" as const) : ("File" as const),
      size: FileSystem.Size(entry.size ?? 0),
      mtime: entry.modifiedAt ? Option.some(new Date(entry.modifiedAt)) : Option.none(),
      atime: Option.none(),
      birthtime: Option.none(),
      dev: 0,
      ino: Option.none(),
      mode: 0o644,
      nlink: Option.none(),
      uid: Option.none(),
      gid: Option.none(),
      rdev: Option.none(),
      blksize: Option.none(),
      blocks: Option.none(),
    }
  })

export const layer = Layer.effect(
  AppFileSystem.Service,
  Effect.gen(function* () {
    const hub = yield* AgentHub.Service
    const fs = yield* FileSystem.FileSystem

    const agentStat = Effect.fn("AgentFS.stat")(function* (path: string) {
      const fallback = () => fs.stat(path)
      return yield* remoteStat(hub, path).pipe(Effect.catch(() => fallback()))
    })

    const agentReadFileString = Effect.fn("AgentFS.readFileString")(function* (path: string) {
      const result = yield* hub.readFile(path).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) return yield* fs.readFileString(path)
      const r = result as AgentReadFileResponse
      if (r.encoding === "base64") return new TextDecoder().decode(Buffer.from(r.content, "base64"))
      return r.content
    })

    const agentWriteFileString = Effect.fn("AgentFS.writeFileString")(function* (path: string, content: string) {
      const result = yield* hub.writeFile(path, content).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) return yield* fs.writeFileString(path, content)
    })

    const agentExists = Effect.fn("AgentFS.exists")(function* (path: string) {
      const parent = dirname(path)
      const name = basename(path)
      if (parent === path) return true
      const result = yield* hub.listDir(parent).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) return yield* fs.exists(path)
      const list = result as AgentListDirResponse
      return list.files?.some((f) => f.name === name) ?? false
    })

    const agentReadDirectory = Effect.fn("AgentFS.readDirectory")(function* (path: string) {
      const result = yield* hub.listDir(path).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) return yield* fs.readDirectory(path)
      const list = result as AgentListDirResponse
      return list.files?.map((f) => f.name) ?? []
    })

    const agentReadFile = Effect.fn("AgentFS.readFile")(function* (path: string) {
      const result = yield* hub.readFile(path).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) return yield* fs.readFile(path)
      const r = result as AgentReadFileResponse
      if (r.encoding === "base64") return Buffer.from(r.content, "base64")
      return Buffer.from(r.content, "utf-8")
    })

    const agentWriteFile = Effect.fn("AgentFS.writeFile")(function* (path: string, content: Uint8Array) {
      return yield* agentWriteFileString(path, new TextDecoder().decode(content))
    })

    const agentMakeDirectory = Effect.fn("AgentFS.makeDirectory")(function* (path: string, options?: { recursive?: boolean; mode?: number }) {
      const unixCmd = `mkdir -p "${path}"`
      const winCmd = `cmd /c if not exist "${path}" md "${path}" 2>nul`
      yield* hub.exec(unixCmd).pipe(
        Effect.catch(() => hub.exec(winCmd)),
        Effect.catch(() => fs.makeDirectory(path, options)),
      )
    })

    const agentRemove = Effect.fn("AgentFS.remove")(function* (path: string, options?: { recursive?: boolean; force?: boolean }) {
      const unixCmd = `rm -rf "${path}"`
      const winCmd = `cmd /c if exist "${path}\\" (rd /s /q "${path}") else (del /f /q "${path}" 2>nul)`
      yield* hub.exec(unixCmd).pipe(
        Effect.catch(() => hub.exec(winCmd)),
        Effect.catch(() => fs.remove(path, options)),
      )
    })

    const baseFs: FileSystem.FileSystem = {
      ...fs,
      exists: (p) => agentExists(p),
      makeDirectory: (p, opts) => agentMakeDirectory(p, opts),
      readDirectory: (p) => agentReadDirectory(p),
      readFile: (p) => agentReadFile(p),
      readFileString: (p) => agentReadFileString(p),
      remove: (p, opts) => agentRemove(p, opts),
      stat: (p) => agentStat(p),
      writeFile: (p, data, opts) => agentWriteFile(p, data),
      writeFileString: (p, data, opts) => agentWriteFileString(p, data),
    }

    const existsSafe = Effect.fn("AgentFS.existsSafe")(function* (p: string) {
      return yield* agentExists(p).pipe(Effect.catch(() => Effect.succeed(false)))
    })

    const readFileStringSafe = Effect.fn("AgentFS.readFileStringSafe")(function* (p: string) {
      return yield* agentReadFileString(p).pipe(
        Effect.catch(() => Effect.succeed(undefined as string | undefined)),
      )
    })

    const isDir = Effect.fn("AgentFS.isDir")(function* (p: string) {
      const info = yield* agentStat(p).pipe(Effect.catch(() => Effect.void))
      return info?.type === "Directory"
    })

    const isFile = Effect.fn("AgentFS.isFile")(function* (p: string) {
      const info = yield* agentStat(p).pipe(Effect.catch(() => Effect.void))
      return info?.type === "File"
    })

    const readDirectoryEntries = Effect.fn("AgentFS.readDirectoryEntries")(function* (dirPath: string) {
      const result = yield* hub.listDir(dirPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) {
        const names = yield* fs.readDirectory(dirPath)
        return names.map((n) => ({ name: n, type: "file" as const }))
      }
      const list = result as AgentListDirResponse
      return list.files?.map((f) => ({
        name: f.name,
        type: f.type === "directory" ? ("directory" as const) : ("file" as const),
      })) ?? []
    })

    const readJson = Effect.fn("AgentFS.readJson")(function* (p: string) {
      const text = yield* agentReadFileString(p)
      return JSON.parse(text)
    })

    const writeJson = Effect.fn("AgentFS.writeJson")(function* (p: string, data: unknown, mode?: number) {
      const content = JSON.stringify(data, null, 2)
      yield* agentWriteFileString(p, content)
      if (mode) yield* baseFs.chmod(p, mode)
    })

    const ensureDir = Effect.fn("AgentFS.ensureDir")(function* (p: string) {
      yield* agentMakeDirectory(p, { recursive: true })
    })

    const writeWithDirs = Effect.fn("AgentFS.writeWithDirs")(function* (
      p: string,
      content: string | Uint8Array,
      mode?: number,
    ) {
      const str = typeof content === "string" ? content : new TextDecoder().decode(content)
      const result = yield* hub.writeFile(p, str).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!result) {
        yield* fs.makeDirectory(dirname(p), { recursive: true })
        yield* (typeof content === "string" ? fs.writeFileString(p, content) : fs.writeFile(p, content))
        return
      }
      if (mode) yield* baseFs.chmod(p, mode)
    })

    const glob = Effect.fn("AgentFS.glob")(function* (pattern: string, options?: Glob.Options) {
      return yield* Effect.tryPromise({
        try: () => Glob.scan(pattern, options),
        catch: (cause) => new AppFileSystem.FileSystemError({ method: "glob", cause }),
      })
    })

    const findUp = Effect.fn("AgentFS.findUp")(function* (target: string, start: string, stop?: string) {
      const result: string[] = []
      let current = start
      while (true) {
        const search = join(current, target)
        if (yield* existsSafe(search)) result.push(search)
        if (stop === current) break
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
      return result
    })

    const up = Effect.fn("AgentFS.up")(function* (options: { targets: string[]; start: string; stop?: string }) {
      const result: string[] = []
      let current = options.start
      while (true) {
        for (const target of options.targets) {
          const search = join(current, target)
          if (yield* existsSafe(search)) result.push(search)
        }
        if (options.stop === current) break
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
      return result
    })

    const globUp = Effect.fn("AgentFS.globUp")(function* (pattern: string, start: string, stop?: string) {
      const result: string[] = []
      let current = start
      while (true) {
        const matches = yield* glob(pattern, { cwd: current, absolute: true, include: "file", dot: true }).pipe(
          Effect.catch(() => Effect.succeed([] as string[])),
        )
        result.push(...matches)
        if (stop === current) break
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
      return result
    })

    return AppFileSystem.Service.of({
      ...baseFs,
      existsSafe,
      readFileStringSafe,
      isDir,
      isFile,
      readDirectoryEntries,
      readJson,
      writeJson,
      ensureDir,
      writeWithDirs,
      findUp,
      up,
      globUp,
      glob,
      globMatch: Glob.match,
    })
  }),
)
