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
  Write-Host "[cody-x:model-scan] $Message"
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

function Add-OllamaManifestModels([string]$ManifestRoot) {
  if (-not (Test-Path $ManifestRoot)) { return }
  Show-CodyScan "reading Ollama manifests: $ManifestRoot"
  $rootFull = [System.IO.Path]::GetFullPath($ManifestRoot).TrimEnd('\')
  Get-ChildItem -LiteralPath $ManifestRoot -File -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-Expired) { return }
    $relative = $_.FullName.Substring($rootFull.Length).TrimStart('\')
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
    Add-OllamaModel ("{0}:{1}" -f ($modelParts -join "/"), $tag) "manifest:$($_.FullName)"
  }
}

function Find-OllamaModels {
  Show-CodyScan "checking Ollama local registry"
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($ollama) {
    Show-CodyScan "running: ollama list"
    try {
      & $ollama.Source list 2>$null | Select-Object -Skip 1 | ForEach-Object {
        $line = "$_".Trim()
        if (-not $line) { return }
        $name = ($line -split '\s+')[0]
        Add-OllamaModel $name "ollama list"
      }
    } catch {
      $notes.Add("ollama list failed: $($_.Exception.Message)")
      Show-CodyScan "ollama list failed; continuing with manifest scan"
    }
  } else {
    Show-CodyScan "ollama executable not found on PATH; checking manifests only"
  }

  $roots = New-Object 'System.Collections.Generic.HashSet[string]'
  if ($env:OLLAMA_MODELS) {
    [void]$roots.Add((Join-Path $env:OLLAMA_MODELS "manifests"))
  }
  [void]$roots.Add((Join-Path $HOME ".ollama\models\manifests"))

  Get-PSDrive -PSProvider FileSystem | ForEach-Object {
    $driveRoot = $_.Root
    [void]$roots.Add((Join-Path $driveRoot ".ollama\models\manifests"))
    $users = Join-Path $driveRoot "Users"
    if (Test-Path $users) {
      Get-ChildItem -LiteralPath $users -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        [void]$roots.Add((Join-Path $_.FullName ".ollama\models\manifests"))
      }
    }
  }

  foreach ($root in $roots) {
    if (Test-Expired) { break }
    Add-OllamaManifestModels $root
  }
}

function Find-GgufModels {
  Show-CodyScan "scanning fixed drives for *.gguf files; max seconds: $MaxSeconds"
  $skipNames = New-Object 'System.Collections.Generic.HashSet[string]'
  @(
    "Windows", "Program Files", "Program Files (x86)", "System Volume Information",
    '$Recycle.Bin', "Recovery", "node_modules", ".git", ".svn", ".hg",
    ".turbo", "target", "__pycache__", "site-packages", ".cache", ".conda",
    "AppData", "ProgramData", "cache", "dist-info", "venv", ".venv", "env",
    ".env", "bun", "npm", "pip", "share", "include", "lib", "libs",
    "Conda", "conda", "PKG-INFO", ".github", ".vscode", "extensions",
    "common7", "CommonExtensions", "VSSDK", "MSBuild", "dotnet",
    "WindowsPowerShell", "PowerShell", "System32", "SysWOW64",
    "assembly", "GAC", "WinMetadata",
    "fontconfig", "freetype", "icu", "harfbuzz",
    ".cargo", "registry", ".rustup",
    ".openclaw", ".codex", "codex", "plugins", "vendor_imports",
    "anything-llm", "crew-agent", "conda_envs",
    "pinokio", "store", "files", "index-v5"
  ) | ForEach-Object { [void]$skipNames.Add($_) }

  $queue = New-Object 'System.Collections.Generic.Queue[string]'
  Get-PSDrive -PSProvider FileSystem | ForEach-Object {
    if ($_.Root -match '^[A-Za-z]:\\$' -and (Test-Path $_.Root)) {
      $queue.Enqueue($_.Root)
    }
  }
  Show-CodyScan ("drives queued: " + ($queue -join ", "))

  $visited = 0
  while ($queue.Count -gt 0) {
    if (Test-Expired) {
      $notes.Add("GGUF scan stopped after $MaxSeconds seconds.")
      break
    }

    $dir = $queue.Dequeue()
    $visited++
    if (($visited % 500) -eq 0) {
      Show-CodyScan "visited $visited folders, found $($ggufModels.Count) GGUF models"
    }

    Get-ChildItem -LiteralPath $dir -File -Filter "*.gguf" -Force -ErrorAction SilentlyContinue | ForEach-Object {
      Add-GgufModel $_.FullName
    }

    Get-ChildItem -LiteralPath $dir -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
      if ($skipNames.Contains($_.Name)) { return }
      if ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { return }
      $queue.Enqueue($_.FullName)
    }
  }
  
  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
  Show-CodyScan "GGUF scan done: $ggufModels.Count models found, visited $visited folders in ${elapsed}s"
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
