@echo off
setlocal EnableExtensions
title WILLY Remote Agent - Instalacion

set "SOURCE=%LOCALAPPDATA%\WillyAI-GitHub\source"
if not exist "%SOURCE%\willy-remote-agent.mjs" set "SOURCE=%~dp0"

if not exist "%SOURCE%\willy-remote-agent.mjs" (
  echo ERROR: No se encuentra willy-remote-agent.mjs
  echo Esperaba: "%SOURCE%\willy-remote-agent.mjs"
  pause
  exit /b 2
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  pause
  exit /b 3
)

echo.
echo WILLY Remote Agent
echo ==================
echo Carpeta: %SOURCE%
echo.

echo [1/4] Cerrando una instancia antigua si existe...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-CimInstance Win32_Process ^| Where-Object { $_.CommandLine -match 'willy-remote-agent\.mjs' }; foreach($x in $p){ if($x.ProcessId -ne $PID){ Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue } }" >nul 2>&1

echo [2/4] Registrando inicio automatico del usuario...
schtasks /Create /F /SC ONLOGON /TN "WILLY Remote Agent" /TR "\"%SOURCE%\INICIAR-WILLY-REMOTE-AGENT.cmd\"" >nul
if errorlevel 1 (
  echo AVISO: Windows no permitio registrar la tarea automatica.
  echo El agente se puede iniciar igualmente desde WILLY ^> Equipo remoto.
) else (
  echo Inicio automatico: OK
)

echo [3/4] Iniciando agente propio...
start "WILLY Remote Agent" /min cmd /c ""%SOURCE%\INICIAR-WILLY-REMOTE-AGENT.cmd""

echo [4/4] Comprobando salud...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 20;$i++){ try{$r=Invoke-RestMethod 'http://127.0.0.1:4050/health' -TimeoutSec 1; if($r.ok){$ok=$true; Write-Host ('OK - '+$r.name+' v'+$r.version+' PID='+$r.pid); break}}catch{}; Start-Sleep -Milliseconds 300}; if(-not $ok){Write-Host 'ERROR: el agente no confirmo el arranque'; exit 4}"
if errorlevel 1 (
  echo.
  echo El agente no ha confirmado el arranque. Revisa la consola o WILLY ^> Equipo remoto.
  pause
  exit /b 4
)

echo.
echo INSTALACION COMPLETADA
echo El token y la configuracion se guardan en:
echo   %LOCALAPPDATA%\WillyAI-GitHub\remote-agent
echo.
echo Por seguridad, el agente escucha solo en 127.0.0.1.
echo Para acceso desde Internet se usa WILLY Remote Relay propio, no Desktop Commander.
echo.
pause
exit /b 0
