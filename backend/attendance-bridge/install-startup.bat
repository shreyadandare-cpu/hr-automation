@echo off
rem Run once. Makes the connector start by itself, hidden, every time this Windows user signs in, and starts it now. No admin rights needed.
rem Close any old connector window first, so two do not run at once.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\HR Attendance Connector.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments=('\"'+$p+'run-hidden.vbs\"'); $s.WorkingDirectory=$p; $s.Save()"
if errorlevel 1 (echo Could not create the startup shortcut. & pause & exit /b 1)
start "" wscript.exe "%~dp0run-hidden.vbs"
echo Done. The connector is running in the background and will start by itself when you sign in to Windows.
echo To see what it is doing, open bridge.log in this folder.
pause
