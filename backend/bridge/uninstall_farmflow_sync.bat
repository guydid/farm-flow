@echo off
REM ── הסרת גשר הנוכחות מהמערכת ───────────────────────────────────────────────
REM מבטל הפעלה אוטומטית ומוחק את המשימה המתוזמנת. הקבצים נשארים בתיקייה.

echo מסיר את משימת הסנכרון המתוזמנת...
schtasks /Delete /TN "FarmFlow Attendance Sync" /F 2>nul
if %errorlevel%==0 (echo   המשימה הוסרה.) else (echo   לא נמצאה משימה מתוזמנת.)

echo מבטל הפעלה אוטומטית עם Windows...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v FarmFlowSyncBridge /f 2>nul
if %errorlevel%==0 (echo   ההפעלה האוטומטית בוטלה.) else (echo   לא הוגדרה הפעלה אוטומטית.)

echo.
echo הגשר הוסר מהמערכת. הקבצים נשארו ב-%~dp0
echo כדי להסיר לגמרי — מחק את הקבצים: farmflow_sync.py, farmflow_sync_ui.py, config.json, *.vbs, *.bat
pause
