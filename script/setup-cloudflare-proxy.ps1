# Setup Cloudflare TCP proxy tunnel for cody-x
$ErrorActionPreference = "Stop"
$ProxyPort = 9999
$ProxyHostname = "proxy.kingkung.men"

$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
  $cfPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (Test-Path $cfPath) {
    $cf = $cfPath
  } else {
    Write-Host "[error] cloudflared not found."
    Write-Host "  Install from: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/"
    exit 1
  }
}

Write-Host "[info] Starting Cloudflare TCP tunnel to $ProxyHostname ..."
Write-Host "[info] Local proxy available on localhost:$ProxyPort"

Start-Process -FilePath $cf -ArgumentList @("access", "tcp", "--hostname", $ProxyHostname, "--url", "localhost:$ProxyPort") -WindowStyle Hidden -PassThru | Out-Null

for ($i = 0; $i -lt 30; $i++) {
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("localhost", $ProxyPort)
    $tcp.Close()
    Write-Host "[ok] Cloudflare TCP tunnel ready on localhost:$ProxyPort"
    exit 0
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

Write-Host "[error] Tunnel did not start within 15 seconds"
exit 1
