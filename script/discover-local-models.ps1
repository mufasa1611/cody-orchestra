#!/usr/bin/env pwsh
param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$Refresh,
  [int]$MaxSeconds = $(if ($env:CODY_MODEL_SCAN_MAX_SECONDS) { [int]$env:CODY_MODEL_SCAN_MAX_SECONDS } else { 15 })
)

$ErrorActionPreference = "SilentlyContinue"

$generatedDir = Join-Path $Root ".cody\generated"
$configPath = Join-Path $generatedDir "cody.jsonc"
$reportPath = Join-Path $generatedDir "cody-local-models.report.json"
$shouldRefresh = $Refresh -or $env:CODY_REFRESH_MODELS -eq "1"

if ((Test-Path $configPath) -and -not $shouldRefresh) {
  exit 0
}

New-Item -ItemType Directory -Force -Path $generatedDir | Out-Null

$started = Get-Date
$deadline = if ($MaxSeconds -gt 0) { $started.AddSeconds($MaxSeconds) } else { [DateTime]::MaxValue }
$ollamaModels = [ordered]@{}
$ggufModels = [ordered]@{}
$seenPaths = New-Object 'System.Collections.Generic.HashSet[string]'
$notes = New-Object 'System.Collections.Generic.List[string]'

function Show-CodyScan([string]$Message) {
  if ($env:CODY_MODEL_DISCOVERY_QUIET -eq "1") { return }
  Write-Host "[codyx:model-scan] $Message"
}

function Test-Expired {
  return (Get-Date) -gt $deadline
}

function Get-ShortHash([string]$Value) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()).Substring(0, 8)
  } finally {
    $sha.Dispose()
  }
}

function ConvertTo-ModelID([string]$Name, [string]$Path) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($Name).ToLowerInvariant()
  $id = ($base -replace '[^a-z0-9._:-]+', '-').Trim('-')
  if ([string]::IsNullOrWhiteSpace($id)) {
    $id = "gguf-model"
  }
  $suffix = Get-ShortHash $Path
  return "$id-$suffix"
}

function Add-OllamaModel([string]$Name, [string]$Source) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return }
  $model = $Name.Trim()
  if ($model -eq "NAME") { return }
  if ($model -like "*:cloud") { return }
  $ollamaModels[$model] = [ordered]@{
    name = "$model (Ollama local)"
    tool_call = $true
    limit = [ordered]@{
      context = 32768
      output = 8192
    }
    options = [ordered]@{
      codyLocalKind = "ollama-local"
      codyLocalSource = $Source
    }
  }
  Show-CodyScan "found Ollama model: $model"
}

function Add-GgufModel([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $full = [System.IO.Path]::GetFullPath($Path)
  $leaf = [System.IO.Path]::GetFileName($full)
  if ($leaf -match '-(\d{5})-of-(\d{5})\.gguf$' -and $Matches[1] -ne "00001") { return }
  if (-not $seenPaths.Add($full)) { return }
  $name = [System.IO.Path]::GetFileNameWithoutExtension($full) -replace '-00001-of-\d{5}$', ''
  $id = ConvertTo-ModelID $name $full
  while ($ggufModels.Contains($id)) {
    $id = "$id-$(Get-ShortHash ([Guid]::NewGuid().ToString()))"
  }
  $ggufModels[$id] = [ordered]@{
    name = "$name (GGUF local)"
    tool_call = $true
    limit = [ordered]@{
      context = 32768
      output = 8192
    }
    options = [ordered]@{
      codyLocalKind = "llama-cpp-local"
      codyLocalPath = $full
    }
  }
  Show-CodyScan "found GGUF model: $name at $full"
}

function Get-FilesBeforeDeadline([string]$SearchRoot, [string]$Filter, [string]$Label) {
  if (-not (Test-Path -LiteralPath $SearchRoot) -or (Test-Expired)) { return @() }
  $remaining = [math]::Max(1, [math]::Ceiling(($deadline - (Get-Date)).TotalSeconds))
  $job = Start-Job -ScriptBlock {
    param($Path, $FileFilter)
    Get-ChildItem -LiteralPath $Path -File -Filter $FileFilter -Recurse -Force -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FullName
  } -ArgumentList $SearchRoot, $Filter
  try {
    if (Wait-Job -Job $job -Timeout $remaining) {
      return @(Receive-Job -Job $job -ErrorAction SilentlyContinue)
    }
    $notes.Add("$Label stopped at the model-discovery deadline.")
    Show-CodyScan "$Label reached the time limit; continuing"
    return @()
  } finally {
    if ($job.State -eq "Running") { Stop-Job -Job $job -ErrorAction SilentlyContinue }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
  }
}

function Add-OllamaManifestModels([string]$ManifestRoot) {
  if (-not (Test-Path $ManifestRoot)) { return }
  Show-CodyScan "reading Ollama manifests: $ManifestRoot"
  $rootFull = [System.IO.Path]::GetFullPath($ManifestRoot).TrimEnd('\')
  Get-FilesBeforeDeadline $ManifestRoot "*" "Ollama manifest scan" | ForEach-Object {
    if (Test-Expired) { return }
    $fullName = "$_"
    $relative = $fullName.Substring($rootFull.Length).TrimStart('\')
    $parts = $relative -split '[\\/]'
    if ($parts.Length -lt 3) { return }
    $registry = $parts[0]
    $tag = $parts[$parts.Length - 1]
    $modelParts = $parts[1..($parts.Length - 2)]
    if ($registry -eq "registry.ollama.ai" -and $modelParts[0] -eq "library") {
      if ($modelParts.Length -le 1) { return }
      $modelParts = $modelParts[1..($modelParts.Length - 1)]
    }
    if (-not $modelParts -or $modelParts.Length -eq 0) { return }
    Add-OllamaModel ("{0}:{1}" -f ($modelParts -join "/"), $tag) "manifest:$fullName"
  }
}

function Find-OllamaModels {
  Show-CodyScan "checking Ollama local registry"
  try {
    $timeout = [math]::Max(1, [math]::Min(5, [math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)))
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get -TimeoutSec $timeout
    @($response.models) | ForEach-Object {
      $name = if ($_.name) { "$($_.name)" } else { "$($_.model)" }
      Add-OllamaModel $name "ollama api"
    }
  } catch {
    $notes.Add("Ollama API was unavailable; checked manifests instead.")
    Show-CodyScan "Ollama API unavailable; checking manifests"
  }

  $roots = New-Object 'System.Collections.Generic.HashSet[string]'
  if ($env:OLLAMA_MODELS) {
    [void]$roots.Add((Join-Path $env:OLLAMA_MODELS "manifests"))
  }
  [void]$roots.Add((Join-Path $HOME ".ollama\models\manifests"))

  foreach ($root in $roots) {
    if (Test-Expired) { break }
    Add-OllamaManifestModels $root
  }
}

function Find-GgufModels {
  $roots = New-Object 'System.Collections.Generic.HashSet[string]'
  if ($env:CODY_GGUF_PATHS) {
    $env:CODY_GGUF_PATHS -split [IO.Path]::PathSeparator | ForEach-Object {
      if ($_ -and $_.Trim()) { [void]$roots.Add($_.Trim()) }
    }
  }
  @(
    (Join-Path $HOME "Models"),
    (Join-Path $HOME "Documents\Models"),
    (Join-Path $HOME ".cache\lm-studio\models"),
    (Join-Path $env:LOCALAPPDATA "LM-Studio\models"),
    (Join-Path $env:LOCALAPPDATA "llama.cpp\models")
  ) | ForEach-Object {
    if ($_ -and (Test-Path -LiteralPath $_)) { [void]$roots.Add($_) }
  }

  if ($roots.Count -eq 0) {
    Show-CodyScan "no standard GGUF model directories found"
    return
  }

  Show-CodyScan "scanning known GGUF model directories; max seconds: $MaxSeconds"
  foreach ($root in $roots) {
    if (Test-Expired) { break }
    Show-CodyScan "checking GGUF directory: $root"
    Get-FilesBeforeDeadline $root "*.gguf" "GGUF scan for $root" | ForEach-Object {
      Add-GgufModel "$_"
    }
  }

  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  Show-CodyScan "GGUF scan done: $($ggufModels.Count) models found in ${elapsed}s"
}

Show-CodyScan "starting first-run local model discovery"
Show-CodyScan "generated config target: $configPath"
Find-OllamaModels
Find-GgufModels

$providers = [ordered]@{}

if ($ollamaModels.Count -gt 0) {
  $providers["ollama-local"] = [ordered]@{
    npm = "@ai-sdk/openai-compatible"
    name = "Ollama Local (auto-discovered)"
    options = [ordered]@{
      baseURL = "http://localhost:11434/v1"
      apiKey = "ollama"
    }
    models = $ollamaModels
  }
}

if ($ggufModels.Count -gt 0) {
  $providers["llama-cpp-local"] = [ordered]@{
    npm = "@ai-sdk/openai-compatible"
    name = "llama.cpp Local (auto-discovered GGUF)"
    options = [ordered]@{
      baseURL = $(if ($env:CODY_LLAMA_CPP_BASE_URL) { $env:CODY_LLAMA_CPP_BASE_URL } else { "http://localhost:8080/v1" })
      apiKey = $(if ($env:CODY_LLAMA_CPP_API_KEY) { $env:CODY_LLAMA_CPP_API_KEY } else { "llama-cpp" })
    }
    models = $ggufModels
  }
}

$config = [ordered]@{
  '$schema' = "https://cody.dev/config.json"
  provider = $providers
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("o")
  maxSeconds = $MaxSeconds
  ollamaModelCount = $ollamaModels.Count
  ggufModelCount = $ggufModels.Count
  configPath = $configPath
  notes = @($notes)
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8NoBom)
[System.IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 10), $utf8NoBom)
$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Show-CodyScan "done in ${elapsed}s. Ollama: $($ollamaModels.Count), GGUF: $($ggufModels.Count) models"
Show-CodyScan "model config written to: $configPath"
