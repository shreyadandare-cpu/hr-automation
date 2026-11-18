@echo off
rem Stops Wohlig Attendance Sync: the connector and the log viewer. Open the desktop icon again to start them.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|cmd)\.exe$' -and $_.CommandLine -match 'run-forever|bridge\.mjs|viewer\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo Wohlig Attendance Sync is stopped.
pause
