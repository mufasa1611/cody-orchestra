param([string]$Root)
if (-not $Root -or -not (Test-Path $Root)) { $Root = Join-Path $PSScriptRoot ".." }
$genDir = Join-Path $root ".cody\generated"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

# Strip UTF-8 BOM from both cody.json and cody.jsonc
foreach ($name in @("cody.json", "cody.jsonc")) {
    $cfg = Join-Path $genDir $name
    if (Test-Path $cfg) {
        $bytes = [System.IO.File]::ReadAllBytes($cfg)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            [System.IO.File]::WriteAllText($cfg, [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3), $utf8NoBom)
            Write-Host "[cody-x] Fixed BOM in $name"
        }
    }
}

# Fix empty key in cody.json caused by old install.ps1 here-string $schema interpolation
$legacyCfg = Join-Path $genDir "cody.json"
if (Test-Path $legacyCfg) {
    $text = [System.IO.File]::ReadAllText($legacyCfg, [Text.Encoding]::UTF8)
    if ($text.Contains('"":')) {
        Write-Host "[cody-x] Fixed empty key in cody.json"
        $fixed = @'
{
  "$schema": "https://cody.dev/config.json",
  "model": "cody/deepseek-v4-flash-free"
}
'@
        [System.IO.File]::WriteAllText($legacyCfg, $fixed.TrimStart(), $utf8NoBom)
    }
}

