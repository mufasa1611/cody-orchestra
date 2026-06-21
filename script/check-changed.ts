#!/usr/bin/env bun

import fs from "fs"

const explicitBase = process.argv.slice(2).find((arg) => arg !== "--" && arg.length > 0)

function git(args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) return
  return result.stdout.toString().trim()
}

function changedFiles() {
  if (explicitBase && git(["cat-file", "-e", `${explicitBase}^{commit}`]) !== undefined) {
    return git(["diff", "--name-only", "--diff-filter=ACMR", `${explicitBase}...HEAD`]) ?? ""
  }

  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]) ?? ""
  if (staged) return staged

  if (process.env.CI) {
    return git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]) ?? ""
  }

  return git(["diff", "--name-only", "--diff-filter=ACMR"]) ?? ""
}

const files = changedFiles()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())

if (files.length === 0) {
  console.log("No changed files to check")
  process.exit(0)
}

function run(command: string[]) {
  const result = Bun.spawnSync(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

run(["bunx", "prettier", "--check", "--ignore-unknown", "--", ...files])

const lintFiles = files.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file))
if (lintFiles.length > 0) {
  run(["bunx", "oxlint", "--quiet", "--", ...lintFiles])
}
