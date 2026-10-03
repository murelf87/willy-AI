@echo off
set "WILLY=%LOCALAPPDATA%\Programs\WILLY AI"
if not exist "%WILLY%\tools\node.exe" (
  echo WILLY AI no esta instalado en %WILLY%
  pause
  exit /b 1
)
cd /d "%WILLY%"
set APP_PORT=3000
set PORT=3000
set HOST=0.0.0.0
set NODE_ENV=production

echo [%date% %time%] Arrancando WILLY AI > "%WILLY%\arranque.log"

start "" /min cmd /c "for /l %%i in (1,1,90) do (powershell -noprofile -c \"try{(Invoke-WebRequest -UseBasicParsing http://localhost:3000/ -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}\" && start http://localhost:3000/ && exit) || (ping -n 2 127.0.0.1 >nul)"

echo [%time%] Iniciando servidor >> "%WILLY%\arranque.log"
"%WILLY%\tools\node.exe" "%WILLY%\app\.output\server\index.mjs" >> "%WILLY%\arranque.log" 2>&1
