@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [WILLY Remote Agent] Node.js no encontrado.
  exit /b 2
)
node "%~dp0willy-remote-agent.mjs"
