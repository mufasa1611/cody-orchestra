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
Assert-Contains "script/install.ps1" '\$env:ComSpec /d /s /c \$versionCommand' "Windows installer verifies the global shim through cmd"
Assert-NotContains "script/install.ps1" '\& \$GlobalCmd --version 2>\$null' "Windows health check does not convert version stderr into a PowerShell error"
Assert-NotContains "script/install.ps1" '\& powershell ' "Windows installer has no ambiguous bare PowerShell invocation"
Assert-NotContains "script/install.ps1" '(git clone|git fetch|git switch|git pull|bun install|bun run build)[^\r\n]*2>&1' "Windows native tools do not merge stderr into PowerShell errors"
Assert-Contains "script/install.ps1" '\$CheckoutRoot.*Split-Path -Parent \$PSScriptRoot' "Windows installer detects a local checkout"
Assert-Contains "script/install.ps1" 'script/install-npm\.ps1' "Streamed Windows installer dispatches to the npm bootstrap"
Assert-Contains "script/install.ps1" '25334282c686d23b94d7fc8c0a0068e2509509ae' "Main installer pins the corrected npm bootstrap against raw branch caching"
Assert-Contains "script/install.ps1" 'Test-BunVersion' "Windows installer enforces the supported Bun version"
Assert-Contains "script/install.ps1" 'VERIFICATION_URL = "https://install\.kingkung\.men"' "Windows installer uses the production verification service"
Assert-Contains "script/install.ps1" 'installer-verification\.ps1' "Windows installer loads the verification helper"
Assert-Contains "script/install.ps1" 'NonInteractive = -not \(Test-InteractiveHost\)' "Windows installer detects noninteractive verification"
Assert-Contains "script/install.ps1" 'if \(-not \$verificationResult\.Success\)' "Windows installer stops when verification fails"
Assert-Contains "script/install.ps1" 'Bun 1\.3\.13\+ found\.[\s\S]*Loading installer email verification[\s\S]*cloudflared' "Windows verification runs after Bun and before cloudflared"
Assert-NotContains "script/install.ps1" '[^\x00-\x7F]' "Streamed Windows installer is ASCII-safe for Windows PowerShell"
Assert-Contains "codyx.cmd" 'CODY_ORIGINAL_HTTP_PROXY=!HTTP_PROXY!' "Windows launcher preserves the user's HTTP proxy"
Assert-Contains "codyx.cmd" 'if not "%CODY_PROXY_ENABLED%"=="1" \([\s\S]*HTTP_PROXY=!CODY_ORIGINAL_HTTP_PROXY![\s\S]*HTTPS_PROXY=!CODY_ORIGINAL_HTTPS_PROXY!' "Disabled Cody proxy does not hijack update checks"
Assert-NotContains "codyx.cmd" 'git fetch origin !CODY_CURRENT_BRANCH! --quiet --depth 1' "Windows launcher does not truncate Git history during update checks"
Assert-Contains "codyx.cmd" 'git rev-parse --is-shallow-repository' "Windows launcher detects shallow update history"
Assert-Contains "codyx.cmd" 'git fetch origin !CODY_CURRENT_BRANCH! --quiet --unshallow' "Windows launcher repairs shallow update history"
Assert-Contains "codyx.cmd" 'git merge --ff-only origin/!CODY_CURRENT_BRANCH!' "Windows launcher updates the fetched branch without a second fetch"
Assert-Contains "codyx.cmd" 'CODY_AHEAD' "Windows launcher distinguishes local commits from available updates"
Assert-Contains "codyx.cmd" 'set "CODY_SKIP_UPDATE_CHECK=1"' "Windows launcher prevents a duplicate startup update"
Assert-Contains "packages/codyx/src/index.ts" 'process\.env\.CODY_SKIP_UPDATE_CHECK !== "1"' "CLI honors the launcher update decision"
Assert-Contains "script/install.ps1" 'git fetch origin \$Branch --unshallow --quiet' "Windows installer repairs shallow checkouts"
Assert-Contains "script/install-npm.ps1" 'https://nodejs\.org/dist/index\.json' "Npm bootstrap discovers the current Node LTS release"
Assert-Contains "script/install-npm.ps1" 'SHASUMS256\.txt' "Npm bootstrap verifies the Node archive checksum"
Assert-Contains "script/install-npm.ps1" 'Programs\\codyx-node' "Npm bootstrap installs Node without administrator rights"
Assert-Contains "script/install-npm.ps1" '\$Script:NpmCommand install --global "codyx-ai@\$Version" --no-audit --no-fund --force' "Npm bootstrap installs the requested codyx-ai version"
Assert-Contains "script/install-npm.ps1" 'Loading installer email verification[\s\S]*Installing codyx-ai@' "Npm bootstrap verifies email before installing codyx"
Assert-NotContains "script/install-npm.ps1" 'git clone|bun install' "Npm bootstrap does not clone or build the source repository"
Assert-NotContains "script/install-npm.ps1" '[^\x00-\x7F]' "Npm bootstrap is ASCII-safe for Windows PowerShell"
Assert-Contains "script/install-npm.ps1" 'node_modules\\codyx-ai\\package\.json' "Npm bootstrap reads installed version metadata without capturing inherited launcher output"
Assert-Contains "packages/codyx/bin/_launcher.js" 'CODY_INSTALL_METHOD: process\.env\.CODY_INSTALL_METHOD \|\| "npm"' "Npm launcher marks package-managed executions"
Assert-Contains "packages/codyx/src/installation/index.ts" 'CODY_INSTALL_METHOD === "npm"' "Installation detection honors the npm launcher marker"
Assert-Contains "packages/codyx/src/cli/upgrade.ts" 'npm install -g codyx-ai@latest --no-audit --no-fund' "Interactive npm updates use the published package"
Assert-Contains ".github/workflows/publish-npm.yml" "github\.repository == 'mufasa1611/cody-orchestra'" "Npm publishing is enabled only for this fork"
Assert-Contains ".github/workflows/publish-npm.yml" 'NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}' "Npm publishing uses the repository npm token"
Assert-Contains "script/installer-verification.ps1" 'receipts/validate' "Verification helper validates saved receipts online"
Assert-Contains "script/installer-verification.ps1" 'change-email, retry, or cancel' "Verification helper exposes recovery commands"
Assert-Contains "script/installer-verification.ps1" 'privacy@kingkung\.men' "Verification helper publishes the deletion contact"
Assert-Contains "script/installer-verification.ps1" 'source code, prompts, project content' "Verification helper discloses excluded project data"
Assert-NotContains "script/installer-verification.ps1" 'if \(\$Yes\)' "Verification helper cannot be bypassed by -Yes"
Assert-Contains "script/install-codyx-global.ps1" 'call "\$repoLauncher" %\*' "CMD shim delegates to the repo launcher"
Assert-Contains "script/install-codyx-global.ps1" '\& "\$repoLauncher" @args' "PowerShell shim delegates to the repo launcher"
Assert-NotContains "script/install-codyx-global.ps1" '%~dp0\.\.\\\.\.\\codyx' "CMD shim has no guessed install path"
Assert-NotContains "script/install-codyx-global.ps1" '[^\x00-\x7F]' "Global installer is ASCII-safe for Windows PowerShell"
Assert-Contains "script/discover-local-models.ps1" '127\.0\.0\.1:11434/api/tags' "Model discovery uses the bounded Ollama API"
Assert-NotContains "script/discover-local-models.ps1" 'ollama\.Source list|running: ollama list' "Model discovery does not invoke an unbounded Ollama process"
Assert-Contains "script/discover-local-models.ps1" 'CODY_GGUF_PATHS' "Model discovery supports explicit GGUF roots"
Assert-NotContains "script/discover-local-models.ps1" 'Get-PSDrive' "Model discovery does not crawl every fixed drive"
Assert-Contains "script/install.sh" 'GLOBAL_BIN_DIR="\$\{CODY_GLOBAL_BIN_DIR:-\$HOME/\.local/bin\}"' "Unix launcher uses the standard user bin"
Assert-Contains "script/install.sh" 'export CODY_INSTALL_ROOT=' "Unix launcher exports its install root"
Assert-Contains "script/install.sh" 'fish_add_path' "Unix installer writes valid Fish PATH syntax"
Assert-Contains "script/install.sh" 'Global command verified' "Unix installer verifies the global command"
Assert-Contains "script/install.sh" '\[ "\$YES" = "1" \] && \[ "\$REBOOT" = "1" \]' "Non-interactive server install does not reboot by default"
Assert-Contains "script/install.sh" 'bun_version_supported' "Unix installer enforces the supported Bun version"
Assert-Contains "script/install.sh" 'git fetch origin "\$BRANCH" --unshallow --quiet' "Unix installer repairs shallow checkouts"
Assert-Contains "script/install.sh" 'serve --mode server' "Unix server service enables verified account mode"
Assert-Contains "script/install.sh" 'Environment=CODY_SERVER_MODE=server' "Unix service records server mode explicitly"
Assert-Contains "script/install.sh" 'Environment=CODY_VERIFICATION_URL=https://install\.kingkung\.men' "Unix service uses the production verification service"
Assert-NotContains "script/install.sh" 'Skipping web UI build \(no browser in server\)' "Headless servers still build the remote WebUI"
Assert-Contains "install.sh" 'REPO="mufasa1611/cody-orchestra"' "Deprecated Unix entry point redirects to the current repository"
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
