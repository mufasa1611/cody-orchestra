#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@cody/script"
import { fileURLToPath } from "url"
import fs from "fs"
import path from "path"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const GH_REPO = process.env.GH_REPO || "mufasa1611/cody-orchestra"
const npmPackage = process.env.CODY_NPM_PACKAGE || "codyx-ai"
const npmOnly = process.env.CODY_NPM_ONLY === "1"
const dryRun = process.env.CODY_NPM_DRY_RUN === "1"

type WrapperPackage = {
  name: string
  version: string
  repository: {
    url: string
  }
  bin: Record<string, string>
  files: string[]
  optionalDependencies: Record<string, string>
}

const expectedPlatformPackages = (name: string) => [
  `${name}-linux-arm64`,
  `${name}-linux-x64`,
  `${name}-linux-x64-baseline`,
  `${name}-linux-arm64-musl`,
  `${name}-linux-x64-musl`,
  `${name}-linux-x64-baseline-musl`,
  `${name}-darwin-arm64`,
  `${name}-darwin-x64`,
  `${name}-darwin-x64-baseline`,
  `${name}-windows-arm64`,
  `${name}-windows-x64`,
  `${name}-windows-x64-baseline`,
]

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (!dryRun && (await published(name, version))) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await Promise.all(
    (await fs.promises.readdir(dir))
      .filter((entry) => entry.endsWith(".tgz"))
      .map((entry) => fs.promises.unlink(path.join(dir, entry))),
  )
  await $`bun pm pack`.cwd(dir)
  if (dryRun) return
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

async function verifyNpmDist(wrapper: WrapperPackage) {
  if (wrapper.name !== npmPackage) throw new Error(`Expected wrapper package ${npmPackage}, found ${wrapper.name}`)
  if (wrapper.bin.codyx !== "./bin/codyx") throw new Error("Wrapper package is missing the codyx bin")
  if (wrapper.bin.cody !== "./bin/cody") throw new Error("Wrapper package is missing the cody bin")
  if (!wrapper.files.includes("bin/")) throw new Error("Wrapper package does not publish bin/")
  if (!wrapper.files.includes("postinstall.mjs")) throw new Error("Wrapper package does not publish postinstall.mjs")
  if (wrapper.repository.url !== `git+https://github.com/${GH_REPO}.git`) {
    throw new Error(`Wrapper repository must point to ${GH_REPO}`)
  }

  const missing = expectedPlatformPackages(npmPackage).filter((name) => !wrapper.optionalDependencies[name])
  if (missing.length > 0) throw new Error(`Missing platform packages: ${missing.join(", ")}`)

  const versionMismatch = Object.entries(wrapper.optionalDependencies).filter((entry) => entry[1] !== wrapper.version)
  if (versionMismatch.length > 0) {
    throw new Error(`Platform package version mismatch: ${versionMismatch.map((entry) => entry.join("@")).join(", ")}`)
  }

  for (const name of expectedPlatformPackages(npmPackage)) {
    const packageJson = Bun.file(path.join(dir, "dist", name, "package.json"))
    const binary = Bun.file(path.join(dir, "dist", name, "bin", name.includes("-windows-") ? "codyx.exe" : "codyx"))
    if (!(await packageJson.exists())) throw new Error(`Missing ${name}/package.json`)
    if (!(await binary.exists())) throw new Error(`Missing binary for ${name}`)
  }
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("**/package.json").scanSync({ cwd: "./dist" })) {
  const pkg = await Bun.file(`./dist/${filepath}`).json()
  if (pkg.name === npmPackage) continue
  binaries[pkg.name] = pkg.version
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]
if (!version) throw new Error("No platform packages found in packages/codyx/dist")
if (Object.values(binaries).some((item) => item !== version)) {
  throw new Error("Platform package versions do not match")
}

const wrapperDir = path.join(dir, "dist", npmPackage)
await fs.promises.mkdir(wrapperDir, { recursive: true })
await fs.promises.cp(path.join(dir, "bin"), path.join(wrapperDir, "bin"), { recursive: true })
await fs.promises.copyFile(path.join(dir, "script", "postinstall.mjs"), path.join(wrapperDir, "postinstall.mjs"))
await Bun.file(`./dist/${npmPackage}/LICENSE`).write(await Bun.file("../../LICENSE").text())

const wrapperPackage = {
  name: npmPackage,
  description: "Codyx local-first coding agent CLI",
  bin: {
    codyx: "./bin/codyx",
    cody: "./bin/cody",
  },
  scripts: {
    postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
  },
  version,
  license: pkg.license,
  repository: {
    type: "git",
    url: `git+https://github.com/${GH_REPO}.git`,
  },
  homepage: `https://github.com/${GH_REPO}`,
  bugs: `https://github.com/${GH_REPO}/issues`,
  engines: {
    node: ">=18",
  },
  files: ["bin/", "postinstall.mjs", "LICENSE"],
  optionalDependencies: binaries,
}

await Bun.file(`./dist/${npmPackage}/package.json`).write(JSON.stringify(wrapperPackage, null, 2))
await verifyNpmDist(wrapperPackage)

for (const [name] of Object.entries(binaries)) {
  await publish(`./dist/${name}`, name, binaries[name])
}
await publish(`./dist/${npmPackage}`, npmPackage, version)

const image = process.env.CODY_DOCKER_IMAGE || "ghcr.io/mufasa1611/cody-orchestra"
const platforms = "linux/amd64,linux/arm64"
const tags = [`${image}:${version}`, `${image}:${Script.channel}`]
const tagFlags = tags.flatMap((t) => ["-t", t])

if (!Script.preview && !npmOnly) {
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`

  const arm64Sha = await $`sha256sum ./dist/${npmPackage}-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/${npmPackage}-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/${npmPackage}-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/${npmPackage}-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='codyx-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    `url='https://github.com/${GH_REPO}'`,
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('codyx')",
    "conflicts=('codyx')",
    "depends=('ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/${GH_REPO}/releases/download/v\${pkgver}\${_subver}/${npmPackage}-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,
    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/${GH_REPO}/releases/download/v\${pkgver}\${_subver}/${npmPackage}-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./codyx "${pkgdir}/usr/bin/codyx"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [["codyx-bin", binaryPkgbuild]]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        if ((await $`cd ./dist/aur-${pkg} && git diff --cached --quiet`.nothrow()).exitCode === 0) break
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch {
        continue
      }
    }
  }

  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Codyx < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://github.com/${GH_REPO}"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    `  depends_on "ripgrep"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/${GH_REPO}/releases/download/v${Script.version}/${npmPackage}-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "codyx"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/${GH_REPO}/releases/download/v${Script.version}/${npmPackage}-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "codyx"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/${GH_REPO}/releases/download/v${Script.version}/${npmPackage}-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "codyx"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/${GH_REPO}/releases/download/v${Script.version}/${npmPackage}-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "codyx"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error("GITHUB_TOKEN is required to update homebrew tap")
    process.exit(1)
  }
  const tap = `https://x-access-token:${token}@github.com/${GH_REPO}-homebrew-tap.git`
  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone ${tap} ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/codyx.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add codyx.rb`
  if ((await $`cd ./dist/homebrew-tap && git diff --cached --quiet`.nothrow()).exitCode !== 0) {
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }
}
