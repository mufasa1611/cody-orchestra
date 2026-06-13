param()

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$failures = [System.Collections.Generic.List[string]]::new()
$checks = 0

function Assert-Contains($Path, $Pattern, $Label) {
  $script:checks++
  $content = Get-Content -LiteralPath (Join-Path $Root $Path) -Raw
  if ($content -notmatch $Pattern) {
    $script:failures.Add("$Label ($Path)")
  }
}

function Assert-NotContains($Path, $Pattern, $Label) {
  $script:checks++
  $content = Get-Content -LiteralPath (Join-Path $Root $Path) -Raw
  if ($content -match $Pattern) {
    $script:failures.Add("$Label ($Path)")
  }
}

Assert-Contains "README.md" "cody-orchestra/main/script/install\.sh" "README uses the main branch"
Assert-NotContains "README.md" "cody-orchestra/master/script/install\.sh" "README has no stale master installer URL"
Assert-Contains "CODYX_INSTALL_UPDATE.md" "main/script/install\.ps1" "Install guide uses the unified Windows installer"
Assert-NotContains "CODYX_INSTALL_UPDATE.md" "master/install\.ps1" "Install guide has no deprecated master URL"
Assert-Contains "script/install.ps1" 'install-codyx-global\.ps1.*-Root \$Root' "Windows installer propagates InstallRoot"
Assert-Contains "script/install.ps1" '\& \$GlobalCmd --version' "Windows installer verifies the global shim"
Assert-NotContains "script/install.ps1" '\& powershell ' "Windows installer has no ambiguous bare PowerShell invocation"
Assert-Contains "script/install.ps1" '\$CheckoutRoot.*Split-Path -Parent \$PSScriptRoot' "Windows installer detects a local checkout"
Assert-Contains "script/install.ps1" 'Test-BunVersion' "Windows installer enforces the supported Bun version"
Assert-Contains "script/install-codyx-global.ps1" 'call "\$repoLauncher" %\*' "CMD shim delegates to the repo launcher"
Assert-Contains "script/install-codyx-global.ps1" '\& "\$repoLauncher" @args' "PowerShell shim delegates to the repo launcher"
Assert-NotContains "script/install-codyx-global.ps1" '%~dp0\.\.\\\.\.\\codyx' "CMD shim has no guessed install path"
Assert-Contains "script/install.sh" 'GLOBAL_BIN_DIR="\$\{CODY_GLOBAL_BIN_DIR:-\$HOME/\.local/bin\}"' "Unix launcher uses the standard user bin"
Assert-Contains "script/install.sh" 'export CODY_INSTALL_ROOT=' "Unix launcher exports its install root"
Assert-Contains "script/install.sh" 'fish_add_path' "Unix installer writes valid Fish PATH syntax"
Assert-Contains "script/install.sh" 'Global command verified' "Unix installer verifies the global command"
Assert-Contains "script/install.sh" '\[ "\$YES" = "1" \] && \[ "\$REBOOT" = "1" \]' "Non-interactive server install does not reboot by default"
Assert-Contains "script/install.sh" 'bun_version_supported' "Unix installer enforces the supported Bun version"
Assert-Contains "packages/codyx/src/cli/cmd/uninstall.ts" 'codyx-ai' "Uninstall uses the current package name"
Assert-Contains "packages/codyx/src/cli/cmd/uninstall.ts" '\.local", "bin", "codyx"' "Uninstall removes the Unix global launcher"
Assert-NotContains "packages/codyx/src/cli/cmd/uninstall.ts" 'removeNpmPathEntry' "Uninstall preserves the shared npm PATH entry"
Assert-NotContains "packages/codyx/src/index.ts" 'system-state\.json' "CLI has no state-file deletion switch"
Assert-NotContains "packages/codyx/src/index.ts" 'rm -rf|rmdir /s /q' "CLI entry point cannot delete its checkout"
Assert-Contains ".gitignore" '\.codyx-install-marker' "Generated install marker is ignored"

if ($failures.Count -gt 0) {
  Write-Host "$($failures.Count) of $checks installer checks failed:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "All $checks installer checks passed." -ForegroundColor Green
