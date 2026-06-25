<#
.SYNOPSIS
  codyx Windows one-liner npm installer.
  Installs Node.js LTS (if needed) then installs codyx-ai from npm.

.EXAMPLE
  # Standard install (latest release):
  irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install-npm.ps1 | iex

  # Specific version or beta tag:
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install-npm.ps1))) -Tag beta
  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/mufasa1611/cody-orchestra/main/script/install-npm.ps1))) -Version 1.15.1

.PARAMETER Tag
  npm dist-tag to install (default: latest). Use "beta" for pre-releases.

.PARAMETER Version
  Exact version to install, e.g. 1.15.1. Overrides Tag.

.PARAMETER NoVerify
  Skip the post-install smoke test.
#>
param(
  [string]$Tag     = "latest",
  [string]$Version = "",
  [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Ok($msg)   { Write-Host "[ok]   $msg" -ForegroundColor Green  }
function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Cyan   }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[err]  $msg" -ForegroundColor Red    }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:PATH = "$machine;$user"
}

function Save-UserMemo($Name) {
  $memoPath = Join-Path (Join-Path $env:LOCALAPPDATA "codyx") "memo.md"
  $directory = Split-Path -Parent $memoPath
  $null = New-Item -ItemType Directory -Force -Path $directory
  $existing = if (Test-Path -LiteralPath $memoPath) {
    [System.IO.File]::ReadAllText($memoPath, [System.Text.Encoding]::UTF8)
  } else {
    ""
  }
  $line = "- username: $Name"
  if ($existing -match "(?m)^-\s*username:\s*") {
    $next = [regex]::Replace($existing, "(?m)^-\s*username:\s*.*$", $line, 1)
  } elseif ($existing -match "(?m)^## User\s*$") {
    $next = [regex]::Replace($existing, "(?m)^## User\s*$", "## User`r`n$line", 1)
  } elseif ([string]::IsNullOrWhiteSpace($existing)) {
    $next = "# Private Workspace Memo`r`n*Note: This file is Gitignored and contains private machine-specific info.*`r`n`r`n## User`r`n$line`r`n"
  } else {
    $next = $existing.TrimEnd() + "`r`n`r`n## User`r`n$line`r`n"
  }
  [System.IO.File]::WriteAllText($memoPath, $next, [System.Text.UTF8Encoding]::new($false))
  Write-Ok "Saved username to $memoPath"
}

# ── Banner ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   codyx npm Installer for Windows       ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

while ($true) {
  $userName = (Read-Host "What would you like codyx to call you?").Trim()
  if ($userName.Length -ge 2 -and $userName.Length -le 100) {
    Save-UserMemo $userName
    break
  }
  Write-Warn "Enter a name between 2 and 100 characters."
}

# ── Resolve package spec ──────────────────────────────────────────────
$pkgSpec = if ($Version) { "codyx-ai@$Version" } else { "codyx-ai@$Tag" }
Write-Info "Target package: $pkgSpec"

# ── Phase 1: Ensure Node.js 18+ ──────────────────────────────────────
Write-Host ""
Write-Info "Checking for Node.js 18+..."

$nodeOk = $false
$nodePath = Get-Command node -ErrorAction SilentlyContinue
if ($nodePath) {
  $nodeVerStr = (node --version 2>$null) -replace '^v', ''
  $nodeMajor  = [int]($nodeVerStr -split '\.')[0]
  if ($nodeMajor -ge 18) {
    Write-Ok "Node.js v$nodeVerStr found."
    $nodeOk = $true
  } else {
    Write-Warn "Node.js v$nodeVerStr found but 18+ is required. Installing LTS..."
  }
}

if (-not $nodeOk) {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Info "Installing Node.js LTS via winget..."
    winget install OpenJS.NodeJS.LTS --exact --source winget `
      --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      Write-Err "winget failed to install Node.js (exit $LASTEXITCODE)."
      Write-Err "Install Node.js 18+ manually from https://nodejs.org then rerun."
      exit 1
    }
    Refresh-Path
  } else {
    Write-Err "winget is not available and Node.js 18+ was not found."
    Write-Err "Install Node.js 18+ from https://nodejs.org then rerun."
    exit 1
  }

  # Re-check after install
  $nodePath = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodePath) {
    Write-Err "Node.js still not found after install. Open a new terminal and rerun."
    exit 1
  }
  $nodeVerStr = (node --version 2>$null) -replace '^v', ''
  Write-Ok "Node.js v$nodeVerStr installed."
}

# ── Phase 2: Ensure npm is available ─────────────────────────────────
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmPath) {
  Write-Err "npm not found. It should ship with Node.js. Check your installation."
  exit 1
}
$npmVer = (npm --version 2>$null).Trim()
Write-Ok "npm $npmVer found."

# ── Phase 3: Install codyx-ai ─────────────────────────────────────────
Write-Host ""
Write-Info "Installing $pkgSpec globally..."
npm install -g $pkgSpec
if ($LASTEXITCODE -ne 0) {
  Write-Err "npm install -g $pkgSpec failed (exit $LASTEXITCODE)."
  exit 1
}
Write-Ok "$pkgSpec installed."

# Refresh PATH so the codyx binary is visible in this session
Refresh-Path
$env:PATH = (npm root -g | Split-Path) + ";$env:PATH" 2>$null

# ── Phase 4: Smoke test ───────────────────────────────────────────────
if (-not $NoVerify) {
  Write-Host ""
  Write-Info "Verifying installation..."
  $codyx = Get-Command codyx -ErrorAction SilentlyContinue
  if (-not $codyx) {
    # npm global bin may not be on PATH yet — find it explicitly
    $globalBin = (npm bin -g 2>$null).Trim()
    $codyxExe  = Join-Path $globalBin "codyx"
    if (-not (Test-Path $codyxExe)) {
      Write-Warn "codyx not found on PATH. You may need to open a new terminal."
      Write-Warn "Check that npm global bin is on your PATH: npm bin -g"
    } else {
      $ver = & $codyxExe --version 2>$null
      Write-Ok "codyx $ver (verified via $codyxExe)"
    }
  } else {
    $ver = codyx --version 2>$null
    Write-Ok "codyx $ver"
  }
}

# ── Done ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   codyx installed successfully!         ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    codyx           Launch interactive menu" -ForegroundColor Yellow
Write-Host "    codyx web       Start web UI in browser"  -ForegroundColor Yellow
Write-Host "    codyx --help    See all commands"          -ForegroundColor Yellow
Write-Host "    codyx doctor    Run diagnostics"           -ForegroundColor Yellow
Write-Host ""
Write-Host "  Update anytime:   npm update -g codyx-ai"   -ForegroundColor DarkGray
Write-Host "  Uninstall:        npm uninstall -g codyx-ai" -ForegroundColor DarkGray
Write-Host ""
