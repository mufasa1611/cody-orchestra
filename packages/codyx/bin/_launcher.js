const childProcess = require("child_process")
const fs = require("fs")
const path = require("path")
const os = require("os")
const readline = require("readline")
const { binaryName, packageNames } = require("./_platform.cjs")

const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"]

function run(target, args) {
  const child = childProcess.spawn(target, args, {
    stdio: "inherit",
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

function shouldShowMenu(args) {
  return (
    process.platform === "win32" &&
    args.length === 0 &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.CODYX_LAUNCHER_MENU !== "0"
  )
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase())
    })
  })
}

async function chooseArgs(target) {
  childProcess.spawnSync(target, ["--print-banner-only"], {
    stdio: "inherit",
  })
  console.log("What would you like to start?")
  console.log("  [1] Codyx CLI (Terminal UI)")
  console.log("  [2] Codyx Web UI (Browser)")
  console.log("  [q] Quit")
  const answer = await ask("Choose [1]: ")
  if (answer === "q" || answer === "quit" || answer === "exit") process.exit(0)
  if (answer === "2" || answer === "web" || answer === "w") return ["web"]
  return ["--no-banner"]
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
      if (parent === current) return
      current = parent
    }
  }

  const resolved = envPath || (fs.existsSync(cached) ? cached : findBinary(scriptDir))
  if (!resolved) {
    console.error(`It seems that your package manager failed to install the right version of the ${name} CLI for your platform. You can try manually installing ` + names.map((n) => `\"${n}\"`).join(" or ") + " package")
    process.exit(1)
  }
  const args = process.argv.slice(2)
  if (!shouldShowMenu(args)) {
    run(resolved, args)
    return
  }
  chooseArgs(resolved).then(
    (selectedArgs) => run(resolved, selectedArgs),
    (error) => {
      console.error(error.message)
      process.exit(1)
    },
  )
}
