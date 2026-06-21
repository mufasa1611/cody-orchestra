param(
  [switch]$UpdateExpected
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$codyxRoot = Resolve-Path "$scriptDir\.."
$repoRoot = Resolve-Path "$scriptDir\..\..\.."

$passed = 0
$failed = 0
$results = @()

function Assert-Equal {
  param($Expected, $Actual, $Message)
  if ($Expected -eq $Actual) {
    $script:passed++
    $results += @{ ok = $true; msg = $Message }
    Write-Host "  PASS: $Message" -ForegroundColor Green
  } else {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- expected '$Expected', got '$Actual'" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        Expected: '$Expected'" -ForegroundColor Gray
    Write-Host "        Actual:   '$Actual'" -ForegroundColor Gray
  }
}

function Assert-True {
  param($Actual, $Message)
  if ($Actual) {
    $script:passed++
    $results += @{ ok = $true; msg = $Message }
    Write-Host "  PASS: $Message" -ForegroundColor Green
  } else {
    $script:failed++
    $results += @{ ok = $false; msg = $Message }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        Expected true, got false" -ForegroundColor Gray
  }
}

function Assert-NotMatch {
  param($Path, $Pattern, $Message)
  if (-not (Test-Path $Path)) {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- file not found: $Path" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        File not found: $Path" -ForegroundColor Gray
    return
  }
  $content = Get-Content -Raw -Path $Path
  if ($content -notmatch $Pattern) {
    $script:passed++
    $results += @{ ok = $true; msg = $Message }
    Write-Host "  PASS: $Message" -ForegroundColor Green
  } else {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- unwanted pattern found" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        Pattern: '$Pattern'" -ForegroundColor Gray
  }
}

function Assert-Contains {
  param($Path, $Substring, $Message)
  if (-not (Test-Path $Path)) {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- file not found: $Path" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        File not found: $Path" -ForegroundColor Gray
    return
  }
  $content = Get-Content -Raw -Path $Path
  if ($content.Contains($Substring)) {
    $script:passed++
    $results += @{ ok = $true; msg = $Message }
    Write-Host "  PASS: $Message" -ForegroundColor Green
  } else {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- substring not found" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        Substring: '$Substring'" -ForegroundColor Gray
  }
}

function Assert-Regex {
  param($Path, $Pattern, $Message)
  if (-not (Test-Path $Path)) {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- file not found: $Path" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        File not found: $Path" -ForegroundColor Gray
    return
  }
  $content = Get-Content -Raw -Path $Path
  if ($content -match $Pattern) {
    $script:passed++
    $results += @{ ok = $true; msg = $Message }
    Write-Host "  PASS: $Message" -ForegroundColor Green
  } else {
    $script:failed++
    $results += @{ ok = $false; msg = "$Message -- regex not matched" }
    Write-Host "  FAIL: $Message" -ForegroundColor Red
    Write-Host "        Pattern: '$Pattern'" -ForegroundColor Gray
  }
}

# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  codyx Installer Test Suite" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════`n" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════════════════════
# 1. File existence checks
# ═══════════════════════════════════════════════════════════════════════
Write-Host "[1] File Existence" -ForegroundColor Yellow

Assert-True (Test-Path "$repoRoot\install.bat") "install.bat exists at repo root"
Assert-True (Test-Path "$repoRoot\script\install-codyx-global.ps1") "script/install-codyx-global.ps1 exists at repo root"
Assert-True (Test-Path "$repoRoot\script\install.ps1") "script/install.ps1 exists (unified installer)"
Assert-True (Test-Path "$codyxRoot\script\test-installer.ps1") "script/test-installer.ps1 exists (this file)"
Assert-True (Test-Path "$codyxRoot\src\cli\cmd\uninstall.ts") "src/cli/cmd/uninstall.ts exists"

# ═══════════════════════════════════════════════════════════════════════
# 2. install-codyx-global.ps1 checks
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[2] install-codyx-global.ps1" -ForegroundColor Yellow

$gi = "$repoRoot\script\install-codyx-global.ps1"
$giContent = Get-Content -Raw -Path $gi

Assert-True ($giContent.Contains('codyx.cmd')) "Creates codyx.cmd shim"
Assert-True ($giContent.Contains('codyx.ps1')) "Creates codyx.ps1 shim"
Assert-True ($giContent.Contains('.codyx-install-marker')) "Writes install marker file"
Assert-True ($giContent.Contains('CODY_INSTALL_ROOT')) "Sets CODY_INSTALL_ROOT in shims"
Assert-True ($giContent.Contains('Start Menu')) "Creates Start Menu shortcuts"
Assert-True ($giContent.Contains('ConvertTo-Json -Compress')) "Serializes marker as JSON"
Assert-True ($giContent.Contains('node_modules\.bin\bun.cmd')) "Shim references bun.cmd"
Assert-True ($giContent.Contains('src\index.ts')) "Shim references src/index.ts entry point"
Assert-True ($giContent.Contains('@echo off')) "Batch shim starts with @echo off"
Assert-True ($giContent.Contains('exit /b %errorlevel%')) "Batch shim preserves exit code"
Assert-True ($giContent.Contains('#!/usr/bin/env pwsh')) "PowerShell shim has shebang"
Assert-True ($giContent.Contains('root')) "Marker includes root field"
Assert-True ($giContent.Contains('installed')) "Marker includes installed list"
Assert-True ($giContent.Contains('shortcuts')) "Marker includes shortcuts"
Assert-True ($giContent.Contains('shims')) "Marker includes shims"
Assert-True ($giContent.Contains('$env:CODY_INSTALL_ROOT')) "Reads CODY_INSTALL_ROOT env"
Assert-True ($giContent.Contains('$env:LOCALAPPDATA\codyx')) "Falls back to LOCALAPPDATA\codyx"
Assert-True ($giContent.Contains('$env:APPDATA\npm')) "Targets APPDATA\npm for shims"

# ═══════════════════════════════════════════════════════════════════════
# 3. install.bat checks
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[3] install.bat" -ForegroundColor Yellow

$bat = "$repoRoot\install.bat"
$batContent = Get-Content -Raw -Path $bat

Assert-True ($batContent.Contains('install-codyx-global.ps1')) "References install-codyx-global.ps1"
Assert-True ($batContent.Contains('CODY_PROXY_ENABLED=0')) "Proxy disabled by default"
Assert-True ($batContent.Contains('codyx')) "Uses codyx name in display"
Assert-True ($batContent.Contains('winget')) "Has winget fallback"
Assert-True ($batContent.Contains('choco')) "Has choco fallback"
Assert-True ($batContent.Contains('FatalCleanup')) "Has rollback label"
Assert-True ($batContent.Contains('EnsureBun')) "Has EnsureBun helper"
Assert-True ($batContent.Contains('CREDITS')) "Has credits banner"
Assert-True ($batContent.Contains('GLOBAL_CMD')) "Has global command path variable"
Assert-True ($batContent.Contains('M. Farid')) "Credits builder"
Assert-True ($batContent.Contains('github.com/mufasa1611')) "Credits repo URL"

# Check section counter template uses [N/9] format with 9 sections
$sectionCalls = Select-String -Path $bat -Pattern 'set /a SECTION\+=1' -AllMatches
$sectionCount = $sectionCalls.Matches.Count
Assert-Equal 10 $sectionCount "Section counter has 10 increments (1 is conditional, max display is 9)"

# ═══════════════════════════════════════════════════════════════════════
# 4. script/install.ps1 checks (unified PowerShell installer)
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[4] script/install.ps1" -ForegroundColor Yellow

$sp = "$repoRoot\script\install.ps1"
$spContent = Get-Content -Raw -Path $sp

Assert-True ($spContent.Contains('install-codyx-global.ps1')) "References install-codyx-global.ps1"
Assert-True ($spContent.Contains('CODY_PROXY_ENABLED=0')) "Proxy disabled by default"
Assert-True ($spContent.Contains('codyx')) "Uses codyx name in display"

# ═══════════════════════════════════════════════════════════════════════
# 5. uninstall.ts checks
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[5] uninstall.ts" -ForegroundColor Yellow

$un = "$codyxRoot\src\cli\cmd\uninstall.ts"
$unContent = Get-Content -Raw -Path $un

Assert-True ($unContent.Contains('uninstall codyx')) "Command description uses codyx"
Assert-True ($unContent.Contains('findStartMenuShortcut')) "Finds Start Menu shortcuts"
Assert-True ($unContent.Contains('findGlobalShims')) "Finds global shims"
Assert-True ($unContent.Contains('findEnvProxy')) "Finds .env.proxy"
Assert-True ($unContent.Contains('removeNpmPathEntry')) "Cleans npm path from registry"
Assert-True ($unContent.Contains('generateRemovalLog')) "Generates removal log"
Assert-True ($unContent.Contains('askRemoveOptionalDeps')) "Asks about Bun/cloudflared"
Assert-True ($unContent.Contains('getShellConfigFile')) "Has shell config detection"
Assert-True ($unContent.Contains('cleanShellConfig')) "Has shell config cleanup"
Assert-True ($unContent.Contains('getDirectorySize')) "Has directory size calc"
Assert-True ($unContent.Contains('formatSize')) "Has size formatting"
Assert-True ($unContent.Contains('shortenPath')) "Has path shortening"
Assert-True ($unContent.Contains('codyx.cmd')) "Shim detection for codyx.cmd"
Assert-True ($unContent.Contains('codyx.ps1')) "Shim detection for codyx.ps1"

# ═══════════════════════════════════════════════════════════════════════
# 6. Process execution references (must match new binary name)
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[6] Process Execution References" -ForegroundColor Yellow

# pr.ts uses Process.text/spawn with "codyx"
$prContent = Get-Content -Raw -Path "$codyxRoot\src\cli\cmd\pr.ts"
Assert-True ($prContent.Contains('"codyx"')) "pr.ts spawns 'codyx' binary"
Assert-True ($prContent -notmatch '"codyx"') "pr.ts has no 'codyx' binary refs"

# setup.ts binary detection
$setupContent = Get-Content -Raw -Path "$codyxRoot\src\cli\cmd\setup.ts"
Assert-True ($setupContent.Contains('binName = "codyx"')) "setup.ts resolves 'codyx' binary"

# agent.ts terminal-auth command
$agentContent = Get-Content -Raw -Path "$codyxRoot\src\acp\agent.ts"
Assert-True ($agentContent.Contains('command: "codyx"')) "agent.ts tells client to run 'codyx'"

# ═══════════════════════════════════════════════════════════════════════
# 7. Naming consistency (no stray codyx in installer files)
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n[7] Naming Consistency" -ForegroundColor Yellow

$installerFiles = @(
  "$repoRoot\install.bat"
  "$repoRoot\install.ps1"
  "$repoRoot\script\install.ps1"
  "$repoRoot\script\install-codyx-global.ps1"
)

foreach ($f in $installerFiles) {
  if (-not (Test-Path $f)) { continue }
  $content = Get-Content -Raw -Path $f
  $lines = $content -split "`n"
  $strayLines = $lines | Where-Object {
    $_ -match 'codyx' -and
    $_ -notmatch 'github\.com/mufasa1611/cody-orchestra' -and
    $_ -notmatch 'github\.com/anomalyco/cody'
  }
  if ($strayLines) {
    $script:failed++
    $results += @{ ok = $false; msg = "Stray codyx in $(Split-Path $f -Leaf): $($strayLines -join '; ')" }
    Write-Host "  FAIL: Stray codyx in $(Split-Path $f -Leaf)" -ForegroundColor Red
    foreach ($l in $strayLines) {
      Write-Host "        $l" -ForegroundColor Gray
    }
  } else {
    $script:passed++
    $results += @{ ok = $true; msg = "$(Split-Path $f -Leaf) has no stray codyx" }
    Write-Host "  PASS: $(Split-Path $f -Leaf) has no stray codyx" -ForegroundColor Green
  }
}

# ═══════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════
Write-Host "`n═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan

if ($failed -gt 0) {
  Write-Host "`nFailed tests:" -ForegroundColor Red
  foreach ($r in $results) {
    if (-not $r.ok) { Write-Host "  - $($r.msg)" -ForegroundColor Gray }
  }
  exit 1
}

Write-Host "`nAll tests passed!" -ForegroundColor Green
exit 0
