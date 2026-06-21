#!/usr/bin/env node

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { binaryName, packageNames } = require("./bin/_platform.cjs")

function findBinary() {
  const binary = binaryName()
  const errors = []
  for (const packageName of packageNames()) {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`)
      const binaryPath = path.join(path.dirname(packageJsonPath), "bin", binary)
      if (fs.existsSync(binaryPath)) return binaryPath
      errors.push(`Binary not found at ${binaryPath}`)
    } catch (error) {
      errors.push(`${packageName}: ${error.message}`)
    }
  }
  throw new Error(errors.join("; "))
}

async function main() {
  try {
    const binaryPath = findBinary()
    const target = path.join(__dirname, "bin", os.platform() === "win32" ? ".cody.exe" : ".cody")
    if (fs.existsSync(target)) fs.unlinkSync(target)
    try {
      fs.linkSync(binaryPath, target)
    } catch {
      fs.copyFileSync(binaryPath, target)
    }
    if (os.platform() !== "win32") fs.chmodSync(target, 0o755)
  } catch (error) {
    console.error("Failed to setup codyx binary:", error.message)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Postinstall script error:", error)
  process.exit(1)
})
