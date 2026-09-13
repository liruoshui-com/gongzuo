@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then open this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4318 in your browser.
node server.mjs
pause
