@echo off
rem Opens the attendance log viewer in the browser (Devices, Resync logs, Event viewer). Reads only; closes when you close this window.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again. & pause & exit /b 1)
if not exist "node_modules" (echo Installing the first time, please wait... & call npm install)
start "" http://localhost:4010
node viewer.mjs
pause
