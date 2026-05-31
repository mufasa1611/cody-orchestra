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
  Write-Host "[ok] Default model config already exists."
  exit 0
}

$json = @'
{
  "$schema": "https://cody.dev/config.json",
  "model": "cody/deepseek-v4-flash-free",
  "provider": {
    "cody": {
      "models": {
        "deepseek-v4-flash-free": {
          "name": "DeepSeek V4 Flash Free",
          "reasoning": false,
          "tool_call": true,
          "temperature": true,
          "cost": { "input": 0, "output": 0 },
          "limit": { "context": 200000, "output": 128000 }
        }
      }
    }
  }
}
'@

[System.IO.File]::WriteAllText($defaultModelFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "[ok] Default model configured: cody/deepseek-v4-flash-free"
