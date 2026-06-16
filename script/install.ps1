#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install codyx on Windows - single-command setup for novice users.
.DESCRIPTION
    Detects prerequisites, verifies email ownership, installs what's missing,
    clones/updates the repo, installs dependencies, builds the web UI, configures
    the Cloudflare proxy tunnel, and installs the global codyx command.
.PARAMETER Yes
    Auto-confirm optional installer prompts. Email verification is never bypassed.
.PARAMETER Branch
    Git branch to clone/checkout (default: main).
.PARAMETER NoScan
    Skip local model discovery (Ollama/GGUF scanning).
.PARAMETER NoProxy
    Skip Cloudflare proxy tunnel setup.
.PARAMETER NoBuild
    Skip web UI build.
.PARAMETER InstallRoot
    Directory to clone/install codyx into (default: ~\AppData\Local\codyx).
.EXAMPLE
    irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install.ps1 | iex
.EXAMPLE
    .\install.ps1 -Yes -Branch dev -NoScan -NoProxy
#>
param(
  [switch]$Yes,
  [string]$Branch = "main",
  [switch]$NoScan,
  [switch]$NoProxy,
  [switch]$NoBuild,
  [switch]$Verbose,
  [string]$InstallRoot = ""
)

$ErrorActionPreference = "Stop"
try { $Host.UI.RawUI.WindowTitle = "codyx Installer" } catch {}

# Version & credits
$Script:CODY_VERSION = "1.0.0"
$Script:REPO_URL = "https://github.com/mufasa1611/cody-orchestra.git"
$Script:CREDITS = "Builder: M. Farid (Mufasa) | Repo: $REPO_URL"
$Script:VERIFICATION_URL = "https://install.kingkung.men"

# Configuration
$RepoUrl = $Script:REPO_URL
$DefaultParent = Join-Path $env:LOCALAPPDATA "codyx"
$Root = if ($InstallRoot) { $InstallRoot } else { $DefaultParent }
$GlobalBin = Join-Path $env:APPDATA "npm"
$GlobalCmd = Join-Path $GlobalBin "codyx.cmd"
$CheckoutRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { $null }
$IsStandalone = -not ($CheckoutRoot -and (Test-Path (Join-Path $CheckoutRoot "codyx.cmd")))
$CreatedRepo = $false

# Verbose logging
$VerbosePref = if ($Verbose) { "Continue" } else { "SilentlyContinue" }

# Helpers

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

function Write-Section($Number, $Label) {
  Write-Host ""
  Write-Host "=== $Number. $Label ===" -ForegroundColor Cyan
}

function Write-VerboseMsg($Message) {
  if ($Verbose) { Write-Host "  [verbose] $Message" -ForegroundColor DarkGray }
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-BunVersion {
  if (-not (Test-Command bun)) { return $false }
  try {
    return [version](& bun --version) -ge [version]"1.3.13"
  } catch {
    return $false
  }
}

function Test-InteractiveHost {
  if (-not [Environment]::UserInteractive) { return $false }
  try { return -not [Console]::IsInputRedirected } catch { return $true }
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

# Installation helpers

function Install-WithWinget($Id, $Label) {
  if (-not (Test-Command winget)) {
    return $null
  }
  Write-Step "Installing $Label with winget..."
  & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "winget install failed."
    return $false
  }
  Write-Ok "$Label installed via winget."
  return $true
}

function Install-WithChoco($Label) {
  if (-not (Test-Command choco)) {
    return $null
  }
  Write-Step "Installing $Label with Chocolatey..."
  & choco install $Label -y --no-progress | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Chocolatey install failed."
    return $false
  }
  Write-Ok "$Label installed via Chocolatey."
  return $true
}

function Install-EnsureCommand($Name, $WingetId, $Label) {
  if (Test-Command $Name) {
    Write-Ok "$Label found."
    return $true
  }

  Write-Warn "$Label not found."

  # Try winget
  $result = Install-WithWinget $WingetId $Label
  if ($result -eq $true) {
    if (Test-Command $Name) { return $true }
  }

  # Try choco as fallback
  if ($result -ne $true) {
    $result = Install-WithChoco $Label
    if ($result -eq $true) {
      refreshenv 2>$null
      if (Test-Command $Name) { return $true }
    }
  }

  # All methods failed
  Write-Err "$Label is required. Install it manually, then rerun."
  return $false
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

function Sync-InstallCheckout($TargetBranch) {
  Write-VerboseMsg "Fetching origin/$TargetBranch..."
  & git fetch origin $TargetBranch --quiet
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed" }

  $currentBranch = (& git branch --show-current 2>$null).Trim()
  if (-not $currentBranch) {
    Write-Step "Reattaching checkout to branch $TargetBranch..."
    & git switch -C $TargetBranch --track origin/$TargetBranch
    if ($LASTEXITCODE -ne 0) { throw "git switch failed" }
  } elseif ($currentBranch -ne $TargetBranch) {
    Write-Step "Switching to branch $TargetBranch..."
    & git switch $TargetBranch
    if ($LASTEXITCODE -ne 0) {
      & git switch -C $TargetBranch --track origin/$TargetBranch
      if ($LASTEXITCODE -ne 0) { throw "git switch failed" }
    }
  }

  $counts = (& git rev-list --left-right --count HEAD...origin/$TargetBranch 2>$null).Trim()
  $ahead = 0
  $behind = 0
  if ($counts) {
    $parts = $counts -split "\s+"
    if ($parts.Length -ge 2) {
      [void][int]::TryParse($parts[0], [ref]$ahead)
      [void][int]::TryParse($parts[1], [ref]$behind)
    }
  }

  $trackedChanges = @(& git status --porcelain --untracked-files=no 2>$null | Where-Object { $_ -and $_.Trim() })
  $needsRepair = $ahead -gt 0 -or $trackedChanges.Count -gt 0

  if ($needsRepair) {
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupBranch = "installer-backup-$timestamp"
    $patchPath = Join-Path $env:TEMP "codyx-install-backup-$timestamp.patch"
    Write-Warn "Existing install checkout has local tracked changes or divergent commits."
    Write-Warn "Creating backup branch $backupBranch and patch $patchPath before repair."
    & git branch $backupBranch | Out-Null
    if ($trackedChanges.Count -gt 0) {
      & git diff --binary > $patchPath
    }
  }

  if ($behind -gt 0 -or $needsRepair) {
    Write-Step "Syncing install checkout to origin/$TargetBranch..."
    & git reset --hard origin/$TargetBranch
    if ($LASTEXITCODE -ne 0) { throw "git reset failed" }
  } else {
    Write-Ok "Repository already up to date."
  }
}

# Banner

Write-Host ""
Write-Host "  =======================================" -ForegroundColor Cyan
Write-Host "       codyx Windows Installer v$($Script:CODY_VERSION)" -ForegroundColor Cyan
Write-Host "  =======================================" -ForegroundColor Cyan
Write-Host "  $($Script:CREDITS)" -ForegroundColor DarkGray

# Phase 1: Prerequisites

Write-Section 1 "Prerequisites"

if (-not (Test-Command git)) {
  $ok = Install-EnsureCommand "git" "Git.Git" "Git"
  if (-not $ok) { exit 1 }
}

# Proxy awareness: pass HTTP_PROXY env vars to git if set
$gitProxyArgs = ""
if ($env:HTTP_PROXY -or $env:HTTPS_PROXY) {
  $proxy = $env:HTTPS_PROXY -or $env:HTTP_PROXY
  Write-VerboseMsg "Detected proxy: $proxy"
  $env:GIT_HTTP_PROXY = $proxy
  $env:GIT_HTTPS_PROXY = $proxy
}

if (-not (Test-BunVersion)) {
  if (Test-Command bun) {
    Write-Warn "Bun 1.3.13 or newer is required. Updating Bun..."
  } else {
    Write-Step "Bun not found. Installing Bun..."
  }
  $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $null = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  if ($LASTEXITCODE -ne 0) { Write-Err "Bun installation failed."; exit 1 }
  $env:PATH = "$env:USERPROFILE\.bun\bin;$env:APPDATA\npm;$env:PATH"
  if (-not (Test-BunVersion)) { Write-Err "Bun 1.3.13+ is still unavailable after install."; exit 1 }
  Write-Ok "Bun 1.3.13+ installed."
} else {
  Write-Ok "Bun 1.3.13+ found."
}

# Email verification intentionally runs after Git/Bun and before any remaining
# installation work. The -Yes switch never bypasses this gate.
Write-Step "Loading installer email verification..."
$verificationPath = if ($CheckoutRoot) {
  Join-Path $CheckoutRoot "script\installer-verification.ps1"
} else {
  $null
}
$verificationParameters = @{
  InstallerVersion = $Script:CODY_VERSION
  ServiceUrl = $Script:VERIFICATION_URL
  ReceiptPath = (Join-Path $env:LOCALAPPDATA "codyx-installer\verification.json")
  NonInteractive = -not (Test-InteractiveHost)
}

if ($verificationPath -and (Test-Path -LiteralPath $verificationPath)) {
  $verificationResult = & $verificationPath @verificationParameters
} else {
  $verificationSource = $null
  $verificationScriptUrl = "https://raw.githubusercontent.com/mufasa1611/cody-orchestra/$Branch/script/installer-verification.ps1"
  try {
    Invoke-WithRetry {
      $Script:verificationSource = Invoke-RestMethod -Uri $verificationScriptUrl -TimeoutSec 20
    } "verification helper download"
  } catch {
    Write-Err "Could not load the installer verification step."
    Write-Err "Git and Bun will remain installed. Rerun the installer when GitHub is available."
    exit 1
  }
  $verificationResult = & ([scriptblock]::Create($Script:verificationSource)) @verificationParameters
}

if (-not $verificationResult.Success) {
  exit 1
}

if (-not $NoProxy) {
  if (-not (Test-Command cloudflared)) {
    Write-Warn "cloudflared not found."
    $ok = Install-WithWinget "Cloudflare.cloudflared" "cloudflared"
    if ($ok -ne $true) { Write-Warn "cloudflared install skipped. Proxy tunnel won't auto-start." }
  } else {
    Write-Ok "cloudflared found."
  }
} else {
  Write-Ok "Proxy setup skipped (--NoProxy)."
}

# Phase 2: Clone or update repo

Write-Section 2 "Repository"

if ($IsStandalone) {
  if (Test-Path $Root) {
    if (Test-Path (Join-Path $Root "codyx.cmd")) {
      Write-Ok "Existing checkout found at $Root"
    } else {
      Write-Err "Directory $Root exists but is not a codyx checkout."
      Write-Err "Move it away or remove it, then rerun."
      exit 1
    }
  } else {
    Write-Step "Cloning codyx from $RepoUrl (branch: $Branch)..."
    $null = New-Item -ItemType Directory -Force -Path $DefaultParent
    $activity = "Cloning codyx repository"
    Invoke-WithRetry {
      & git clone --branch $Branch $RepoUrl $Root
      if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
    } "git clone"
    git config --global --add safe.directory "$Root" 2>$null
    $Script:CreatedRepo = $true
    Write-Ok "Cloned to $Root"
  }

  # Update if .git exists
  if (Test-Path (Join-Path $Root ".git")) {
    Push-Location $Root
    Invoke-WithRetry {
      Sync-InstallCheckout $Branch
    } "git sync"
    Pop-Location
    Write-Ok "Repository up to date."
  }
} else {
  $Root = $CheckoutRoot
  Write-Ok "Running from local checkout: $Root"
}

Set-Location $Root

# Phase 3: Dependencies

Write-Section 3 "Dependencies"

Write-Step "Installing dependencies..."

$activity = "Installing npm/bun dependencies"
Write-Progress -Activity $activity -Status "Running bun install..." -PercentComplete 30
Invoke-WithRetry {
  & bun install
  if ($LASTEXITCODE -ne 0) { throw "bun install failed" }
} "bun install"
Write-Progress -Activity $activity -Completed

Write-Ok "Dependencies installed."

# Phase 4: Web UI

if (-not $NoBuild) {
  Write-Section 4 "Web UI"

  Write-Step "Building web UI..."
  Push-Location (Join-Path $Root "packages\app")
  $activity = "Building web UI"
  Write-Progress -Activity $activity -Status "Running bun run build..." -PercentComplete 50
  & bun run build
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Web UI build failed. Server will proxy to app.codyx.ai."
  } else {
    Write-Ok "Web UI built."
  }
  Write-Progress -Activity $activity -Completed
  Pop-Location
} else {
  Write-Ok "Web UI build skipped (--NoBuild)."
}

# Phase 5: Proxy

Write-Section 5 "Proxy configuration"

if (-not $NoProxy) {
  Write-Step "Configuring proxy settings..."
  $envFile = Join-Path $Root ".env.proxy"
  if (-not (Test-Path $envFile)) {
    @"
CODY_PROXY_ENABLED=0
HTTPS_PROXY=http://localhost:9999
HTTP_PROXY=http://localhost:9999
NO_PROXY=localhost,127.0.0.1,::1
"@ | Set-Content -Encoding ASCII -Path $envFile
    Write-Ok ".env.proxy created (proxy disabled by default)."
    Write-Warn "To enable: edit .env.proxy and set CODY_PROXY_ENABLED=1"
  } else {
    Write-Ok ".env.proxy already exists."
  }
} else {
  Write-Ok "Proxy configuration skipped (--NoProxy)."
}

# Phase 6: Model discovery

Write-Section 6 "Model discovery"

if (-not $NoScan) {
  if ($Yes) {
    Write-Step "Running model discovery..."
    & (Join-Path $Root "script\discover-local-models.ps1") -Root $Root -MaxSeconds 30
  } else {
    Write-Host ""
    $scan = Read-Host "Scan for local Ollama/GGUF models? [y/N] "
    if ($scan -eq "y") {
      & (Join-Path $Root "script\discover-local-models.ps1") -Root $Root -MaxSeconds 30
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
& (Join-Path $Root "script\ensure-default-config.ps1") -Root $Root

# Phase 7: Global command

Write-Section 7 "Global command"

Write-Step "Installing global codyx command..."
& (Join-Path $Root "script\install-codyx-global.ps1") -Root $Root
if ($LASTEXITCODE -ne 0) {
  Write-Err "Global command install failed."
  exit 1
}

# Phase 8: Health check

Write-Section 8 "Health check"

Write-Step "Running health check..."
$version = $null
try {
  $previousSkipUpdate = $env:CODY_SKIP_UPDATE_CHECK
  $env:CODY_SKIP_UPDATE_CHECK = "1"
  $versionCommand = "`"`"$GlobalCmd`" --version 2>&1`""
  $version = & $env:ComSpec /d /s /c $versionCommand | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0 -or -not $version) { throw "global command failed" }
  Write-Ok "codyx version: $version"
} catch {
  Write-Err "The global codyx command could not start."
  exit 1
} finally {
  $env:CODY_SKIP_UPDATE_CHECK = $previousSkipUpdate
}

# Phase 9: Shortcuts

Write-Section 9 "Shortcuts"

Write-Step "Creating uninstall shortcut..."
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\codyx"
$null = New-Item -ItemType Directory -Force -Path $startMenu
$shortcutPath = Join-Path $startMenu "Uninstall codyx.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/c `"$GlobalCmd`" uninstall"
$shortcut.Description = "Uninstall codyx"
$shortcut.WorkingDirectory = $Root
$shortcut.Save()
Write-Ok "Uninstall shortcut created."

# Done

Write-Host ""
Write-Host "  =======================================" -ForegroundColor Green
Write-Host "       codyx installed successfully!     " -ForegroundColor Green
Write-Host "  =======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to:  $Root" -ForegroundColor White
Write-Host "  Global command: codyx" -ForegroundColor White
if ($version) { Write-Host "  Version:       $version" -ForegroundColor White }
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    codyx           Launch interactive menu (TUI)"
Write-Host "    codyx web       Start web UI in browser"
Write-Host "    codyx --help    See all commands"
Write-Host "    codyx doctor    Run diagnostics"
Write-Host ""
Write-Host "  $($Script:CREDITS)" -ForegroundColor DarkGray
Write-Host ""
