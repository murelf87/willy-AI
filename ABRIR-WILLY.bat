@echo off
cd /d "C:\Users\ANTONIO\AppData\Local\Programs\WILLY AI"
title WILLY AI v0.0.45

echo.
echo  ============================================
echo   WILLY AI v0.0.45  -  Inicio directo
echo   (sin comprobar actualizaciones)
echo  ============================================
echo.

set APP_PORT=3000
set PORT=3000
set HOST=0.0.0.0
set NODE_ENV=production

echo [%time%] Arrancando WILLY AI (modo directo)

:: Abrir el navegador cuando el servidor responda
start "" /min cmd /c "for /l %%i in (1,1,90) do (powershell -noprofile -c \"try{(Invoke-WebRequest -UseBasicParsing http://localhost:3000/ -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}\" && start http://localhost:3000/ && exit) || (ping -n 2 127.0.0.1 >nul)"

:: Arrancar el servidor directamente (sin pasar por willy-ai.exe)
"%~dp0tools\node.exe" "%~dp0app\.output\server\index.mjs"

echo.
echo [%time%] WILLY AI se ha detenido.
pause
