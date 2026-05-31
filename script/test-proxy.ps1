#!/usr/bin/env pwsh
param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$Url = "https://api.cody.ai"
)

$ErrorActionPreference = "Stop"

$proxyFile = Join-Path $Root ".env.proxy"
if (-not (Test-Path $proxyFile)) {
  $proxyFile = Join-Path $Root ".env"
}
if (-not (Test-Path $proxyFile)) {
  throw "No proxy config found. Create .env.proxy from .env.proxy.example."
}

$values = @{}
Get-Content $proxyFile | ForEach-Object {
  if ($_ -notmatch "^\s*#" -and $_ -match "^\s*([^=]+)=(.*)$") {
    $values[$matches[1].Trim()] = $matches[2].Trim()
  }
}

$proxy = $values["HTTPS_PROXY"]
if (-not $proxy) {
  $proxy = $values["HTTP_PROXY"]
}
if (-not $proxy) {
  throw "HTTPS_PROXY or HTTP_PROXY is required in $proxyFile."
}

$proxyUri = [Uri]$proxy
$tcp = New-Object Net.Sockets.TcpClient
try {
  $connect = $tcp.BeginConnect($proxyUri.Host, $proxyUri.Port, $null, $null)
  if (-not $connect.AsyncWaitHandle.WaitOne(5000)) {
    throw "Timed out connecting to proxy $proxy."
  }
  $tcp.EndConnect($connect)
  Write-Host "[ok] Proxy reachable: $proxy"
} finally {
  $tcp.Dispose()
}

$noProxy = $values["NO_PROXY"]
if ($noProxy -match "(^|,)localhost(,|$)" -and $noProxy -match "(^|,)127\.0\.0\.1(,|$)") {
  Write-Host "[ok] NO_PROXY includes localhost and 127.0.0.1"
} else {
  Write-Host "[warn] NO_PROXY should include localhost and 127.0.0.1"
}

$response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Proxy $proxy -TimeoutSec 20
Write-Host "[ok] Request through proxy succeeded: $($response.StatusCode) $Url"
