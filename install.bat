@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "REPO_URL=https://github.com/mufasa1611/cody-x.git"
if not defined CODY_BRANCH set "CODY_BRANCH=main"
if not defined CODY_NO_SCAN set "CODY_NO_SCAN=0"
if not defined CODY_NO_PROXY set "CODY_NO_PROXY=0"
if not defined CODY_NO_BUILD set "CODY_NO_BUILD=0"
if not defined CODY_YES set "CODY_YES=0"
set "INSTALLER_URL=https://raw.githubusercontent.com/mufasa1611/cody-x/%CODY_BRANCH%/install.bat"
set "DEFAULT_PARENT=%LOCALAPPDATA%\cody-x"
set "DEFAULT_ROOT=%DEFAULT_PARENT%"
set "GLOBAL_BIN=%APPDATA%\npm"
set "GLOBAL_CMD=%GLOBAL_BIN%\cody-x.cmd"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if defined CODY_INSTALL_ROOT set "ROOT=%CODY_INSTALL_ROOT%"
if not exist "%ROOT%\package.json" set "ROOT=%DEFAULT_ROOT%"

echo cody-x Windows installer
echo Repo: "%ROOT%"
echo.

if "%CODY_INSTALLER_SELF_UPDATED%"=="1" goto AfterSelfUpdate

where powershell >nul 2>nul
if errorlevel 1 (
  echo [warn] PowerShell not found. Skipping installer self-update check.
  goto AfterSelfUpdate
)

set "LATEST_INSTALLER=%TEMP%\cody-x-install-latest-%RANDOM%%RANDOM%.bat"
if "%CODY_INSTALLER_SELF_UPDATE%"=="0" goto AfterSelfUpdate
echo Checking for installer updates...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%INSTALLER_URL%' -OutFile '%LATEST_INSTALLER%'; exit 0 } catch { Write-Host ('[warn] Could not download latest installer: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  del "%LATEST_INSTALLER%" >nul 2>nul
  echo [warn] Continuing with the current installer.
  goto AfterSelfUpdate
)

fc /b "%~f0" "%LATEST_INSTALLER%" >nul 2>nul
if not errorlevel 1 (
  del "%LATEST_INSTALLER%" >nul 2>nul
  echo [ok] Installer is up to date.
  goto AfterSelfUpdate
)

echo [info] New installer found. Running latest installer from GitHub...
set "CODY_INSTALLER_SELF_UPDATED=1"
set "CODY_INSTALL_ROOT=%ROOT%"
call "%LATEST_INSTALLER%" %*
set "LATEST_INSTALLER_EXIT=!ERRORLEVEL!"
del "%LATEST_INSTALLER%" >nul 2>nul
exit /b %LATEST_INSTALLER_EXIT%

:AfterSelfUpdate

where winget >nul 2>nul
if not errorlevel 1 (
  set "HAS_WINGET=1"
) else (
  set "HAS_WINGET=0"
)

call :EnsureCommand git "Git.Git" "Git"
if errorlevel 1 exit /b 1

set "HAS_CHECKOUT=0"
if exist "%ROOT%\package.json" if exist "%ROOT%\cody-x.cmd" set "HAS_CHECKOUT=1"

if "%HAS_CHECKOUT%"=="1" (
  echo [ok] cody-x checkout found.
) else (
  echo cody-x checkout not found. Cloning from GitHub...
  if exist "%DEFAULT_ROOT%" (
    echo [error] "%DEFAULT_ROOT%" exists but is not a cody-x checkout.
    echo Move it away or set up cody-x there, then rerun install.bat.
    exit /b 1
  )
  if not exist "%DEFAULT_PARENT%" mkdir "%DEFAULT_PARENT%" >nul 2>nul
  set "CLONE_RETRY=1"
  set "CLONE_BACKOFF=1"
  :RetryClone
  git clone --branch "%CODY_BRANCH%" "%REPO_URL%" "%DEFAULT_ROOT%"
  if not errorlevel 1 goto CloneOk
  if !CLONE_RETRY! geq 3 (
    echo [error] Failed to clone cody-x from "%REPO_URL%" after 3 attempts.
    exit /b 1
  )
  echo [warn] Clone failed (attempt !CLONE_RETRY!/3). Retrying in !CLONE_BACKOFF!s...
  ping -n !CLONE_BACKOFF! 127.0.0.1 >nul 2>nul
  set /a "CLONE_BACKOFF*=2"
  if !CLONE_BACKOFF! gtr 16 set "CLONE_BACKOFF=16"
  set /a "CLONE_RETRY+=1"
  goto RetryClone
  :CloneOk
  set "ROOT=%DEFAULT_ROOT%"
  echo [ok] cody-x cloned to "%ROOT%".
  echo [ok] Checking Git safe directory configuration...
  git config --global --add safe.directory "%ROOT%" >nul 2>nul
)

call :UpdateCheckout

call :EnsureBun
if errorlevel 1 exit /b 1

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%PATH%"

where bun >nul 2>nul
if errorlevel 1 (
  echo [error] Bun is still not available on PATH.
  echo Close and reopen the terminal, then rerun install.bat.
  exit /b 1
)

echo.
echo Installing cody-x dependencies...
pushd "%ROOT%"
set "BUN_RETRY=1"
set "BUN_BACKOFF=1"
:RetryBunInstall
call bun install
if not errorlevel 1 goto BunInstallOk
if !BUN_RETRY! geq 3 (
  echo.
  echo [error] bun install failed after 3 attempts.
  echo   This project has many dependencies and may need more memory.
  echo   Try increasing the Windows page file size, then rerun install.bat.
  popd
  set "CODY_FATAL_EXIT=!BUN_RETRY!"
  goto FatalExit
)
echo [warn] bun install failed (attempt !BUN_RETRY!/3). Retrying in !BUN_BACKOFF!s...
ping -n !BUN_BACKOFF! 127.0.0.1 >nul 2>nul
set /a "BUN_BACKOFF*=2"
if !BUN_BACKOFF! gtr 16 set "BUN_BACKOFF=16"
set /a "BUN_RETRY+=1"
goto RetryBunInstall
:BunInstallOk
echo [ok] Dependencies installed.

if "%CODY_NO_BUILD%"=="1" (
  echo [info] Web UI build skipped (CODY_NO_BUILD=1).
) else (
  echo.
  echo Building Web UI...
  pushd "%ROOT%\packages\app"
  call bun run build
  if errorlevel 1 (
    popd
    echo [warn] Web UI build failed, server will proxy to app.cody.ai.
    goto AfterWebBuild
  )
  popd
)
:AfterWebBuild

echo.
echo Creating .env.proxy with proxy settings...
if not exist "%ROOT%\.env.proxy" (
  >"%ROOT%\.env.proxy" echo CODY_PROXY_ENABLED=1
  >>"%ROOT%\.env.proxy" echo HTTPS_PROXY=http://localhost:9999
  >>"%ROOT%\.env.proxy" echo HTTP_PROXY=http://localhost:9999
  >>"%ROOT%\.env.proxy" echo NO_PROXY=localhost,127.0.0.1,::1
  echo [ok] .env.proxy created with proxy settings.
) else (
  findstr /B /C:"NO_PROXY=" "%ROOT%\.env.proxy" >nul 2>nul
  if errorlevel 1 (
    >>"%ROOT%\.env.proxy" echo NO_PROXY=localhost,127.0.0.1,::1
    echo [ok] Added NO_PROXY to existing .env.proxy.
  ) else (
    echo [ok] .env.proxy already has NO_PROXY.
  )
)

if "%CODY_NO_PROXY%"=="1" (
  echo [info] Proxy setup skipped (CODY_NO_PROXY=1).
  goto AfterProxy
)

echo.
echo Checking cloudflared for proxy tunnel...
where cloudflared >nul 2>nul
if not errorlevel 1 (
  echo [ok] cloudflared found.
) else if "%HAS_WINGET%"=="1" (
  echo [missing] cloudflared not found. Installing with winget...
  winget install --id Cloudflare.cloudflared --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [warn] cloudflared install failed. Proxy tunnel won't auto-start.
    echo Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/
  ) else (
    echo [ok] cloudflared installed.
  )
) else (
  echo [warn] cloudflared not found and winget not available.
  echo Install cloudflared from: https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/
)
:AfterProxy

echo.
echo ---
if "%CODY_NO_SCAN%"=="1" (
  echo [info] Model scan skipped (CODY_NO_SCAN=1).
  goto AfterModelScan
)
echo cody-x can scan your system for local Ollama models and GGUF files
echo to auto-configure them as AI providers.
set /p "SCAN_ANSWER=Scan for local models now? [y/N] "
if /I "!SCAN_ANSWER!"=="y" (
  if exist "%ROOT%\script\discover-local-models.ps1" (
    echo.
    echo Scanning for local models...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\discover-local-models.ps1" -Root "%ROOT%" -MaxSeconds 30
  ) else (
    echo [warn] Model discovery script not found. Skipping.
  )
) else (
  echo [info] Model scan skipped. Run later with:
  echo   powershell -File "%ROOT%\script\discover-local-models.ps1"
)
:AfterModelScan
if not exist "%ROOT%\.cody\generated" mkdir "%ROOT%\.cody\generated" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\ensure-default-config.ps1" -Root "%ROOT%"

echo.
echo.
echo Installing global cody-x command...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\script\install-cody-x-global.ps1"
if errorlevel 1 (
  set "CODY_FATAL_EXIT=!ERRORLEVEL!"
  popd
  goto FatalExit
)

echo.
echo Verifying cody-x command...
if not exist "%GLOBAL_CMD%" (
  echo [error] Global cody-x command shim was not created.
  echo Expected command shim:
  echo   "%GLOBAL_CMD%"
  popd
  exit /b 1
)

echo Verifying cody-x can start...
pushd "%ROOT%\packages\cody"
for /f "delims=" %%V in ('bun run --conditions=browser src\index.ts --version 2^>nul') do set "CODY_VERSION=%%V"
popd
if not defined CODY_VERSION (
  echo [error] cody-x failed to start. Check the error above.
  exit /b 1
)
echo [ok] cody-x version: !CODY_VERSION!

popd

echo.
echo Creating uninstall shortcut...
set "START_MENU_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\cody-x"
if not exist "%START_MENU_DIR%" mkdir "%START_MENU_DIR%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%START_MENU_DIR%\Uninstall cody-x.lnk'); $shortcut.TargetPath = 'cmd.exe'; $shortcut.Arguments = '/c \"\"%GLOBAL_CMD%\"\" uninstall'; $shortcut.Description = 'Uninstall cody-x'; $shortcut.WorkingDirectory = '%ROOT%'; $shortcut.Save()" >nul 2>nul
if errorlevel 1 (
  echo [warn] Could not create uninstall shortcut.
) else (
  echo [ok] Uninstall shortcut created.
)

echo.
echo ========================================
echo   cody-x installed successfully!
echo ========================================
echo.
echo   Installed to: %ROOT%
echo   Global command: cody-x
if exist "%ROOT%\.env.proxy" echo   Proxy: enabled (Cloudflare tunnel)
echo.
echo   Next steps:
echo     cody-x           Launch interactive menu (TUI)
echo     cody-x web       Start web UI in browser
echo     cody-x --help    See all commands
echo.
echo   Open a NEW terminal window for the global 'cody-x' command to be available.
echo ========================================
set "FINAL_PATH=%GLOBAL_BIN%;%USERPROFILE%\.bun\bin;%PATH%"
endlocal & set "PATH=%FINAL_PATH%"
exit /b 0

:FatalExit
exit /b !CODY_FATAL_EXIT!

:EnsureCommand
set "CMD_NAME=%~1"
set "WINGET_ID=%~2"
set "LABEL=%~3"

where "%CMD_NAME%" >nul 2>nul
if not errorlevel 1 (
  echo [ok] %LABEL% found.
  exit /b 0
)

echo [missing] %LABEL% not found.
if "%HAS_WINGET%"=="1" (
  echo Installing %LABEL% with winget...
  winget install --id "%WINGET_ID%" --exact --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo [error] Failed to install %LABEL% with winget.
    exit /b 1
  )
  set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
  where "%CMD_NAME%" >nul 2>nul
  if not errorlevel 1 (
    echo [ok] %LABEL% installed.
    exit /b 0
  )
)

echo [error] %LABEL% is required.
echo Install it manually, reopen the terminal, and rerun install.bat.
exit /b 1

:EnsureBun
where bun >nul 2>nul
if not errorlevel 1 (
  echo [ok] Bun found.
  exit /b 0
)

if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  echo [ok] Bun found in "%USERPROFILE%\.bun\bin".
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  exit /b 0
)

if exist "%APPDATA%\npm\bun.cmd" (
  echo [ok] Bun found in "%APPDATA%\npm".
  set "PATH=%APPDATA%\npm;%PATH%"
  exit /b 0
)

echo [missing] Bun not found.
echo Installing Bun for the current user...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
if errorlevel 1 (
  echo [error] Failed to install Bun.
  exit /b 1
)

set "PATH=%USERPROFILE%\.bun\bin;%APPDATA%\npm;%PATH%"
where bun >nul 2>nul
if not errorlevel 1 (
  echo [ok] Bun installed.
  exit /b 0
)

if exist "%USERPROFILE%\.bun\bin\bun.exe" (
  echo [ok] Bun installed.
  exit /b 0
)

echo [error] Bun installation did not produce a usable bun command.
exit /b 1

:UpdateCheckout
if not exist "%ROOT%\.git" (
  echo [info] No .git directory found. Skipping repository update.
  exit /b 0
)

pushd "%ROOT%"

rem Avoid Git dubious ownership error when clone runs under a different user context
git config --global --add safe.directory "%ROOT%" >nul 2>nul
for /f "delims=" %%A in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%A"
if defined CURRENT_BRANCH if /I not "!CURRENT_BRANCH!"=="%CODY_BRANCH%" (
  echo Switching cody-x checkout from !CURRENT_BRANCH! to %CODY_BRANCH%...
  git fetch origin "%CODY_BRANCH%"
  if errorlevel 1 (
    echo [error] Could not fetch branch "%CODY_BRANCH%" from origin.
    popd
    exit /b 1
  ) else (
    git switch "%CODY_BRANCH%"
    if errorlevel 1 (
      echo [error] Could not switch to "%CODY_BRANCH%".
      echo Back up or commit local changes in "%ROOT%", then rerun install.bat.
      popd
      exit /b 1
    )
  )
)
echo Updating cody-x checkout...
git pull --ff-only
if errorlevel 1 (
  echo [warn] git pull --ff-only failed. Continuing with the current checkout.
)
popd
exit /b 0
