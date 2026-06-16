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
  exit /b 1
)

if exist "%USERPROFILE%\.bun\bin" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
if exist "%USERPROFILE%\AppData\Roaming\npm" set "PATH=%USERPROFILE%\AppData\Roaming\npm;%PATH%"

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"

rem ------------------------------------------------------------------
rem Data Migration: Move cody-x -> codyx if needed
rem ------------------------------------------------------------------
if exist "%LOCALAPPDATA%\cody-x" if not exist "%LOCALAPPDATA%\codyx" (
  echo %ESC%[94m[Codyx]%ESC%[0m Migrating data directory from cody-x to codyx...
  move "%LOCALAPPDATA%\cody-x" "%LOCALAPPDATA%\codyx" >nul 2>nul
)
if exist "%APPDATA%\cody-x" if not exist "%APPDATA%\codyx" (
  echo %ESC%[94m[Codyx]%ESC%[0m Migrating config directory from cody-x to codyx...
  move "%APPDATA%\cody-x" "%APPDATA%\codyx" >nul 2>nul
)
if exist "%LOCALAPPDATA%\codyx\cody-x.db" if not exist "%LOCALAPPDATA%\codyx\codyx.db" (
  move "%LOCALAPPDATA%\codyx\cody-x.db" "%LOCALAPPDATA%\codyx\codyx.db" >nul 2>nul
)

rem ------------------------------------------------------------------
rem Unique identity & isolated data directories
rem ------------------------------------------------------------------
if not defined XDG_DATA_HOME set "XDG_DATA_HOME=%LOCALAPPDATA%\codyx"
if not defined XDG_CACHE_HOME set "XDG_CACHE_HOME=%LOCALAPPDATA%\codyx\cache"
if not defined XDG_CONFIG_HOME set "XDG_CONFIG_HOME=%APPDATA%\codyx"
if not defined XDG_STATE_HOME set "XDG_STATE_HOME=%LOCALAPPDATA%\codyx\state"
if not defined CODY_DB set "CODY_DB=codyx.db"
set "CODY_CONFIG_DIR=%ROOT%.cody\generated"

rem ------------------------------------------------------------------
rem Load proxy configuration
rem ------------------------------------------------------------------
set "CODY_ORIGINAL_HTTP_PROXY=!HTTP_PROXY!"
set "CODY_ORIGINAL_HTTPS_PROXY=!HTTPS_PROXY!"
set "CODY_ORIGINAL_NO_PROXY=!NO_PROXY!"
if exist "%ROOT%.env.proxy" (
  for /f "usebackq eol=# delims=" %%A in ("%ROOT%.env.proxy") do (
    for /f "tokens=1,* delims==" %%B in ("%%A") do (
      if not defined %%B set "%%B=%%C"
    )
  )
)

rem A disabled Cody proxy must not override the user's normal network path.
if not "%CODY_PROXY_ENABLED%"=="1" (
  set "HTTP_PROXY=!CODY_ORIGINAL_HTTP_PROXY!"
  set "HTTPS_PROXY=!CODY_ORIGINAL_HTTPS_PROXY!"
  set "NO_PROXY=!CODY_ORIGINAL_NO_PROXY!"
)

if "%CODY_PROXY_ENABLED%"=="1" (
  if not defined CODY_PROXY_LOCAL_PORT set "CODY_PROXY_LOCAL_PORT=9999"
  netstat -an | findstr ":%CODY_PROXY_LOCAL_PORT%" >nul 2>nul
  if errorlevel 1 (
    where cloudflared >nul 2>nul
    if not errorlevel 1 (
      echo %ESC%[94m[Codyx]%ESC%[0m Starting Cloudflare proxy tunnel...
      if not defined CODY_TUNNEL_HOSTNAME set "CODY_TUNNEL_HOSTNAME=proxy.kingkung.men"
      start /b cloudflared access tcp --hostname %CODY_TUNNEL_HOSTNAME% --url localhost:%CODY_PROXY_LOCAL_PORT% >nul 2>nul
      for /L %%i in (1,1,20) do (
        netstat -an | findstr ":%CODY_PROXY_LOCAL_PORT%" >nul 2>nul
        if not errorlevel 1 goto proxy_ready
        timeout /t 1 /nobreak >nul 2>nul
      )
    )
  )
)
:proxy_ready

if exist "%ROOT%\.git" if not "%CODY_SKIP_UPDATE_CHECK%"=="1" (
  echo %ESC%[94m[Codyx]%ESC%[0m Checking for updates...
  pushd "%ROOT%"
  for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "CODY_CURRENT_BRANCH=%%B"
  if not defined CODY_CURRENT_BRANCH set "CODY_CURRENT_BRANCH=HEAD"
  if /I "!CODY_CURRENT_BRANCH!"=="HEAD" (
    echo %ESC%[94m[Codyx]%ESC%[0m Detached checkout detected, skipping update check.
  ) else (
    git fetch origin !CODY_CURRENT_BRANCH! --quiet --depth 1 >nul 2>nul
    if errorlevel 1 (
      echo %ESC%[94m[Codyx]%ESC%[0m Network unavailable, skipping update check.
      set "CODY_FETCH_FAILED=1"
    )
    for /f "tokens=1,2" %%C in ('git rev-list --left-right --count HEAD...origin/!CODY_CURRENT_BRANCH! 2^>nul') do (
      set "CODY_AHEAD=%%C"
      set "CODY_BEHIND=%%D"
    )
    if not defined CODY_AHEAD set "CODY_AHEAD=0"
    if not defined CODY_BEHIND set "CODY_BEHIND=0"
    set "CODY_TRACKED_DIRTY=0"
    for /f %%E in ('git status --porcelain --untracked-files=no 2^>nul ^| find /c /v ""') do set "CODY_TRACKED_DIRTY=%%E"
    if not defined CODY_TRACKED_DIRTY set "CODY_TRACKED_DIRTY=0"
    set "CODY_NEEDS_REPAIR=0"
    set "CODY_REPAIR_REASON="
    if not "!CODY_AHEAD!"=="0" (
      set "CODY_NEEDS_REPAIR=1"
      set "CODY_REPAIR_REASON=local commits"
      echo %ESC%[94m[Codyx]%ESC%[0m Install checkout has local commits.
    ) else if not "!CODY_TRACKED_DIRTY!"=="0" (
      set "CODY_NEEDS_REPAIR=1"
      set "CODY_REPAIR_REASON=tracked changes"
      echo %ESC%[94m[Codyx]%ESC%[0m Install checkout has local tracked changes.
    )
    if "!CODY_NEEDS_REPAIR!"=="1" (
      powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\update-progress.ps1" -Action "repair" -Branch "!CODY_CURRENT_BRANCH!"
    ) else if /I not "!CODY_BEHIND!"=="0" (
      powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\update-progress.ps1" -Action "pull"
    ) else if not defined CODY_FETCH_FAILED (
      echo %ESC%[94m[Codyx]%ESC%[0m Up to date.
    )
  )
  popd
)

rem -- npm update check (for npm-installed users without .git) ----------
if not exist "%ROOT%\.git" if not "%CODY_SKIP_UPDATE_CHECK%"=="1" (
  where npm >nul 2>nul
  if not errorlevel 1 (
    for /f "delims=" %%L in ('npm view codyx-ai version 2^>nul') do set "CODY_NPM_LATEST=%%L"
    for /f "delims=" %%C in ('codyx --version 2^>nul') do set "CODY_NPM_CURRENT=%%C"
    if defined CODY_NPM_LATEST if defined CODY_NPM_CURRENT (
      if /I not "!CODY_NPM_CURRENT!"=="!CODY_NPM_LATEST!" (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\update-progress.ps1" -Action "npm"
      ) else (
        echo %ESC%[94m[Codyx]%ESC%[0m Up to date ^(!CODY_NPM_CURRENT!^).
      )
    )
  )
)

if not "%*"=="" (
  call "%BUN%" run --cwd "%ROOT%packages\codyx" --conditions=browser src\index.ts %*
  exit /b %ERRORLEVEL%
)

call "%BUN%" run --cwd "%ROOT%packages\codyx" --conditions=browser src\index.ts --print-banner-only
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%script\launcher.ps1" -Root "%ROOT%"
set "CODY_CHOICE=%ERRORLEVEL%"
if "%CODY_CHOICE%"=="255" exit /b 0

if "%CODY_CHOICE%"=="1" (
  echo %ESC%[94m[Codyx]%ESC%[0m Building and starting web UI...
  call "%BUN%" run --cwd "%ROOT%packages\app" build
  pushd "%ROOT%"
  call "%BUN%" run codyx web
  popd
) else (
  call "%BUN%" run --cwd "%ROOT%packages\codyx" --conditions=browser src\index.ts --no-banner
)
exit /b %ERRORLEVEL%
