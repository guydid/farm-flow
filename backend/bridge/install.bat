@echo off
REM ============================================================
REM  FarmFlow time-clock bridge - installer
REM  Installs Python packages, a scheduled sync task (every 30 min),
REM  and the tray UI at Windows logon. Safe to run again.
REM ============================================================
setlocal
cd /d "%~dp0"
echo.
echo === FarmFlow clock bridge installer ===
echo Folder: %CD%
echo.

REM --- Running from inside the ZIP? Explorer unpacks it to %TEMP% and deletes it later,
REM --- which leaves the scheduled task pointing at a missing run_sync_hidden.vbs.
REM --- Copy everything to a permanent folder and continue the install from there.
if not exist "%~dp0farmflow_sync.py" goto :not_extracted
if /I "%~1"=="--copied" goto :folder_ok
set "ISTEMP="
setlocal EnableDelayedExpansion
set "HERE=%CD%\"
if /I not "!HERE:%TEMP%\=!"=="!HERE!" set "ISTEMP=1"
if /I not "!HERE:\AppData\Local\Temp\=!"=="!HERE!" set "ISTEMP=1"
endlocal & set "ISTEMP=%ISTEMP%"
if not defined ISTEMP goto :folder_ok
set "TARGET=%SystemDrive%\FarmFlowSync"
mkdir "%TARGET%" >nul 2>nul
if not exist "%TARGET%\" set "TARGET=%LOCALAPPDATA%\FarmFlowSync"
mkdir "%TARGET%" >nul 2>nul
echo This installer is running from a temporary folder (inside the ZIP).
echo Copying the bridge to a permanent folder: %TARGET%
for %%f in ("%~dp0*.py" "%~dp0*.vbs" "%~dp0*.bat" "%~dp0*.txt") do copy /Y "%%~f" "%TARGET%\" >nul
REM keep an existing config.json (clock IP / WRK folder you already set)
if not exist "%TARGET%\config.json" copy /Y "%~dp0config.json" "%TARGET%\" >nul
if not exist "%TARGET%\install.bat" (
  echo [ERROR] Copy failed. Extract the ZIP to C:\FarmFlowSync manually and run install.bat from there.
  pause
  exit /b 1
)
echo.
call "%TARGET%\install.bat" --copied
exit /b %errorlevel%

:not_extracted
echo [ERROR] The bridge files were not found next to install.bat.
echo         Extract the ZIP first ^(right click - Extract All^) to C:\FarmFlowSync,
echo         then run install.bat from that folder.
pause
exit /b 1

:folder_ok

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python was not found. Install Python 3.10+ from https://www.python.org/downloads/
  echo         and tick "Add python.exe to PATH" during setup, then run this file again.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo Found %%v

echo.
echo [1/4] Installing Python packages (pyzk requests pystray pillow)...
python -m pip install --quiet --disable-pip-version-check pyzk requests pystray pillow
if errorlevel 1 (
  echo [ERROR] pip install failed. Check the internet connection and run again.
  pause
  exit /b 1
)

echo [2/4] Testing the connection to the clock and to FarmFlow (dry run)...
python farmflow_sync.py --dry-run
if errorlevel 1 (
  echo [WARN] Dry run reported a problem. Open the UI to fix the clock IP / WRK folder in config.json.
)

echo [3/4] Creating the scheduled task "FarmFlow Attendance Sync" (every 30 minutes)...
schtasks /Delete /TN "FarmFlow Attendance Sync" /F >nul 2>nul
schtasks /Create /TN "FarmFlow Attendance Sync" /SC MINUTE /MO 30 /TR "\"%CD%\run_sync_hidden.vbs\"" /F >nul
if errorlevel 1 (
  echo [WARN] Could not create the scheduled task. Run this installer as Administrator, or enable "auto sync" inside the UI instead.
) else (
  echo       Task created.
)

echo [4/4] Starting the tray UI with Windows...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v FarmFlowSyncBridge /t REG_SZ /d "wscript.exe \"%CD%\run_farmflow_ui.vbs\"" /f >nul
start "" wscript.exe "%CD%\run_farmflow_ui.vbs"

echo.
echo Done. The bridge syncs attendance every 30 minutes.
echo To remove it later run uninstall_farmflow_sync.bat
pause
