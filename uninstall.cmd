@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "RESULT=1"
set "TARGET=%LOCALAPPDATA%\NetflixRemote"
set "HOSTKEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.netflixlan.remote"
if not defined LOCALAPPDATA goto failed
echo Stop the remote and remove its extension from Chrome before uninstalling.
if exist "%TARGET%\netflix-remote.exe" del /q "%TARGET%\netflix-remote.exe"
if exist "%TARGET%\netflix-remote.exe" goto failed
set "REGISTERED="
for /f "tokens=2,*" %%A in ('reg query "%HOSTKEY%" /ve 2^>nul') do if "%%A"=="REG_SZ" set "REGISTERED=%%B"
if not defined REGISTERED goto files
if /i not "%REGISTERED%"=="%TARGET%\native-host.json" goto files
reg delete "%HOSTKEY%" /f >nul
if errorlevel 1 goto failed
:files
for %%F in (manifest.json background.js content.js netflix-adapter.js popup.html popup.css popup.js) do (
  if exist "%TARGET%\extension\%%F" del /q "%TARGET%\extension\%%F"
  if exist "%TARGET%\extension\%%F" goto failed
)
if exist "%TARGET%\native-host.json" del /q "%TARGET%\native-host.json"
if exist "%TARGET%\native-host.json" goto failed
if exist "%TARGET%\extension" rd "%TARGET%\extension" 2>nul
echo Removed known application files and this installation's registration.
echo Unrelated files and firewall rules are preserved.
echo You may delete the remaining NetflixRemote folder after closing this window.
set "RESULT=0"
goto finish
:failed
echo ERROR: Could not uninstall. Stop the remote and check permissions, then retry.
:finish
if /i not "%~1"=="/quiet" pause
exit /b %RESULT%
