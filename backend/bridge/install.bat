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
