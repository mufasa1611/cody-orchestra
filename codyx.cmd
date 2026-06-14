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
      start /b cloudflared access tcp --hostname proxy.kingkung.men --url localhost:%CODY_PROXY_LOCAL_PORT% >nul 2>nul
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
  if not defined CODY_CURRENT_BRANCH set "CODY_CURRENT_BRANCH=main"
  set "CODY_SHALLOW=false"
  for /f "delims=" %%S in ('git rev-parse --is-shallow-repository 2^>nul') do set "CODY_SHALLOW=%%S"
  if /I "!CODY_SHALLOW!"=="true" (
    echo %ESC%[94m[Codyx]%ESC%[0m Repairing update history...
    git fetch origin !CODY_CURRENT_BRANCH! --quiet --unshallow >nul 2>nul
  ) else (
    git fetch origin !CODY_CURRENT_BRANCH! --quiet >nul 2>nul
  )
  if errorlevel 1 (
    echo %ESC%[94m[Codyx]%ESC%[0m Network unavailable, skipping update check.
    set "CODY_FETCH_FAILED=1"
  )
  for /f "delims=" %%C in ('git rev-list --count HEAD..origin/!CODY_CURRENT_BRANCH! 2^>nul') do set "CODY_BEHIND=%%C"
  for /f "delims=" %%C in ('git rev-list --count origin/!CODY_CURRENT_BRANCH!..HEAD 2^>nul') do set "CODY_AHEAD=%%C"
  if not defined CODY_BEHIND set "CODY_BEHIND=0"
  if not defined CODY_AHEAD set "CODY_AHEAD=0"
  if /I not "!CODY_BEHIND!"=="0" (
    if /I not "!CODY_AHEAD!"=="0" (
      echo %ESC%[93m[Codyx]%ESC%[0m Update skipped: this checkout has !CODY_AHEAD! local commits and is !CODY_BEHIND! commits behind origin/!CODY_CURRENT_BRANCH!.
      echo %ESC%[93m[Codyx]%ESC%[0m Preserve or move the local commits to another branch before updating.
    ) else (
      if /I "!CODY_AUTO_UPDATE!"=="yes" (
        set "CODY_UPDATE_ANSWER=Y"
      ) else (
        set /p "CODY_UPDATE_ANSWER=[codyx] !CODY_BEHIND! update(s) available. Pull now? [y/N] "
      )
      if /I "!CODY_UPDATE_ANSWER!"=="Y" (
        git merge --ff-only origin/!CODY_CURRENT_BRANCH!
      )
    )
  ) else if not defined CODY_FETCH_FAILED echo %ESC%[94m[Codyx]%ESC%[0m Up to date.
  popd
)
set "CODY_SKIP_UPDATE_CHECK=1"

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
