@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "RESULT=1"
set "TARGET=%LOCALAPPDATA%\NetflixRemote"
set "HOSTKEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\com.netflixlan.remote"
if not defined LOCALAPPDATA goto failed
if not exist "%~dp0dist\netflix-remote.exe" goto missing
if not exist "%~dp0native-host.json" goto missing
if not exist "%~dp0uninstall.cmd" goto missing
for %%F in (manifest.json background.js content.js netflix-adapter.js popup.html popup.css popup.js) do if not exist "%~dp0extension\%%F" goto missing
echo Close the remote using the extension's Stop button before installing.
if not exist "%TARGET%\extension" mkdir "%TARGET%\extension"
if errorlevel 1 goto failed
copy /y "%~dp0dist\netflix-remote.exe" "%TARGET%\netflix-remote.exe" >nul
if errorlevel 1 goto failed
copy /y "%~dp0native-host.json" "%TARGET%\native-host.json" >nul
if errorlevel 1 goto failed
for %%F in (manifest.json background.js content.js netflix-adapter.js popup.html popup.css popup.js) do (
  copy /y "%~dp0extension\%%F" "%TARGET%\extension\%%F" >nul
  if errorlevel 1 goto failed
)
copy /y "%~dp0uninstall.cmd" "%TARGET%\uninstall.cmd" >nul
if errorlevel 1 goto failed
reg add "%HOSTKEY%" /ve /t REG_SZ /d "%TARGET%\native-host.json" /f >nul
if errorlevel 1 goto failed
echo.
echo Installed successfully. No extension ID entry is needed.
echo In chrome://extensions, enable Developer mode and Load unpacked:
echo "%TARGET%\extension"
echo For updates, reload the installed extension and refresh Netflix.
echo When migrating from v0.2.0, remove the old extension first.
set "RESULT=0"
goto finish
:missing
echo ERROR: Extract the complete release ZIP before running install.cmd.
goto finish
:failed
echo ERROR: Installation failed. Stop the remote and retry.
echo Check write permissions and Windows security messages. No security settings were changed.
:finish
if /i not "%~1"=="/quiet" pause
exit /b %RESULT%
