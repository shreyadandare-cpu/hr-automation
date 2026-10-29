@echo off
rem Starts the attendance connector. Double-click this file, or run: run.bat --test   (checks the device, sends nothing)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again. & pause & exit /b 1)
if not exist ".env" (echo Create the file .env first: copy .env.example to .env and fill it in. & pause & exit /b 1)
if not exist "node_modules" (echo Installing the first time, please wait... & call npm install)
node bridge.mjs %*
echo.
echo The connector stopped. Press a key to close.
pause >nul
