#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install cody-x on Windows — single-command setup for novice users.
.DESCRIPTION
    Detects prerequisites (Git, Bun, cloudflared), installs what's missing,
    clones/updates the repo, installs dependencies, builds the web UI,
    configures the Cloudflare proxy tunnel, and installs the global cody-x command.
.PARAMETER Yes
    Auto-confirm all prompts (non-interactive mode).
.PARAMETER Branch
    Git branch to clone/checkout (default: main).
.PARAMETER NoScan
    Skip local model discovery (Ollama/GGUF scanning).
.PARAMETER NoProxy
    Skip Cloudflare proxy tunnel setup.
.PARAMETER NoBuild
    Skip web UI build.
.PARAMETER InstallRoot
    Directory to clone/install cody-x into (default: ~\AppData\Local\cody-x).
.EXAMPLE
    irm https://raw.githubusercontent.com/mufasa1611/cody-x/main/script/install.ps1 | iex
.EXAMPLE
    .\install.ps1 -Yes -Branch dev -NoScan -NoProxy
#>
param(
  [switch]$Yes,
  [string]$Branch = "main",
  [switch]$NoScan,
  [switch]$NoProxy,
  [switch]$NoBuild,
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "cody-x Installer"

# ── Configuration ──────────────────────────────────────────────────────
$RepoUrl = "https://github.com/mufasa1611/cody-x.git"
$DefaultParent = Join-Path $env:LOCALAPPDATA "cody-x"
$Root = if ($InstallRoot) { $InstallRoot } else { $DefaultParent }
$GlobalBin = Join-Path $env:APPDATA "npm"
$GlobalCmd = Join-Path $GlobalBin "cody-x.cmd"
$ScriptDir = Split-Path -Parent $PSScriptRoot
$IsStandalone = -not (Test-Path (Join-Path $ScriptDir "..\cody-x.cmd"))

# ── Helpers ────────────────────────────────────────────────────────────

function Write-Step($Message) {
  Write-Host ">> $Message" -ForegroundColor Cyan
}

function Write-Ok($Message) {
  Write-Host "[ok] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Host "[warn] $Message" -ForegroundColor Yellow
}

function Write-Err($Message) {
  Write-Host "[error] $Message" -ForegroundColor Red
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-WithWinget($Id, $Label) {
  if (-not (Test-Command winget)) {
    Write-Err "$Label is required. Install it manually, then rerun."
    return $false
  }
  Write-Step "Installing $Label with winget..."
  $result = & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to install $Label. Install it manually, then rerun."
    return $false
  }
  Write-Ok "$Label installed."
  return $true
}

function Invoke-WithRetry($ScriptBlock, $Label, $MaxRetries = 3) {
  $backoff = 1
  for ($i = 0; $i -lt $MaxRetries; $i++) {
    try {
      & $ScriptBlock
      return
    } catch {
      if ($i -eq $MaxRetries - 1) { throw }
      Write-Warn "$Label failed (attempt $($i+1)/$MaxRetries). Retrying in ${backoff}s..."
      Start-Sleep -Seconds $backoff
      $backoff = [Math]::Min($backoff * 2, 16)
    }
  }
}

function Add-UserPathEntry($entry) {
  $full = [System.IO.Path]::GetFullPath($entry).TrimEnd("\")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $items = @()
  if ($userPath) { $items = $userPath -split ";" | Where-Object { $_ -and $_.Trim() } }
  $exists = $false
  foreach ($item in $items) {
    $expanded = [Environment]::ExpandEnvironmentVariables($item)
    try { $normalized = [System.IO.Path]::GetFullPath($expanded).TrimEnd("\") } catch { $normalized = $expanded.TrimEnd("\") }
    if ($normalized.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) { $exists = $true; break }
  }
  if (-not $exists) {
    $next = @($items + $full) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
    Write-Ok "Added $full to user PATH"
  }
  $currentItems = @($env:PATH -split ";" | Where-Object { $_ -and $_.Trim() })
  $inCurrent = $false
  foreach ($item in $currentItems) {
    $expanded = [Environment]::ExpandEnvironmentVariables($item)
    try { $normalized = [System.IO.Path]::GetFullPath($expanded).TrimEnd("\") } catch { $normalized = $expanded.TrimEnd("\") }
    if ($normalized.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) { $inCurrent = $true; break }
  }
  if (-not $inCurrent) { $env:PATH = "$full;$env:PATH" }
}

# ── Banner ─────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗"
Write-Host "  ║        cody-x Windows Installer        ║"
Write-Host "  ╚═══════════════════════════════════════╝"
Write-Host ""

# ── Phase 1: Check prerequisites ──────────────────────────────────────

Write-Step "Checking prerequisites..."

if (-not (Test-Command git)) {
  Write-Warn "Git not found."
  $ok = Install-WithWinget "Git.Git" "Git"
  if (-not $ok) { exit 1 }
}

if (-not (Test-Command bun)) {
  Write-Step "Bun not found. Installing Bun..."
  $null = & powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  if ($LASTEXITCODE -ne 0) { Write-Err "Bun installation failed."; exit 1 }
  $env:PATH = "$env:USERPROFILE\.bun\bin;$env:APPDATA\npm;$env:PATH"
  if (-not (Test-Command bun)) { Write-Err "Bun still not found after install. Open a new terminal and rerun."; exit 1 }
  Write-Ok "Bun installed."
} else {
  Write-Ok "Bun found."
}

if (-not $NoProxy) {
  if (-not (Test-Command cloudflared)) {
    Write-Warn "cloudflared not found."
    $ok = Install-WithWinget "Cloudflare.cloudflared" "cloudflared"
    if (-not $ok) { Write-Warn "cloudflared install skipped. Proxy tunnel won't auto-start." }
  } else {
    Write-Ok "cloudflared found."
  }
} else {
  Write-Ok "Proxy setup skipped (--NoProxy)."
}

# ── Phase 2: Clone or update repo ─────────────────────────────────────

Write-Step "Setting up cody-x checkout..."

if ($IsStandalone) {
  if (Test-Path $Root) {
    if (Test-Path (Join-Path $Root "cody-x.cmd")) {
      Write-Ok "Existing checkout found at $Root"
    } else {
      Write-Err "Directory $Root exists but is not a cody-x checkout."
      Write-Err "Move it away or remove it, then rerun."
      exit 1
    }
  } else {
    Write-Step "Cloning cody-x from $RepoUrl (branch: $Branch)..."
    $null = New-Item -ItemType Directory -Force -Path $DefaultParent
    Invoke-WithRetry {
      & git clone --branch $Branch $RepoUrl $Root 2>&1
      if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
    } "git clone"
    git config --global --add safe.directory "$Root" 2>$null
    Write-Ok "Cloned to $Root"
  }

  # Update if .git exists
  if (Test-Path (Join-Path $Root ".git")) {
    Push-Location $Root
    $currentBranch = git branch --show-current 2>$null
    if ($currentBranch -and $currentBranch -ne $Branch) {
      Write-Step "Switching to branch $Branch..."
      Invoke-WithRetry {
        & git fetch origin $Branch --quiet 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }
        & git switch $Branch 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git switch failed" }
      } "git fetch/switch"
    }
    Invoke-WithRetry {
      & git pull --ff-only 2>&1
      if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
    } "git pull"
    Pop-Location
    Write-Ok "Repository up to date."
  }
} else {
  $Root = Resolve-Path (Join-Path $ScriptDir "..")
  Write-Ok "Running from local checkout: $Root"
}

Set-Location $Root

# ── Phase 3: Install dependencies ─────────────────────────────────────

Write-Step "Installing dependencies..."

Invoke-WithRetry {
  $result = & bun install 2>&1
  if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
} "bun install"

Write-Ok "Dependencies installed."

# ── Phase 4: Build web UI ─────────────────────────────────────────────

if (-not $NoBuild) {
  Write-Step "Building web UI..."
  Push-Location (Join-Path $Root "packages\app")
  $result = & bun run build 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Web UI build failed. Server will proxy to app.cody.ai."
  } else {
    Write-Ok "Web UI built."
  }
  Pop-Location
} else {
  Write-Ok "Web UI build skipped (--NoBuild)."
}

# ── Phase 5: Configure proxy ──────────────────────────────────────────

if (-not $NoProxy) {
  Write-Step "Configuring proxy settings..."
  $envFile = Join-Path $Root ".env.proxy"
  if (-not (Test-Path $envFile)) {
    @"
CODY_PROXY_ENABLED=1
HTTPS_PROXY=http://localhost:9999
HTTP_PROXY=http://localhost:9999
NO_PROXY=localhost,127.0.0.1,::1
"@ | Set-Content -Encoding ASCII -Path $envFile
    Write-Ok ".env.proxy created with proxy settings."
  } else {
    Write-Ok ".env.proxy already exists."
  }
} else {
  Write-Ok "Proxy configuration skipped (--NoProxy)."
}

# ── Phase 6: Model discovery ──────────────────────────────────────────

if (-not $NoScan) {
  if ($Yes) {
    Write-Step "Running model discovery..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "script\discover-local-models.ps1") -Root $Root -MaxSeconds 30
    Write-Ok "Model discovery complete."
  } else {
    Write-Host ""
    $scan = Read-Host "Scan for local Ollama/GGUF models? [y/N] "
    if ($scan -eq "y") {
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "script\discover-local-models.ps1") -Root $Root -MaxSeconds 30
      Write-Ok "Model discovery complete."
    } else {
      Write-Ok "Model discovery skipped. Run later: .\script\discover-local-models.ps1"
    }
  }
} else {
  Write-Ok "Model discovery skipped (--NoScan)."
}

# Ensure default config
$generatedDir = Join-Path $Root ".cody\generated"
$null = New-Item -ItemType Directory -Force -Path $generatedDir
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "script\ensure-default-config.ps1") -Root $Root

# ── Phase 7: Install global command ───────────────────────────────────

Write-Step "Installing global cody-x command..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "script\install-cody-x-global.ps1")
if ($LASTEXITCODE -ne 0) {
  Write-Err "Global command install failed."
  exit 1
}

# ── Phase 8: Health check ─────────────────────────────────────────────

Write-Step "Running health check..."
Push-Location (Join-Path $Root "packages\cody")
try {
  $version = & bun run --conditions=browser src\index.ts --version 2>$null
  if ($version) { Write-Ok "cody-x version: $version" }
} catch {
  Write-Warn "Health check could not start cody-x."
}
Pop-Location

# ── Phase 9: Uninstall shortcut ───────────────────────────────────────

Write-Step "Creating uninstall shortcut..."
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\cody-x"
$null = New-Item -ItemType Directory -Force -Path $startMenu
$shortcutPath = Join-Path $startMenu "Uninstall cody-x.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/c `"$GlobalCmd`" uninstall"
$shortcut.Description = "Uninstall cody-x"
$shortcut.WorkingDirectory = $Root
$shortcut.Save()
Write-Ok "Uninstall shortcut created."

# ── Done ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════╗"
Write-Host "  ║   cody-x installed successfully!      ║"
Write-Host "  ╚═══════════════════════════════════════╝"
Write-Host ""
Write-Host "  Installed to:  $Root"
Write-Host "  Global command: cody-x"
if (-not $NoProxy) { Write-Host "  Proxy:         enabled (Cloudflare tunnel)" }
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    cody-x           Launch interactive menu (TUI)"
Write-Host "    cody-x web       Start web UI in browser"
Write-Host "    cody-x --help    See all commands"
Write-Host "    cody-x doctor    Run diagnostics"
Write-Host ""
Write-Host "  Open a NEW terminal window for 'cody-x' to be on PATH."
Write-Host ""
