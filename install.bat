@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "CODY_VERSION=1.0.0"
set "REPO_URL=https://github.com/mufasa1611/cody-orchestra.git"
set "CREDITS=Builder: M. Farid (Mufasa) - Repo: %REPO_URL%"
if not defined CODY_BRANCH set "CODY_BRANCH=main"
if not defined CODY_NO_SCAN set "CODY_NO_SCAN=0"
if not defined CODY_NO_PROXY set "CODY_NO_PROXY=0"
if not defined CODY_NO_BUILD set "CODY_NO_BUILD=0"
if not defined CODY_YES set "CODY_YES=0"
set "INSTALLER_URL=https://raw.githubusercontent.com/mufasa1611/cody-orchestra/%CODY_BRANCH%/install.bat"
set "DEFAULT_PARENT=%LOCALAPPDATA%\codyx"
set "DEFAULT_ROOT=%DEFAULT_PARENT%"
set "GLOBAL_BIN=%APPDATA%\npm"
set "GLOBAL_CMD=%GLOBAL_BIN%\codyx.cmd"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if defined CODY_INSTALL_ROOT set "ROOT=%CODY_INSTALL_ROOT%"
if not exist "%ROOT%\package.json" set "ROOT=%DEFAULT_ROOT%"

rem ── ANSI color support ────────────────────────────────────────────
set "ESC="
for /f "delims=#" %%a in ('"prompt #$E# & for %%b in (1) do rem"') do set "ESC=%%a"
set "NORMAL="
set "GREEN="
set "YELLOW="
set "RED="
set "CYAN="
set "BOLD="
if defined ESC (
  set "NORMAL=%ESC%[0m"
  set "GREEN=%ESC%[92m"
  set "YELLOW=%ESC%[93m"
  set "RED=%ESC%[91m"
  set "CYAN=%ESC%[96m"
  set "BOLD=%ESC%[1m"
)

rem ── Section counter ───────────────────────────────────────────────
set SECTION=0

call :PrintBanner

rem ── Self-update check ─────────────────────────────────────────────
if "%CODY_INSTALLER_SELF_UPDATED%"=="1" goto AfterSelfUpdate

where powershell >nul 2>nul
if errorlevel 1 goto AfterSelfUpdate

set "LATEST_INSTALLER=%TEMP%\codyx-install-latest-%RANDOM%%RANDOM%.bat"
if "%CODY_INSTALLER_SELF_UPDATE%"=="0" goto AfterSelfUpdate
call :PrintInfo "Checking for installer updates..."
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%INSTALLER_URL%' -OutFile '%LATEST_INSTALLER%'; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  del "%LATEST_INSTALLER%" >nul 2>nul
  call :PrintWarn "Could not download latest installer. Continuing."
  goto AfterSelfUpdate
)

fc /b "%~f0" "%LATEST_INSTALLER%" >nul 2>nul
if not errorlevel 1 (
  del "%LATEST_INSTALLER%" >nul 2>nul
  call :PrintOk "Installer is up to date."
  goto AfterSelfUpdate
)

echo %CYAN%%BOLD%[info]%NORMAL% New installer found. Running latest from GitHub...
set "CODY_INSTALLER_SELF_UPDATED=1"
set "CODY_INSTALL_ROOT=%ROOT%"
call "%LATEST_INSTALLER%" %*
set "LATEST_INSTALLER_EXIT=!ERRORLEVEL!"
del "%LATEST_INSTALLER%" >nul 2>nul
exit /b %LATEST_INSTALLER_EXIT%

:AfterSelfUpdate

rem ── Track created items for rollback ──────────────────────────────
set "CREATED_REPO=0"

where winget >nul 2>nul
if not errorlevel 1 (
  set "HAS_WINGET=1"
) else (
  set "HAS_WINGET=0"
)

rem ── Phase 1: Git ──────────────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Checking prerequisites"

call :EnsureCommand git "Git.Git" "Git"
if errorlevel 1 goto FatalCleanup

set "HAS_CHECKOUT=0"
if exist "%ROOT%\package.json" if exist "%ROOT%\codyx.cmd" set "HAS_CHECKOUT=1"

if "%HAS_CHECKOUT%"=="1" (
  call :PrintOk "codyx checkout found."
) else (
  set /a SECTION+=1
  call :PrintSection "Cloning codyx from GitHub"
  if exist "%DEFAULT_ROOT%" (
    call :PrintErr "%DEFAULT_ROOT% exists but is not a codyx checkout."
    call :PrintErr "Move it away or set CODY_INSTALL_ROOT, then rerun."
    exit /b 1
  )
  if not exist "%DEFAULT_PARENT%" mkdir "%DEFAULT_PARENT%" >nul 2>nul
  set "CLONE_RETRY=1"
  set "CLONE_BACKOFF=1"
  :RetryClone
  git clone --branch "%CODY_BRANCH%" "%REPO_URL%" "%DEFAULT_ROOT%"
  if not errorlevel 1 goto CloneOk
  if !CLONE_RETRY! geq 3 (
    call :PrintErr "Failed to clone after 3 attempts."
    goto FatalCleanup
  )
  call :PrintWarn "Clone failed (attempt !CLONE_RETRY!/3). Retrying in !CLONE_BACKOFF!s..."
  ping -n !CLONE_BACKOFF! 127.0.0.1 >nul 2>nul
  set /a "CLONE_BACKOFF*=2"
  if !CLONE_BACKOFF! gtr 16 set "CLONE_BACKOFF=16"
  set /a "CLONE_RETRY+=1"
  goto RetryClone
  :CloneOk
  set "CREATED_REPO=1"
  set "ROOT=%DEFAULT_ROOT%"
  call :PrintOk "Cloned to %ROOT%."
  git config --global --add safe.directory "%ROOT%" >nul 2>nul
)

call :UpdateCheckout

rem ── Phase 2: Bun ──────────────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Installing Bun"

call :EnsureBun
if errorlevel 1 goto FatalCleanup

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%PATH%"

where bun >nul 2>nul
if errorlevel 1 (
  call :PrintErr "Bun is still not available on PATH."
  call :PrintErr "Close and reopen the terminal, then rerun."
  goto FatalCleanup
)

rem ── Phase 3: Dependencies ─────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Installing dependencies"

pushd "%ROOT%"
set "BUN_RETRY=1"
set "BUN_BACKOFF=1"
:RetryBunInstall
call bun install
if not errorlevel 1 goto BunInstallOk
if !BUN_RETRY! geq 3 (
  call :PrintErr "bun install failed after 3 attempts."
  call :PrintErr "Try increasing Windows page file size, then rerun."
  popd
  goto FatalCleanup
)
call :PrintWarn "bun install failed (attempt !BUN_RETRY!/3). Retrying in !BUN_BACKOFF!s..."
ping -n !BUN_BACKOFF! 127.0.0.1 >nul 2>nul
set /a "BUN_BACKOFF*=2"
if !BUN_BACKOFF! gtr 16 set "BUN_BACKOFF=16"
set /a "BUN_RETRY+=1"
goto RetryBunInstall
:BunInstallOk
call :PrintOk "Dependencies installed."

rem ── Phase 4: Web UI ───────────────────────────────────────────────
if "%CODY_NO_BUILD%"=="1" (
  call :PrintInfo "Web UI build skipped (CODY_NO_BUILD=1)."
) else (
  set /a SECTION+=1
  call :PrintSection "Building Web UI"
  pushd "%ROOT%\packages\app"
  call bun run build
  if errorlevel 1 (
    popd
    call :PrintWarn "Web UI build failed, server will proxy to app.codyx.ai."
    goto AfterWebBuild
  )
  popd
)
:AfterWebBuild

rem ── Phase 5: Proxy config ─────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Configuring proxy settings"

if not exist "%ROOT%\.env.proxy" (
  >"%ROOT%\.env.proxy" echo CODY_PROXY_ENABLED=0
  >>"%ROOT%\.env.proxy" echo HTTPS_PROXY=http://localhost:9999
  >>"%ROOT%\.env.proxy" echo HTTP_PROXY=http://localhost:9999
  >>"%ROOT%\.env.proxy" echo NO_PROXY=localhost,127.0.0.1,::1
  call :PrintOk ".env.proxy created (proxy disabled by default)."
  call :PrintInfo "Enable proxy: edit .env.proxy and set CODY_PROXY_ENABLED=1"
) else (
  call :PrintOk ".env.proxy already exists."
)

if "%CODY_NO_PROXY%"=="1" goto AfterProxy

call :PrintInfo "Checking cloudflared for optional proxy tunnel..."
where cloudflared >nul 2>nul
if not errorlevel 1 (
  call :PrintOk "cloudflared found."
) else if "%HAS_WINGET%"=="1" (
  call :PrintInfo "Installing cloudflared with winget..."
  winget install --id Cloudflare.cloudflared --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    call :PrintWarn "cloudflared install failed. Install manually if needed."
  ) else (
    call :PrintOk "cloudflared installed."
  )
) else (
  call :PrintInfo "cloudflared not found. Skip or install manually."
)
:AfterProxy

rem ── Phase 6: Model discovery ──────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Model discovery"

if "%CODY_NO_SCAN%"=="1" (
  call :PrintInfo "Model scan skipped (CODY_NO_SCAN=1)."
  goto AfterModelScan
)
call :PrintInfo "codyx can scan for local Ollama models and GGUF files."
set /p "SCAN_ANSWER=Scan for local models now? [y/N] "
if /I "!SCAN_ANSWER!"=="y" (
  if exist "%ROOT%\script\discover-local-models.ps1" (
    call :PrintInfo "Scanning for local models..."
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\discover-local-models.ps1" -Root "%ROOT%" -MaxSeconds 30
  ) else (
    call :PrintWarn "Model discovery script not found."
  )
) else (
  call :PrintInfo "Scan later: powershell -File \"%ROOT%\script\discover-local-models.ps1\""
)
:AfterModelScan
if not exist "%ROOT%\.cody\generated" mkdir "%ROOT%\.cody\generated" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\ensure-default-config.ps1" -Root "%ROOT%"

rem ── Phase 7: Global command ───────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Installing global command"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\install-codyx-global.ps1" -Root "%ROOT%"
if errorlevel 1 goto FatalCleanup

if not exist "%GLOBAL_CMD%" (
  call :PrintErr "Global command shim not created at %GLOBAL_CMD%."
  goto FatalCleanup
)

rem ── Phase 8: Health check ─────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Verifying installation"

pushd "%ROOT%\packages\codyx"
for /f "delims=" %%V in ('bun run --conditions=browser src\index.ts --version 2^>nul') do set "CODY_VERSION=%%V"
popd
if not defined CODY_VERSION (
  call :PrintErr "codyx failed to start. Check the error above."
  goto FatalCleanup
)
call :PrintOk "codyx version: !CODY_VERSION!"

rem ── Phase 9: Start Menu ───────────────────────────────────────────
set /a SECTION+=1
call :PrintSection "Creating shortcuts"

set "START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\codyx"
if not exist "%START_MENU_DIR%" mkdir "%START_MENU_DIR%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%START_MENU_DIR%\Uninstall codyx.lnk'); $shortcut.TargetPath = 'cmd.exe'; $shortcut.Arguments = '/c \"\"%GLOBAL_CMD%\"\" uninstall'; $shortcut.Description = 'Uninstall codyx'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.Save()" >nul 2>nul
if errorlevel 1 (
  call :PrintWarn "Could not create uninstall shortcut."
) else (
  call :PrintOk "Uninstall shortcut created."
)

rem ── Done ──────────────────────────────────────────────────────────
echo.
echo %GREEN%%BOLD%  ╔═══════════════════════════════════════╗%NORMAL%
echo %GREEN%%BOLD%  ║     codyx installed successfully!     ║%NORMAL%
echo %GREEN%%BOLD%  ╚═══════════════════════════════════════╝%NORMAL%
echo.
echo   Installed to: %ROOT%
echo   Global command: codyx
echo   Version: !CODY_VERSION!
echo.
echo   Next steps:
echo     codyx           Launch interactive menu
echo     codyx web       Start web UI in browser
echo     codyx --help    See all commands
echo.
echo %CREDITS%
echo.
endlocal
exit /b 0

rem ── Fatal error ──────────────────────────────────────────────────
:FatalCleanup
echo.
call :PrintErr "Installation failed. Cleaning up..."
if "%CREATED_REPO%"=="1" (
  if exist "%ROOT%" (
    rmdir /s /q "%ROOT%" >nul 2>nul
    call :PrintInfo "Removed incomplete checkout: %ROOT%"
  )
)
exit /b 1

rem ── Print helpers ─────────────────────────────────────────────────
:PrintBanner
echo.
echo %CYAN%%BOLD%  codyx Installer v%CODY_VERSION%%NORMAL%
echo %CYAN%  %CREDITS%%NORMAL%
echo.
exit /b 0

:PrintSection
set "MSG=%~1"
echo.
echo %CYAN%%BOLD%[%SECTION%/9] %MSG%%NORMAL%
exit /b 0

:PrintOk
echo %GREEN%  OK%NORMAL% %~1
exit /b 0

:PrintWarn
echo %YELLOW%  WARN%NORMAL% %~1
exit /b 0

:PrintErr
echo %RED%  ERR%NORMAL% %~1
exit /b 0

:PrintInfo
echo %CYAN%  INFO%NORMAL% %~1
exit /b 0

rem ── EnsureCommand ─────────────────────────────────────────────────
:EnsureCommand
set "CMD_NAME=%~1"
set "WINGET_ID=%~2"
set "LABEL=%~3"

where "%CMD_NAME%" >nul 2>nul
if not errorlevel 1 (
  call :PrintOk "%LABEL% found."
  exit /b 0
)

call :PrintWarn "%LABEL% not found."

rem Try winget first
if "%HAS_WINGET%"=="1" (
  call :PrintInfo "Installing %LABEL% with winget..."
  winget install --id "%WINGET_ID%" --exact --source winget --accept-package-agreements --accept-source-agreements
  if not errorlevel 1 (
    set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
    where "%CMD_NAME%" >nul 2>nul
    if not errorlevel 1 (
      call :PrintOk "%LABEL% installed via winget."
      exit /b 0
    )
  )
  call :PrintWarn "winget install failed. Trying alternative..."
)

rem Try choco as fallback
where choco >nul 2>nul
if not errorlevel 1 (
  call :PrintInfo "Installing %LABEL% with Chocolatey..."
  choco install "%CMD_NAME%" -y --no-progress
  if not errorlevel 1 (
    call :PrintOk "%LABEL% installed via Chocolatey."
    exit /b 0
  )
  call :PrintWarn "Chocolatey install failed."
)

call :PrintErr "%LABEL% is required. Install it manually, restart terminal, and rerun."
exit /b 1

rem ── EnsureBun ─────────────────────────────────────────────────────
:EnsureBun
where bun >nul 2>nul
if not errorlevel 1 (
  call :PrintOk "Bun found."
  exit /b 0
)

if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  call :PrintOk "Bun found in %%USERPROFILE%%\.bun\bin."
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  exit /b 0
)

if exist "%APPDATA%\npm\bun.cmd" (
  call :PrintOk "Bun found in %%APPDATA%%\npm."
  set "PATH=%APPDATA%\npm;%PATH%"
  exit /b 0
)

call :PrintInfo "Installing Bun for the current user..."
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
if errorlevel 1 (
  call :PrintErr "Failed to install Bun."
  exit /b 1
)

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%PATH%"
where bun >nul 2>nul
if not errorlevel 1 (
  call :PrintOk "Bun installed."
  exit /b 0
)

if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  call :PrintOk "Bun installed."
  exit /b 0
)

call :PrintErr "Bun installation did not produce a usable bun command."
exit /b 1

rem ── UpdateCheckout ────────────────────────────────────────────────
:UpdateCheckout
if not exist "%ROOT%\.git" (
  call :PrintInfo "No .git directory. Skipping repository update."
  exit /b 0
)

git config --global --add safe.directory "%ROOT%" >nul 2>nul
for /f "delims=" %%A in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%A"
if defined CURRENT_BRANCH if /I not "!CURRENT_BRANCH!"=="%CODY_BRANCH%" (
  call :PrintInfo "Switching branch from !CURRENT_BRANCH! to %CODY_BRANCH%..."
  git fetch origin "%CODY_BRANCH%"
  if errorlevel 1 (
    call :PrintErr "Could not fetch branch %CODY_BRANCH%."
    popd
    exit /b 1
  )
  git switch "%CODY_BRANCH%"
  if errorlevel 1 (
    call :PrintErr "Could not switch to %CODY_BRANCH%. Commit or stash local changes."
    popd
    exit /b 1
  )
)
  call :PrintInfo "Updating checkout..."
  git pull --ff-only
  if errorlevel 1 (
    call :PrintWarn "git pull failed. Continuing with current checkout."
  )
  popd
  exit /b 0

:UpdateCheckoutEnd
