@echo off
rem Runs the connector for good: if it stops (network down, device off, a crash) it starts again after 30 seconds. Everything it prints goes to bridge.log.
cd /d "%~dp0"
:again
for %%F in (bridge.log) do if %%~zF GTR 2000000 move /y bridge.log bridge.old.log >nul
node bridge.mjs >> bridge.log 2>&1
timeout /t 30 /nobreak >nul
goto again
