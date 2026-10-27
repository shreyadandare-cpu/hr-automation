@echo off
rem Makes the connector start by itself when this Windows user signs in. Run once. To remove: schtasks /delete /tn "HR Attendance Connector" /f
cd /d "%~dp0"
schtasks /create /tn "HR Attendance Connector" /tr "\"%~dp0run.bat\"" /sc onlogon /rl limited /f
if errorlevel 1 (echo Could not create the startup task. Try right-click, Run as administrator.) else (echo Done. The connector will start when you sign in to Windows.)
pause
