const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const { binaryName, packageNames } = require("./_platform.cjs")

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"]

function run(target) {
  const child = childProcess.spawn(target, process.argv.slice(2), {
    stdio: "inherit",
    env: {
      ...process.env,
      CODY_INSTALL_METHOD: process.env.CODY_INSTALL_METHOD || "npm",
    },
  })

  child.on("error", (error) => {
    console.error(error.message)
    process.exit(1)
  })

  const forwarders = {}
  for (const signal of forwardedSignals) {
    forwarders[signal] = () => {
      try {
        child.kill(signal)
      } catch {
        // The child may have already exited.
      }
    }
    process.on(signal, forwarders[signal])
  }

  child.on("exit", (code, signal) => {
    for (const forwardedSignal of forwardedSignals) {
      process.removeListener(forwardedSignal, forwarders[forwardedSignal])
    }

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(typeof code === "number" ? code : 0)
  })
}

module.exports = function (name) {
  const envPath = process.env.CODY_BIN_PATH
  const scriptPath = fs.realpathSync(process.argv[1])
  const scriptDir = path.dirname(scriptPath)
  const cached = path.join(scriptDir, os.platform() === "win32" ? ".cody.exe" : ".cody")

  const binary = binaryName()
  const names = packageNames()

  function findBinary(startDir) {
    let current = startDir
    for (;;) {
      const modules = path.join(current, "node_modules")
      if (fs.existsSync(modules)) {
        for (const name of names) {
          const candidate = path.join(modules, name, "bin", binary)
          if (fs.existsSync(candidate)) return candidate
        }
      }
      const parent = path.dirname(current)
      if (parent === current) return null
      current = parent
    }
  }

  const resolved = envPath || (fs.existsSync(cached) ? cached : findBinary(scriptDir))
  if (!resolved) {
    console.error(
      `It seems that your package manager failed to install the right version of the ${name} CLI for your platform. You can try manually installing ` +
        names.map((n) => `"${n}"`).join(" or ") +
        " package",
    )
    process.exit(1)
  }
  run(resolved)
}
