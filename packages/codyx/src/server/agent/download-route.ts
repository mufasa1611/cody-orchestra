import { Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { readFileSync, existsSync } from "fs"
import * as AgentHub from "./hub"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CONNECT_SCRIPT_PATH = join(__dirname, "connect.mjs")

// Read connect.mjs at module load time
const connectScript: string = existsSync(CONNECT_SCRIPT_PATH)
  ? readFileSync(CONNECT_SCRIPT_PATH, "utf-8")
  : ""

const handleScriptDownload = Effect.fn("AgentDownload.handleScriptDownload")(function* () {
  if (!connectScript) {
    return yield* Effect.succeed(HttpServerResponse.text("connect.mjs not found", { status: 404 }))
  }
  return HttpServerResponse.text(connectScript, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Content-Disposition": 'attachment; filename="connect.mjs"',
    },
  })
})

const handleLauncherDownload = Effect.fn("AgentDownload.handleLauncherDownload")(function* (request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const code = url.searchParams.get("code") || ""
  const wsUrl = url.searchParams.get("ws") || "wss://cody.kingkung.men/ws/agent"
  const serverUrl = url.searchParams.get("server") || "https://cody.kingkung.men"

  const bat = `@echo off
setlocal enabledelayedexpansion
title cody-x — Connect My PC
echo ============================================
echo    cody-x — Remote PC Agent
echo ============================================
echo.

set "CODE=${code}"
set "WS_URL=${wsUrl}"
set "SERVER=${serverUrl}"
set "SCRIPT=%TEMP%\\cody-x-connect-${code}.mjs"

REM Download connect.mjs from server
echo [1/2] Downloading connect script...
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%SERVER%/agent/download/script', '%SCRIPT%')}" 2>nul
if not exist "%SCRIPT%" (
  echo Failed to download connect script.
  echo Make sure you have internet access and try again.
  pause
  exit /b 1
)
echo OK

REM Try Bun first (faster), then Node; auto-install Bun if missing
echo [2/2] Connecting to cody-x...
set "CODY_WS_URL=%WS_URL%"
set "BUN_PATH="
where bun >nul 2>nul
if !ERRORLEVEL! EQU 0 (
  set "BUN_PATH=bun"
) else if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  set "BUN_PATH=%USERPROFILE%\.bun\bin\bun.exe"
)

if defined BUN_PATH (
  echo Using Bun...
  !BUN_PATH! "%SCRIPT%" "%CODE%"
  if !ERRORLEVEL! EQU 0 goto :done
  echo Bun failed, trying Node.js...
) else (
  echo Bun not found. Installing Bun automatically...
  powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm bun.sh/install.ps1 | iex}" 2>nul
  if exist "%USERPROFILE%\.bun\bin\bun.exe" (
    set "BUN_PATH=%USERPROFILE%\.bun\bin\bun.exe"
    echo Bun installed! Connecting...
    !BUN_PATH! "%SCRIPT%" "%CODE%"
    if !ERRORLEVEL! EQU 0 goto :done
  ) else (
    echo Bun auto-install failed.
  )
)

where node >nul 2>nul
if !ERRORLEVEL! EQU 0 (
  echo Using Node.js...
  node "%SCRIPT%" "%CODE%"
  if !ERRORLEVEL! EQU 0 goto :done
)

echo.
echo Could not connect. Install Bun manually: https://bun.sh/
pause
exit /b 1

:done
echo Disconnected.
pause
`

  return HttpServerResponse.text(bat, {
    headers: {
      "Content-Type": "application/x-msdos-program; charset=utf-8",
      "Content-Disposition": `attachment; filename="connect-pc-${code}.bat"`,
    },
  })
})

const handlePs1Download = Effect.fn("AgentDownload.handlePs1Download")(function* (request: HttpServerRequest.HttpServerRequest) {
  const url = new URL(request.url, "http://localhost")
  const code = url.searchParams.get("code") || ""
  const wsUrl = url.searchParams.get("ws") || "wss://cody.kingkung.men/ws/agent"
  const serverUrl = url.searchParams.get("server") || "https://cody.kingkung.men"

  const ps1 = `#!/usr/bin/env pwsh
# cody-x — Remote PC Agent

$code = "${code}"
$wsUrl = "${wsUrl}"
$server = "${serverUrl}"
$script = Join-Path $env:TEMP "cody-x-connect-${code}.mjs"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   cody-x — Remote PC Agent" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Download connect.mjs
Write-Host "[1/2] Downloading connect script..." -NoNewline
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri "$server/agent/download/script" -OutFile $script -ErrorAction Stop | Out-Null
  Write-Host " OK" -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host "Failed to download: $_" -ForegroundColor Red
  pause
  exit 1
}

# Connect
Write-Host "[2/2] Connecting to cody-x..." -ForegroundColor Cyan
$env:CODY_WS_URL = $wsUrl

# Try Bun first (faster), then Node; auto-install Bun if missing
$bunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bunPath) {
  $userBun = "$env:USERPROFILE\.bun\bin\bun.exe"
  if (Test-Path $userBun) { $bunPath = $userBun }
}

if ($bunPath) {
  Write-Host "Using Bun..."
  & $bunPath $script $code
  if ($LASTEXITCODE -eq 0) { exit 0 }
  Write-Host "Bun failed, trying Node.js..." -ForegroundColor Yellow
} else {
  Write-Host "Bun not found. Installing Bun automatically..." -ForegroundColor Cyan
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    irm bun.sh/install.ps1 | iex
    $newBun = "$env:USERPROFILE\.bun\bin\bun.exe"
    if (Test-Path $newBun) {
      Write-Host "Bun installed! Connecting..." -ForegroundColor Green
      & $newBun $script $code
      if ($LASTEXITCODE -eq 0) { exit 0 }
    } else {
      Write-Host "Bun auto-install failed." -ForegroundColor Red
    }
  } catch {
    Write-Host "Bun auto-install failed: $_" -ForegroundColor Red
  }
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "Using Node.js..."
  node $script $code
  if ($LASTEXITCODE -eq 0) { exit 0 }
}

Write-Host ""
Write-Host "Could not connect. Install Bun manually: https://bun.sh/" -ForegroundColor Yellow
pause
`

  return HttpServerResponse.text(ps1, {
    headers: {
      "Content-Type": "text/powershell; charset=utf-8",
      "Content-Disposition": `attachment; filename="connect-pc-${code}.ps1"`,
    },
  })
})

export const agentDownloadRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add("GET", "/agent/download/script", () => handleScriptDownload())
    yield* router.add("GET", "/agent/download/launcher", (request) => handleLauncherDownload(request))
    yield* router.add("GET", "/agent/download/launcher.ps1", (request) => handlePs1Download(request))
  }),
)



