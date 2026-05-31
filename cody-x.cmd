@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "BUN="

where bun >nul 2>nul
if %ERRORLEVEL%==0 set "BUN=bun"

if not defined BUN if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN if exist "%USERPROFILE%\AppData\Roaming\npm\bun.cmd" set "BUN=%USERPROFILE%\AppData\Roaming\npm\bun.cmd"

if not defined BUN (
  echo Bun was not found.
  echo Run install.bat from this checkout, or install Bun from https://bun.sh and retry.
  exit /b 1
)

if exist "%USERPROFILE%\.bun\bin" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
if exist "%USERPROFILE%\AppData\Roaming\npm" set "PATH=%USERPROFILE%\AppData\Roaming\npm;%PATH%"

rem ------------------------------------------------------------------
rem Unique identity ? isolated data directories
rem ------------------------------------------------------------------
if not defined XDG_DATA_HOME set "XDG_DATA_HOME=%LOCALAPPDATA%\cody-x"
if not defined XDG_CACHE_HOME set "XDG_CACHE_HOME=%LOCALAPPDATA%\cody-x\cache"
if not defined XDG_CONFIG_HOME set "XDG_CONFIG_HOME=%APPDATA%\cody-x"
if not defined XDG_STATE_HOME set "XDG_STATE_HOME=%LOCALAPPDATA%\cody-x\state"
if not defined CODY_DB set "CODY_DB=cody-x.db"
set "CODY_CONFIG_DIR=%ROOT%.cody\generated"
rem ------------------------------------------------------------------
rem Load proxy configuration from .env.proxy (Cloudflare TCP tunnel)
rem ------------------------------------------------------------------
if exist "%ROOT%.env.proxy" (
  for /f "usebackq eol=# delims=" %%A in ("%ROOT%.env.proxy") do (
    for /f "tokens=1,* delims==" %%B in ("%%A") do (
      if not defined %%B set "%%B=%%C"
    )
  )
)

rem --- Cloudflare TCP proxy tunnel setup ---
if "%CODY_PROXY_ENABLED%"=="1" (
  if not defined CODY_PROXY_LOCAL_PORT set "CODY_PROXY_LOCAL_PORT=9999"
  netstat -an | findstr ":%CODY_PROXY_LOCAL_PORT%" >nul 2>nul
  if errorlevel 1 (
    where cloudflared >nul 2>nul
    if not errorlevel 1 (
      echo [cody-x] Starting Cloudflare proxy tunnel...
      start /b cloudflared access tcp --hostname proxy.kingkung.men --url localhost:%CODY_PROXY_LOCAL_PORT% >nul 2>nul
      for /L %%i in (1,1,20) do (
        netstat -an | findstr ":%CODY_PROXY_LOCAL_PORT%" >nul 2>nul
        if not errorlevel 1 goto proxy_ready
        timeout /t 1 /nobreak >nul 2>nul
      )
      echo [warn] Cloudflare proxy tunnel did not start. Proxy may not work.
    )
  )
)
:proxy_ready

rem Update check with confirmation. Set CODY_SKIP_UPDATE_CHECK=1 to disable.
if exist "%ROOT%\.git" if not "%CODY_SKIP_UPDATE_CHECK%"=="1" (
  git config --global --add safe.directory "%ROOT%" >nul 2>nul
  echo [cody-x] Checking for updates...
  pushd "%ROOT%"
  for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CODY_CURRENT_BRANCH=%%B"
  if not defined CODY_CURRENT_BRANCH set "CODY_CURRENT_BRANCH=master"
  git fetch origin !CODY_CURRENT_BRANCH! --quiet --depth 1 >nul 2>nul
  if errorlevel 1 (
    echo [cody-x] Network unavailable, skipping update check.
    set "CODY_FETCH_FAILED=1"
  )
  for /f "delims=" %%C in ('git rev-list --count HEAD..origin/!CODY_CURRENT_BRANCH! 2^>nul') do set "CODY_BEHIND=%%C"
  if not defined CODY_BEHIND set "CODY_BEHIND=0"
  if /I not "!CODY_BEHIND!"=="0" (
    if /I "!CODY_AUTO_UPDATE!"=="yes" (
      set "CODY_UPDATE_ANSWER=Y"
    ) else (
      set /p "CODY_UPDATE_ANSWER=[cody-x] !CODY_BEHIND! update(s) available on origin/!CODY_CURRENT_BRANCH!. Pull now? [y/N] "
    )
    if /I "!CODY_UPDATE_ANSWER!"=="Y" (
      git pull --ff-only
      set "CODY_PULLED=!CODY_BEHIND!"
    )
    if /I not "!CODY_UPDATE_ANSWER!"=="Y" echo [cody-x] Update skipped.
  ) else if not defined CODY_FETCH_FAILED echo [cody-x] Up to date.
  popd
)

set "CODY_DISCOVER_MODELS=1"
for %%A in (%*) do (
  if /I "%%~A"=="--help" set "CODY_DISCOVER_MODELS=0"
  if /I "%%~A"=="-h" set "CODY_DISCOVER_MODELS=0"
  if /I "%%~A"=="help" set "CODY_DISCOVER_MODELS=0"
  if /I "%%~A"=="--version" set "CODY_DISCOVER_MODELS=0"
  if /I "%%~A"=="-v" set "CODY_DISCOVER_MODELS=0"
  if /I "%%~A"=="version" set "CODY_DISCOVER_MODELS=0"
)

set "CODY_GENERATED_CONFIG=%ROOT%.cody\generated\cody.jsonc"

rem Auto-fix: strip UTF-8 BOM and repair empty keys in generated config
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\fix-generated-config.ps1"

set "CODY_SHOULD_DISCOVER_MODELS=0"
if not "%CODY_SKIP_MODEL_DISCOVERY%"=="1" if "%CODY_DISCOVER_MODELS%"=="1" (
  if "%CODY_REFRESH_MODELS%"=="1" set "CODY_SHOULD_DISCOVER_MODELS=1"
  if not exist "%CODY_GENERATED_CONFIG%" set "CODY_SHOULD_DISCOVER_MODELS=1"
)

if "%CODY_SHOULD_DISCOVER_MODELS%"=="1" (
  echo [cody-x] Scanning for local Ollama and GGUF models...
  echo [cody-x] This runs once so subsequent launches are faster.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\discover-local-models.ps1" -Root "%ROOT:~0,-1%"
  echo [cody-x] Model scanning complete.
)

if not defined CODY_CONFIG_DIR (
  set "CODY_CONFIG_DIR=%ROOT%.cody\generated"
)

rem If arguments provided, run CLI directly (no menu)
rem Check if "web" is among args and skip --port so it gets a random OS-assigned port
setlocal enabledelayedexpansion
set "HAS_WEB=0"
for %%A in (%*) do if /I "%%A"=="web" set "HAS_WEB=1"
if "!HAS_WEB!"=="1" (
  call "%BUN%" run --cwd "%ROOT%packages\cody" --conditions=browser src\index.ts %*
  exit /b %ERRORLEVEL%
)
if not "%*"=="" (
  call "%BUN%" run --cwd "%ROOT%packages\cody" --conditions=browser src\index.ts %*
  exit /b %ERRORLEVEL%
)
endlocal

rem Print banner before the interactive launcher menu
call "%BUN%" run --cwd "%ROOT%packages\cody" --conditions=browser src\index.ts --print-banner-only

rem Arrow-key launcher menu (exit code = choice, Write-Host goes direct to console)
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\launcher.ps1" -Root "%ROOT%"
set "CODY_CHOICE=%ERRORLEVEL%"

rem 255 = Escape pressed, exit silently
if "%CODY_CHOICE%"=="255" exit /b 0

if defined CODY_PULLED if not "!CODY_PULLED!"=="0" echo [cody-x] Pulled !CODY_PULLED! update(s).

if "%CODY_CHOICE%"=="1" (
  echo [cody-x] Building web UI...
  call "%BUN%" run --cwd "%ROOT%packages\app" build
  if errorlevel 1 (
    echo [cody-x] Web UI build failed. Check the error above.
    exit /b %ERRORLEVEL%
  )
  echo [cody-x] Starting web UI...
  pushd "%ROOT%"
  call "%BUN%" run cody-x web
  popd
) else (
  rem Banner already printed above before launcher, skip duplicate
  call "%BUN%" run --cwd "%ROOT%packages\cody" --conditions=browser src\index.ts --no-banner
)
exit /b %ERRORLEVEL%
