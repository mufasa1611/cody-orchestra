param(
  [Parameter(Mandatory = $false)]
  [string]$Root = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

# Style helpers (matching script/install.ps1)
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

# Banner
Write-Host ""
Write-Host "  codyx - Global Command Installer" -ForegroundColor Cyan
Write-Host "  Installs the codyx CLI shim, Start Menu shortcuts,"
Write-Host "  and creates an install marker for clean uninstall."
Write-Host ""

# Resolve root
if (-not $Root -or -not (Test-Path -LiteralPath $Root)) {
  $Root = $env:CODY_INSTALL_ROOT
}
if (-not $Root -or -not (Test-Path -LiteralPath $Root)) {
  $Root = "$env:LOCALAPPDATA\codyx"
}
if (-not (Test-Path -LiteralPath "$Root\package.json")) {
  Write-Err "Cannot find codyx checkout at $Root"
  exit 1
}
$Root = (Resolve-Path -LiteralPath $Root).Path
$repoLauncher = Join-Path $Root "codyx.cmd"
if (-not (Test-Path -LiteralPath $repoLauncher)) {
  Write-Err "Cannot find the codyx launcher at $repoLauncher"
  exit 1
}

$npmDir = "$env:APPDATA\npm"
if (-not (Test-Path -LiteralPath $npmDir)) {
  $null = New-Item -ItemType Directory -Path $npmDir -Force
}

$markerPath = "$Root\.codyx-install-marker"
$marker = @{
  root       = $Root
  installed  = @()
  pathAdds   = @()
  shortcuts  = @()
  shims      = @()
}

function Add-Tracked($Path) {
  if ($marker.installed -notcontains $Path) {
    $marker.installed += $Path
  }
}

function Write-BatchShim($Name) {
  $shimPath = Join-Path $npmDir "$Name.cmd"
  $content = @"
@echo off
setlocal
set "CODY_INSTALL_ROOT=$Root"
call "$repoLauncher" %*
exit /b %errorlevel%
"@
  [System.IO.File]::WriteAllText($shimPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Ok "Created shim: $shimPath"
  $marker.shims += $shimPath
  Add-Tracked $shimPath
}

function Write-PowerShellShim($Name) {
  $shimPath = Join-Path $npmDir "$Name.ps1"
  $content = @"
#!/usr/bin/env pwsh
`$env:CODY_INSTALL_ROOT = "$Root"
& "$repoLauncher" @args
exit `$LASTEXITCODE
"@
  [System.IO.File]::WriteAllText($shimPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Ok "Created shim: $shimPath"
  $marker.shims += $shimPath
  Add-Tracked $shimPath
}

# 1. Batch shims
Write-Section 1 "Batch shims"
Write-BatchShim "codyx"
Write-BatchShim "cody"

# 2. PowerShell shims
Write-Section 2 "PowerShell shims"
Write-PowerShellShim "codyx"
Write-PowerShellShim "cody"

# 3. User PATH
Write-Section 3 "User PATH"

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathItems = @($currentPath -split ";" | Where-Object { $_ -and $_.Trim() })
$hasNpmDir = $pathItems | Where-Object {
  try {
    [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($_)).TrimEnd("\").Equals(
      [System.IO.Path]::GetFullPath($npmDir).TrimEnd("\"),
      [System.StringComparison]::OrdinalIgnoreCase
    )
  } catch {
    $false
  }
}
if (-not $hasNpmDir) {
  $newPath = @($npmDir) + $pathItems -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Ok "Added $npmDir to User PATH"
  $marker.pathAdds += $npmDir
} else {
  Write-Ok "$npmDir already in User PATH"
}
if (($env:PATH -split ";") -notcontains $npmDir) {
  $env:PATH = "$npmDir;$env:PATH"
}

# 4. Start Menu shortcuts
Write-Section 4 "Start Menu shortcuts"

$startMenuDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\codyx"
$null = New-Item -ItemType Directory -Force -Path $startMenuDir

$shell = New-Object -ComObject WScript.Shell
$launchShortcut = $shell.CreateShortcut("$startMenuDir\codyx.lnk")
$launchShortcut.TargetPath = "cmd.exe"
$launchShortcut.Arguments = "/c `"`"$npmDir\codyx.cmd`"`""
$launchShortcut.Description = "Launch codyx"
$launchShortcut.WorkingDirectory = $Root
$launchShortcut.Save()
Write-Ok "Created shortcut: codyx.lnk"
$marker.shortcuts += "$startMenuDir\codyx.lnk"
Add-Tracked "$startMenuDir\codyx.lnk"

$webShortcut = $shell.CreateShortcut("$startMenuDir\codyx Web.lnk")
$webShortcut.TargetPath = "cmd.exe"
$webShortcut.Arguments = "/c `"`"$npmDir\codyx.cmd`" web"
$webShortcut.Description = "Launch codyx web UI"
$webShortcut.WorkingDirectory = $Root
$webShortcut.Save()
Write-Ok "Created shortcut: codyx Web.lnk"
$marker.shortcuts += "$startMenuDir\codyx Web.lnk"
Add-Tracked "$startMenuDir\codyx Web.lnk"

# 5. Install marker
Write-Section 5 "Install marker"

Add-Tracked $markerPath
Add-Tracked $startMenuDir

$markerJson = $marker | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($markerPath, $markerJson, [System.Text.UTF8Encoding]::new($false))
Write-Ok "Install marker: $markerPath"

# Done
Write-Host ""
Write-Host "  =======================================" -ForegroundColor Green
Write-Host "     Global codyx command installed!     " -ForegroundColor Green
Write-Host "  =======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Use 'codyx' from any terminal." -ForegroundColor White
Write-Host "  (You may need to open a new terminal for PATH changes to take effect.)" -ForegroundColor DarkGray
Write-Host ""
exit 0
