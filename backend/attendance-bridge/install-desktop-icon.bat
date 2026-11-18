@echo off
rem Run once on the admin computer. Puts a "Wohlig Attendance Sync" icon on the desktop (the Wohlig smile). Double-click it to start the
rem connector and the log viewer and open them as one app window. It can sit beside the Keka Sync Tool icon; they do not clash.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%~dp0'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Wohlig Attendance Sync.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments=('\"'+$p+'wohlig-attendance-sync.vbs\"'); $s.WorkingDirectory=$p; $s.IconLocation=($p+'wohlig-attendance.ico'); $s.Description='Wohlig Attendance Sync'; $s.Save()"
if errorlevel 1 (echo Could not create the icon. & pause & exit /b 1)
echo Done. Look for "Wohlig Attendance Sync" on the desktop.
pause
