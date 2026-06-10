#!/usr/bin/env pwsh
param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$generatedDir = Join-Path $Root ".cody\generated"
$defaultModelFile = Join-Path $generatedDir "cody.json"

if (-not (Test-Path $generatedDir)) {
  New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null
}

if (Test-Path $defaultModelFile) {
  $existing = [System.IO.File]::ReadAllText($defaultModelFile, [System.Text.Encoding]::UTF8)
  if ($existing.Contains('"model": "cody/deepseek-v4-flash-free"') -and $existing.Contains('"DeepSeek V4 Flash Free"')) {
    $json = @'
{
  "$schema": "https://cody.dev/config.json",
  "model": "opencode/big-pickle"
}
'@
    [System.IO.File]::WriteAllText($defaultModelFile, $json, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[ok] Migrated default model to opencode/big-pickle (Sandra Pickle)"
    exit 0
  }
  Write-Host "[ok] Default model config already exists."
  exit 0
}

$json = @'
{
  "$schema": "https://cody.dev/config.json",
  "model": "opencode/big-pickle"
}
'@

[System.IO.File]::WriteAllText($defaultModelFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[ok] Default model configured: opencode/big-pickle (Sandra Pickle)"
