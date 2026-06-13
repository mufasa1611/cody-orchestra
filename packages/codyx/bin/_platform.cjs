const childProcess = require("child_process")
const fs = require("fs")
const os = require("os")

function platformName() {
  return {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  }[os.platform()] || os.platform()
}

function archName() {
  return {
    x64: "x64",
    arm64: "arm64",
    arm: "arm",
  }[os.arch()] || os.arch()
}

function supportsAvx2(platform, arch) {
  if (arch !== "x64") return false
  if (platform === "linux") {
    try {
      return /(^|\s)avx2(\s|$)/i.test(fs.readFileSync("/proc/cpuinfo", "utf8"))
    } catch {
      return false
    }
  }
  if (platform === "darwin") {
    try {
      const result = childProcess.spawnSync("sysctl", ["-n", "hw.optional.avx2_0"], {
        encoding: "utf8",
        timeout: 1500,
      })
      return result.status === 0 && (result.stdout || "").trim() === "1"
    } catch {
      return false
    }
  }
  if (platform === "windows") {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'
    for (const exe of ["powershell.exe", "pwsh.exe", "pwsh", "powershell"]) {
      try {
        const result = childProcess.spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", cmd], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const out = (result.stdout || "").trim().toLowerCase()
        if (out === "true" || out === "1") return true
      } catch {
        continue
      }
    }
  }
  return false
}

function usesMusl() {
  try {
    if (fs.existsSync("/etc/alpine-release")) return true
  } catch {}
  try {
    const result = childProcess.spawnSync("ldd", ["--version"], { encoding: "utf8" })
    return ((result.stdout || "") + (result.stderr || "")).toLowerCase().includes("musl")
  } catch {
    return false
  }
}

function packageNames() {
  const platform = platformName()
  const arch = archName()
  const base = `codyx-ai-${platform}-${arch}`
  const baseline = arch === "x64" && !supportsAvx2(platform, arch)

  if (platform === "linux") {
    if (usesMusl()) {
      if (arch === "x64") {
        if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
        return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      }
      return [`${base}-musl`, base]
    }
    if (arch === "x64") {
      if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
      return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    }
    return [base, `${base}-musl`]
  }

  if (arch === "x64") {
    if (baseline) return [`${base}-baseline`, base]
    return [base, `${base}-baseline`]
  }
  return [base]
}

function binaryName() {
  return platformName() === "windows" ? "codyx.exe" : "codyx"
}

module.exports = { binaryName, packageNames, platformName }
