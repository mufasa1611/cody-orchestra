#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $env:APPDATA "npm"
$cmdShim = Join-Path $target "cody-x.cmd"
$psShim = Join-Path $target "cody-x.ps1"

if (-not (Test-Path (Join-Path $root "cody-x.cmd"))) {
  throw "cody-x launcher not found at $root\cody-x.cmd"
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

function Add-UserPathEntry($entry) {
  $full = [System.IO.Path]::GetFullPath($entry).TrimEnd("\")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $items = @()
  if ($userPath) { $items = $userPath -split ";" | Where-Object { $_ -and $_.Trim() } }
  $exists = $false
  foreach ($item in $items) {
    $expanded = [Environment]::ExpandEnvironmentVariables($item)
    try { $normalized = [System.IO.Path]::GetFullPath($expanded).TrimEnd("\") }
    catch { $normalized = $expanded.TrimEnd("\") }
    if ($normalized.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) { $exists = $true; break }
  }
  if (-not $exists) {
    $next = @($items + $full) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
    Write-Host "Added cody-x command directory to user PATH: $full"
  }
  $currentItems = @($env:PATH -split ";" | Where-Object { $_ -and $_.Trim() })
  $inCurrent = $false
  foreach ($item in $currentItems) {
    $expanded = [Environment]::ExpandEnvironmentVariables($item)
    try { $normalized = [System.IO.Path]::GetFullPath($expanded).TrimEnd("\") }
    catch { $normalized = $expanded.TrimEnd("\") }
    if ($normalized.Equals($full, [System.StringComparison]::OrdinalIgnoreCase)) { $inCurrent = $true; break }
  }
  if (-not $inCurrent) { $env:PATH = "$full;$env:PATH" }
  try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
namespace CodyX {
  public static class NativeMethods {
    [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, UInt32 Msg, UIntPtr wParam, string lParam, UInt32 fuFlags, UInt32 uTimeout, out UIntPtr lpdwResult);
  }
}
"@
    $result = [UIntPtr]::Zero
    [CodyX.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 0x0002, 5000, [ref]$result) | Out-Null
  } catch {
    Write-Host "[warn] Could not broadcast PATH update. Open a new terminal if cody-x is not recognized."
  }
}

if (-not (Get-BunCommand)) {
  Write-Host "Bun not found. Installing Bun for the current user..."
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
}

$bun = Get-BunCommand
if (-not $bun) { throw "Bun installation did not produce a usable bun command." }

Write-Host "Using Bun: $bun"
New-Item -ItemType Directory -Force -Path $target | Out-Null

# Create cody-x command (proxy-enabled)
@"
@echo off
setlocal
set "CODY_ROOT=$root"
if not exist "%CODY_ROOT%\cody-x.cmd" (
  echo cody-x launcher not found at "%CODY_ROOT%\cody-x.cmd".
  exit /b 1
)
:: Load proxy settings from .env.proxy, with .env fallback for older installs.
if exist "%CODY_ROOT%\.env.proxy" (
  for /f "usebackq tokens=*" %%a in ("%CODY_ROOT%\.env.proxy") do (
    for /f "tokens=1,* delims==" %%b in ("%%a") do set "%%b=%%c"
  )
)
if not defined CODY_PROXY_ENABLED if exist "%CODY_ROOT%\.env" (
  for /f "usebackq tokens=*" %%a in ("%CODY_ROOT%\.env") do (
    for /f "tokens=1,* delims==" %%b in ("%%a") do set "%%b=%%c"
  )
)
call "%CODY_ROOT%\cody-x.cmd" %*
exit /b %ERRORLEVEL%
"@ | Set-Content -Encoding ASCII -Path $cmdShim

@"
#!/usr/bin/env pwsh
`$root = "$root"
`$launcher = Join-Path `$root "cody-x.cmd"
if (-not (Test-Path `$launcher)) {
  Write-Error "cody-x launcher not found at `$launcher."
  exit 1
}
# Load proxy settings from .env.proxy, with .env fallback for older installs.
`$envFile = Join-Path `$root ".env.proxy"
if (-not (Test-Path `$envFile)) { `$envFile = Join-Path `$root ".env" }
if (Test-Path `$envFile) {
  Get-Content `$envFile | ForEach-Object {
    if (`$_ -match "^(\w+)=(.*)") {
      [Environment]::SetEnvironmentVariable(`$matches[1], `$matches[2], "Process")
    }
  }
}
& `$launcher @args
exit `$LASTEXITCODE
"@ | Set-Content -Encoding ASCII -Path $psShim

# Only cody-x is created from this repo

Write-Host "Installed global commands:"
  Write-Host "  cody-x  (from $root, with proxy from .env.proxy)"
Add-UserPathEntry $target

if (-not (Get-Command cody-x -ErrorAction SilentlyContinue)) {
  throw "cody-x shim was created but is not on PATH."
}
Write-Host "[ok] cody-x is available on PATH."
