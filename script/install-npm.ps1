#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install or update codyx from npm on Windows.
.DESCRIPTION
    Installs a user-local Node.js LTS runtime when necessary, verifies installer
    email ownership, installs codyx-ai from npm, updates PATH, and verifies the
    global codyx command. Administrator rights are not required.
#>
param(
  [switch]$Yes,
  [string]$Version = "latest",
  [string]$Branch = "main",
  [switch]$Verbose
)

$ErrorActionPreference = "Stop"
try { $Host.UI.RawUI.WindowTitle = "codyx Installer" } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Script:InstallerVersion = "1.1.0"
$Script:VerificationUrl = "https://install.kingkung.men"
$Script:NodeRoot = Join-Path $env:LOCALAPPDATA "Programs\codyx-node"
$Script:NpmPrefix = Join-Path $env:APPDATA "npm"
$Script:GlobalCmd = Join-Path $Script:NpmPrefix "codyx.cmd"

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

function Test-InteractiveHost {
  if (-not [Environment]::UserInteractive) { return $false }
  try { return -not [Console]::IsInputRedirected } catch { return $true }
}

function Add-UserPathEntry($Entry) {
  $full = [System.IO.Path]::GetFullPath($Entry).TrimEnd("\")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $items = @($userPath -split ";" | Where-Object { $_ -and $_.Trim() })
  $remaining = $items | Where-Object {
    $expanded = [Environment]::ExpandEnvironmentVariables($_)
    try {
      -not [System.IO.Path]::GetFullPath($expanded).TrimEnd("\").Equals(
        $full,
        [System.StringComparison]::OrdinalIgnoreCase
      )
    } catch {
      -not $expanded.TrimEnd("\").Equals($full, [System.StringComparison]::OrdinalIgnoreCase)
    }
  }
  [Environment]::SetEnvironmentVariable("Path", (@($full) + @($remaining) -join ";"), "User")
  $env:PATH = (@($full) + @($env:PATH -split ";" | Where-Object { $_ -and $_ -ne $full }) -join ";")
  Write-Ok "Configured $full in your user PATH."
}

function Test-NodeRuntime {
  if (-not (Test-Command node) -or -not (Test-Command npm.cmd)) { return $false }
  try {
    return [version]((& node --version).TrimStart("v")) -ge [version]"18.0.0"
  } catch {
    return $false
  }
}

function Install-UserNodeLts {
  Write-Step "Installing a user-local Node.js LTS runtime..."
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  $nodeArchitecture = switch ($architecture) {
    "x64" { "x64" }
    "arm64" { "arm64" }
    default { throw "Unsupported Windows architecture: $architecture" }
  }
  $release = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 30 |
    Where-Object { $_.lts -and $_.files -contains "win-$nodeArchitecture-zip" } |
    Select-Object -First 1
  if (-not $release) { throw "Could not find a compatible Node.js LTS release." }

  $archiveName = "node-$($release.version)-win-$nodeArchitecture.zip"
  $baseUrl = "https://nodejs.org/dist/$($release.version)"
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "codyx-node-$([guid]::NewGuid().ToString('N'))"
  $archivePath = Join-Path $tempRoot $archiveName
  $extractPath = Join-Path $tempRoot "extract"
  $null = New-Item -ItemType Directory -Force -Path $tempRoot
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archivePath -TimeoutSec 120
    $checksums = Invoke-RestMethod -Uri "$baseUrl/SHASUMS256.txt" -TimeoutSec 30
    $expected = (($checksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))$" }) -split "\s+")[0]
    if (-not $expected) { throw "Node.js checksum was not published for $archiveName." }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ($actual -ne $expected.ToLowerInvariant()) { throw "Node.js archive checksum validation failed." }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $source = Join-Path $extractPath "node-$($release.version)-win-$nodeArchitecture"
    $versionRoot = Join-Path $Script:NodeRoot $release.version
    if (Test-Path -LiteralPath $versionRoot) {
      Remove-Item -LiteralPath $versionRoot -Recurse -Force
    }
    $null = New-Item -ItemType Directory -Force -Path $Script:NodeRoot
    Move-Item -LiteralPath $source -Destination $versionRoot
    Add-UserPathEntry $versionRoot
    Write-Ok "Node.js $($release.version) LTS installed without administrator rights."
  } finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-WithRetry($ScriptBlock, $Label, $MaxRetries = 3) {
  $backoff = 1
  for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
    try {
      & $ScriptBlock
      return
    } catch {
      if ($attempt -eq $MaxRetries) { throw }
      Write-Warn "$Label failed on attempt $attempt of $MaxRetries. Retrying in ${backoff}s..."
      Start-Sleep -Seconds $backoff
      $backoff = [Math]::Min($backoff * 2, 8)
    }
  }
}

Write-Host ""
Write-Host "  =======================================" -ForegroundColor Cyan
Write-Host "       codyx npm Installer v$($Script:InstallerVersion)" -ForegroundColor Cyan
Write-Host "  =======================================" -ForegroundColor Cyan

if (-not (Test-NodeRuntime)) {
  Install-UserNodeLts
}
if (-not (Test-NodeRuntime)) {
  Write-Err "Node.js or npm is unavailable after installation."
  exit 1
}
$Script:NpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
Write-Ok "Node.js $(& node --version) and npm $(& $Script:NpmCommand --version) are ready."

Write-Step "Loading installer email verification..."
$verificationScriptUrl = "https://raw.githubusercontent.com/mufasa1611/cody-orchestra/$Branch/script/installer-verification.ps1"
$verificationSource = $null
try {
  Invoke-WithRetry {
    $Script:verificationSource = Invoke-RestMethod -Uri $verificationScriptUrl -TimeoutSec 20
  } "verification helper download"
} catch {
  Write-Err "Could not load the installer verification step."
  Write-Err "Node.js will remain installed. Rerun this command when GitHub is available."
  exit 1
}
$verificationParameters = @{
  InstallerVersion = $Script:InstallerVersion
  ServiceUrl = $Script:VerificationUrl
  ReceiptPath = (Join-Path $env:LOCALAPPDATA "codyx-installer\verification.json")
  NonInteractive = -not (Test-InteractiveHost)
}
$verificationResult = & ([scriptblock]::Create($Script:verificationSource)) @verificationParameters
if (-not $verificationResult.Success) { exit 1 }

Write-Step "Installing codyx-ai@$Version from npm..."
$null = New-Item -ItemType Directory -Force -Path $Script:NpmPrefix
Add-UserPathEntry $Script:NpmPrefix
& $Script:NpmCommand config set prefix $Script:NpmPrefix --location=user
if ($LASTEXITCODE -ne 0) {
  Write-Err "Could not configure the user npm installation directory."
  exit 1
}
Invoke-WithRetry {
  & $Script:NpmCommand install --global "codyx-ai@$Version" --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
} "codyx npm installation"

Write-Step "Verifying the global codyx command..."
if (-not (Test-Path -LiteralPath $Script:GlobalCmd)) {
  Write-Err "npm completed but did not create $($Script:GlobalCmd)."
  exit 1
}
& $env:ComSpec /d /s /c "`"`"$($Script:GlobalCmd)`" --version`""
if ($LASTEXITCODE -ne 0) {
  Write-Err "The installed codyx command could not start."
  exit 1
}
$packageJsonPath = Join-Path $Script:NpmPrefix "node_modules\codyx-ai\package.json"
if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  Write-Err "npm completed but the codyx-ai package metadata is missing."
  exit 1
}
$installedVersion = (Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json).version
if (-not $installedVersion) {
  Write-Err "The installed codyx-ai version could not be determined."
  exit 1
}

$stateRoot = Join-Path $env:LOCALAPPDATA "codyx-installer"
$null = New-Item -ItemType Directory -Force -Path $stateRoot
@{
  method = "npm"
  package = "codyx-ai"
  version = "$installedVersion"
  updated_at = [DateTimeOffset]::UtcNow.ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateRoot "installation.json") -Encoding UTF8

Write-Host ""
Write-Host "  =======================================" -ForegroundColor Green
Write-Host "       codyx installed successfully!     " -ForegroundColor Green
Write-Host "  =======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Version: $installedVersion"
Write-Host "  Command: codyx"
Write-Host "  Update:  npm install -g codyx-ai@latest"
Write-Host ""
Write-Host "Open a new terminal if codyx is not immediately available."
