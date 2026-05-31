param(
  [string]$Branch = $(if ($env:CODY_BRANCH) { $env:CODY_BRANCH } else { "main" }),
  [switch]$SelfUpdate,
  [switch]$NoSelfUpdate
)

$ErrorActionPreference = "Stop"

Write-Host "[warn] This installer (root 'install.ps1') is deprecated." -ForegroundColor Yellow
Write-Host "[warn] Use the unified script/install.ps1 instead:" -ForegroundColor Yellow
Write-Host "  irm https://raw.githubusercontent.com/mufasa1611/cody-x/$Branch/script/install.ps1 | iex" -ForegroundColor Yellow
Write-Host ""

# Redirect to unified installer
$newUrl = "https://raw.githubusercontent.com/mufasa1611/cody-x/$Branch/script/install.ps1"
try {
  $newScript = Invoke-WebRequest -UseBasicParsing -Uri $newUrl
  $tempFile = [System.IO.Path]::GetTempFileName() + ".ps1"
  [System.IO.File]::WriteAllText($tempFile, $newScript.Content)
  & $tempFile @PSBoundParameters
  exit $LASTEXITCODE
} catch {
  Write-Host "[warn] Could not download script/install.ps1. Falling through to legacy installer." -ForegroundColor Yellow
}

trap {
  Write-Host ""
  Write-Host "[error] Install failed at step: $($_.InvocationInfo.ScriptLineNumber)" -ForegroundColor Red
  Write-Host "  Message: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$repoUrl = "https://github.com/mufasa1611/cody-x.git"
$defaultRoot = Join-Path $env:LOCALAPPDATA "cody-x"

function Test-CodyXCheckout($path) {
  $packagePath = Join-Path $path "package.json"
  if (-not (Test-Path $packagePath)) {
    return $false
  }
  return (Get-Content -Raw -Path $packagePath) -match '"name"\s*:\s*"cody"'
}

function Ensure-Command($commandName, $wingetId, $label) {
  if (Get-Command $commandName -ErrorAction SilentlyContinue) {
    Write-Host "[ok] $label found."
    return
  }
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw "$label is required. Install $label or install winget, then rerun this installer."
  }
  Write-Host "$label not found. Installing $label with winget..."
  winget install --id $wingetId --exact --source winget --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install $label with winget."
  }
  $env:PATH = "$env:ProgramFiles\Git\cmd;$env:ProgramFiles\nodejs;$env:PATH"
  if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
    throw "$label was installed, but $commandName is not available in this terminal. Reopen the terminal and rerun this installer."
  }
}

$scriptPath = $MyInvocation.MyCommand.Path
$scriptRoot = if ($scriptPath) { Split-Path -Parent $scriptPath } else { $null }
if (-not $scriptRoot) {
  $scriptRoot = (Get-Location).Path
}

# Self-update by default so install fixes reach users; set CODY_INSTALLER_SELF_UPDATE=0
# or pass -NoSelfUpdate for local deterministic testing.
$selfUpdateDisabled = $NoSelfUpdate -or $env:CODY_INSTALLER_SELF_UPDATE -eq "0"
if (-not $selfUpdateDisabled -and $scriptPath -and -not $env:CODY_INSTALLER_SELF_UPDATED) {
  $installerUrl = "https://raw.githubusercontent.com/mufasa1611/cody-x/$Branch/install.ps1"
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $response = Invoke-WebRequest -UseBasicParsing -Uri $installerUrl
    $currentContent = Get-Content -Raw -Path $scriptPath
    if ($response.Content -ne $currentContent) {
      Write-Host "[info] New installer found. Running latest installer from GitHub..."
      $env:CODY_INSTALLER_SELF_UPDATED = "1"
      $tmpFile = [System.IO.Path]::GetTempFileName() + ".ps1"
      Set-Content -Path $tmpFile -Value $response.Content -Encoding UTF8
      & powershell -NoProfile -ExecutionPolicy Bypass -File $tmpFile -Branch $Branch
      $exitCode = $LASTEXITCODE
      Remove-Item -Path $tmpFile -Force -ErrorAction SilentlyContinue
      exit $exitCode
    }
    Write-Host "[ok] Installer is up to date."
  } catch {
    Write-Host "[warn] Could not check for installer updates: $($_.Exception.Message)"
  }
}

$root = if (Test-CodyXCheckout $scriptRoot) { $scriptRoot } else { $defaultRoot }

Ensure-Command "git" "Git.Git" "Git"

if (-not (Test-CodyXCheckout $root)) {
  Write-Host "cody-x checkout not found. Cloning from GitHub..."
  if ((Test-Path $root) -and (Get-ChildItem -Force -Path $root | Select-Object -First 1)) {
    throw "$root exists but is not a cody-x checkout. Move it away or choose a clean install location, then rerun this installer."
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $root) | Out-Null
  git clone --branch $Branch $repoUrl $root
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[warn] Branch $Branch clone failed. Retrying default branch..."
    git clone $repoUrl $root
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to clone cody-x from $repoUrl."
    }
  }
}
git config --global --add safe.directory "$root" 2>$null

Set-Location $root

# Capture HEAD for dep change detection
$beforeHead = ""
if (Test-Path (Join-Path $root ".git")) {
  $beforeHead = git -C $root rev-parse HEAD 2>$null
  $currentBranch = (git -C $root branch --show-current 2>$null).Trim()
  if ($currentBranch -and $currentBranch -ne $Branch) {
    Write-Host "Switching cody-x checkout from $currentBranch to $Branch..."
    git -C $root fetch origin $Branch
    if ($LASTEXITCODE -eq 0) {
      git -C $root switch $Branch
      if ($LASTEXITCODE -ne 0) {
        throw "Could not switch to $Branch. Back up or commit local changes in $root, then rerun the installer."
      }
    } else {
      throw "Could not fetch branch $Branch from origin."
    }
  }
  Write-Host "Updating cody-x checkout..."
  git -C $root pull --ff-only
  if ($LASTEXITCODE -ne 0) {
    Write-Host "git pull --ff-only failed. Continuing with the current checkout."
  }
} else {
  Write-Host "No .git directory found. Skipping repository update."
}

function Get-BunCommand {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $defaultBun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  if (Test-Path $defaultBun) { return $defaultBun }
  $npmBun = Join-Path $env:APPDATA "npm\bun.cmd"
  if (Test-Path $npmBun) { return $npmBun }
  return $null
}

if (-not (Get-BunCommand)) {
  Write-Host "Bun not found. Installing Bun for the current user..."
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
}

$bun = Get-BunCommand
if (-not $bun) {
  throw "Bun installation did not produce a usable bun command. Install Bun from https://bun.sh and retry."
}

$bunDir = Split-Path -Parent $bun
$env:PATH = "$bunDir;$env:PATH"

# ---- Check if dependencies need updating ----
$needInstall = $false
if (-not (Test-Path "node_modules")) {
  $needInstall = $true
} elseif ($beforeHead) {
  $afterHead = git rev-parse HEAD 2>$null
  if ($afterHead -and $beforeHead -ne $afterHead) {
    $changedFiles = git diff "$beforeHead..$afterHead" --name-only
    if ($changedFiles -match "package\.json|bun\.lock") {
      $needInstall = $true
    }
  }
}

if ($needInstall) {
  Write-Host "Installing cody-x dependencies..."
  & $bun install
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[warn] Bun install failed (exit code $LASTEXITCODE). Retrying with --no-optional..." -ForegroundColor Yellow
    & $bun install --no-optional
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "[error] Bun install failed again." -ForegroundColor Red
      Write-Host "  This project has many dependencies (~2700 packages) and may need more memory." -ForegroundColor Yellow
      Write-Host "  Try one of these:" -ForegroundColor Yellow
      Write-Host "    1. Increase your Windows page file size, then rerun" -ForegroundColor Yellow
      Write-Host "    2. Run:  $bun install --frozen-lockfile" -ForegroundColor Yellow
      Write-Host "  Then rerun this installer." -ForegroundColor Yellow
      exit 1
    }
    Write-Host "[ok] Dependencies installed (with --no-optional)."
  }
} else {
  Write-Host "[ok] Dependencies are up to date. Skipping bun install."
}

# Warn about native module compilation if VS Build Tools are missing
$vsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$hasVCTools = $false
if (Test-Path $vsWhere) {
  $vcCheck = & $vsWhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -products * 2>$null
  if ($vcCheck) { $hasVCTools = $true }
}
if (-not $hasVCTools) {
  Write-Host "[info] Visual Studio C++ Build Tools not detected." -ForegroundColor DarkGray
  Write-Host "  Native modules (tree-sitter-powershell) may fail to compile. This is optional." -ForegroundColor DarkGray
  Write-Host "  For full PowerShell syntax highlighting, install VS Build Tools:" -ForegroundColor DarkGray
  Write-Host '    winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --passive"' -ForegroundColor DarkGray
}

# ---- Check/install cloudflared for proxy tunnel ----
$cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cfCmd) {
  $cfPaths = @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
  )
  $cfFound = $false
  foreach ($p in $cfPaths) { if (Test-Path $p) { $cfFound = $true; break } }
  if (-not $cfFound) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      Write-Host "[info] cloudflared not found. Installing with winget..."
      winget install --id Cloudflare.cloudflared --exact --source winget --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -eq 0) {
        Write-Host "[ok] cloudflared installed."
        $env:PATH = "$env:ProgramFiles\cloudflared;$env:PATH"
      } else {
        Write-Host "[warn] cloudflared install failed. Proxy tunnel won't auto-start."
        Write-Host "  Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/"
      }
    } else {
      Write-Host "[warn] cloudflared not found and winget not available."
      Write-Host "  Install cloudflared from: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/"
    }
  }
} else {
  Write-Host "[ok] cloudflared found."
}

Write-Host "Building Web UI..."
Push-Location (Join-Path $root "packages\app")
& $bun run build
$buildExit = $LASTEXITCODE
Pop-Location
if ($buildExit -ne 0) {
  Write-Host "[warn] Web UI build failed, server will proxy to app.cody.ai."
}

# ---- Create proxy config ----
Write-Host "Creating .env.proxy with proxy settings..."
$proxyFile = Join-Path $root ".env.proxy"
if (-not (Test-Path $proxyFile)) {
  $proxyLines = @(
    "CODY_PROXY_ENABLED=1",
    "HTTPS_PROXY=http://localhost:9999",
    "HTTP_PROXY=http://localhost:9999",
    "NO_PROXY=localhost,127.0.0.1,::1"
  )
  [System.IO.File]::WriteAllLines($proxyFile, $proxyLines, [System.Text.UTF8Encoding]::new($false))
  Write-Host "[ok] .env.proxy created with proxy settings."
} else {
  Write-Host "[ok] .env.proxy already exists."
}

# ---- Set default model ----
Write-Host "Setting default model to cody/deepseek-v4-flash-free..."
$generatedDir = Join-Path $root ".cody\generated"
if (-not (Test-Path $generatedDir)) {
  New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null
}
$defaultModelFile = Join-Path $generatedDir "cody.json"
if (-not (Test-Path $defaultModelFile)) {
  $json = [System.Text.StringBuilder]::new()
  [void]$json.AppendLine("{")
  [void]$json.AppendLine('  "$schema": "https://cody.dev/config.json",')
  [void]$json.AppendLine('  "model": "cody/deepseek-v4-flash-free",')
  [void]$json.AppendLine('  "provider": {')
  [void]$json.AppendLine('    "cody": {')
  [void]$json.AppendLine('      "models": {')
  [void]$json.AppendLine('        "deepseek-v4-flash-free": {')
  [void]$json.AppendLine('          "name": "DeepSeek V4 Flash Free",')
  [void]$json.AppendLine('          "reasoning": false,')
  [void]$json.AppendLine('          "tool_call": true,')
  [void]$json.AppendLine('          "temperature": true,')
  [void]$json.AppendLine('          "cost": { "input": 0, "output": 0 },')
  [void]$json.AppendLine('          "limit": { "context": 200000, "output": 128000 }')
  [void]$json.AppendLine("        }")
  [void]$json.AppendLine("      }")
  [void]$json.AppendLine("    }")
  [void]$json.AppendLine("  }")
  [void]$json.AppendLine("}")
  [System.IO.File]::WriteAllText($defaultModelFile, $json.ToString(), [System.Text.UTF8Encoding]::new($false))
  Write-Host "[ok] Default model configured: cody/deepseek-v4-flash-free"
}

# ---- Install global command ----
Write-Host "Installing global cody-x command..."
$globalInstaller = Join-Path $root "script\install-cody-x-global.ps1"
& $globalInstaller
$globalInstallExit = $LASTEXITCODE
if ($globalInstallExit -ne 0) {
  Write-Host "[error] Global command installation failed. You can run it manually:" -ForegroundColor Red
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$globalInstaller`"" -ForegroundColor Yellow
  exit $globalInstallExit
}

$shimDir = Join-Path $env:APPDATA "npm"
$env:PATH = "$shimDir;$env:PATH"

Write-Host "Verifying cody-x can start..."
$verifyOutput = & $bun run --cwd "$root\packages\cody" --conditions=browser src\index.ts --version 2>&1
$verifyExit = $LASTEXITCODE
if ($verifyExit -ne 0) {
  Write-Host "[error] cody-x failed to start (exit code $verifyExit)." -ForegroundColor Red
  exit $verifyExit
}
Write-Host "[ok] cody-x version: $($verifyOutput.Trim())"

# ---- Interactive local model scan ----
Write-Host ""
Write-Host "---"
Write-Host "cody-x can scan your system for local Ollama models and GGUF files"
Write-Host "to auto-configure them as AI providers."
$scanAnswer = Read-Host "Scan for local models now? [y/N] "
if ($scanAnswer -match '^[yY]') {
  $discoverScript = Join-Path $root "script\discover-local-models.ps1"
  if (Test-Path $discoverScript) {
    Write-Host ""
    Write-Host "Scanning for local models..."
    $drives = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\$' -and (Test-Path $_.Root) }
    $driveCount = $drives.Count
    $driveLetters = ($drives | ForEach-Object { $_.Root.TrimEnd('\') }) -join ", "
    Write-Host "  Found $driveCount drive(s): $driveLetters"
    Write-Host ""

    $env:CODY_MODEL_DISCOVERY_QUIET = "1"
    $env:CODY_MODEL_SCAN_MAX_SECONDS = "30"

    $job = Start-Job -ScriptBlock {
      param($root)
      & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "script\discover-local-models.ps1") -Root $root -MaxSeconds 30
    } -ArgumentList $root

    $dots = 0
    while ($job.State -eq 'Running') {
      $dots = ($dots + 1) % 4
      $bar = "." * $dots + " " * (3 - $dots)
      Write-Host "`r  Scanning[$bar]" -NoNewline
      Start-Sleep -Milliseconds 500
    }

    Receive-Job -Job $job -Wait -AutoRemoveJob | Out-Null

    $reportPath = Join-Path (Join-Path $root ".cody\generated") "cody-local-models.report.json"
    if (Test-Path $reportPath) {
      try {
        $report = Get-Content $reportPath -Raw | ConvertFrom-Json
        $ollamaCount = $report.ollamaModelCount
        $ggufCount = $report.ggufModelCount
        $total = $ollamaCount + $ggufCount
        if ($total -gt 0) {
          Write-Host "`r[ok] Found $total local models ($ollamaCount Ollama, $ggufCount GGUF)"
        } else {
          Write-Host "`r[info] No local models found."
        }
      } catch {
        Write-Host "`r[warn] Could not read model discovery report."
      }
    }
  } else {
    Write-Host "[warn] Model discovery script not found. Skipping."
  }
} else {
  Write-Host "[info] Model scan skipped. Run later with:"
  Write-Host "  powershell -File `"$root\script\discover-local-models.ps1`""
}

# ---- Welcome / next steps ----
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  cody-x installed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Installed to: $root" -ForegroundColor Cyan
Write-Host "  Global command: cody-x" -ForegroundColor Cyan
if (Test-Path (Join-Path $root ".env.proxy")) {
  Write-Host "  Proxy: enabled (Cloudflare tunnel)" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    cody-x           Launch interactive menu (TUI)" -ForegroundColor Yellow
Write-Host "    cody-x web       Start web UI in browser" -ForegroundColor Yellow
Write-Host "    cody-x --help    See all commands" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Open a NEW terminal window for the global 'cody-x' command to be available." -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green