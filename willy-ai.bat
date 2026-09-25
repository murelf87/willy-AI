@echo off
cd /d "%~dp0"
set APP_PORT=3000
set PORT=3000
set HOST=0.0.0.0
set NODE_ENV=production
echo [%date% %time%] Arrancando WILLY AI > "%~dp0arranque.log"

call :docker
call :ollama

rem ---- Abre el navegador cuando el servidor responda
start "" /min cmd /c "for /l %%i in (1,1,90) do (powershell -noprofile -c \"try{(Invoke-WebRequest -UseBasicParsing http://localhost:3000/ -TimeoutSec 1)|Out-Null;exit 0}catch{exit 1}\" && start http://localhost:3000/ && exit) || (ping -n 2 127.0.0.1 >nul)"

rem ---- Arranca la app (proceso principal)
echo [%time%] Iniciando servidor >> "%~dp0arranque.log"
"%~dp0tools\node.exe" "%~dp0app\.output\server\index.mjs" >> "%~dp0arranque.log" 2>&1
echo [%time%] El servidor se ha detenido (codigo %errorlevel%) >> "%~dp0arranque.log"
exit /b

:docker
tasklist /FI "IMAGENAME eq Docker Desktop.exe" | find /I "Docker Desktop.exe" >nul
if not errorlevel 1 goto :eof
set "DOCKER="
call :try "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
call :try "%ProgramW6432%\Docker\Docker\Docker Desktop.exe"
call :try "%LOCALAPPDATA%\Docker\Docker Desktop.exe"
call :try "%LOCALAPPDATA%\Programs\Docker\Docker\Docker Desktop.exe"
call :tryx86
if not defined DOCKER goto :eof
echo [%time%] Abriendo Docker: %DOCKER% >> "%~dp0arranque.log"
start "" "%DOCKER%"
goto :eof

:try
if defined DOCKER goto :eof
if exist %1 set "DOCKER=%~1"
goto :eof

:tryx86
if defined DOCKER goto :eof
for /f "usebackq tokens=2,*" %%a in (`reg query "HKLM\SOFTWARE\Docker Inc.\Docker\1.0" /v AppPath 2^>nul ^| find "AppPath"`) do set "DOCKER=%%b\Docker Desktop.exe"
if defined DOCKER if not exist "%DOCKER%" set "DOCKER="
goto :eof

:ollama
tasklist /FI "IMAGENAME eq ollama.exe" | find /I "ollama.exe" >nul
if not errorlevel 1 goto :eof
set "OLLAMA="
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA if exist "%ProgramFiles%\Ollama\ollama.exe" set "OLLAMA=%ProgramFiles%\Ollama\ollama.exe"
if defined OLLAMA goto :ollamarun
echo [%time%] Ollama no encontrado: instalando >> "%~dp0arranque.log"
winget install -e --id Ollama.Ollama --accept-package-agreements --accept-source-agreements --silent >> "%~dp0arranque.log" 2>&1
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA if exist "%ProgramFiles%\Ollama\ollama.exe" set "OLLAMA=%ProgramFiles%\Ollama\ollama.exe"
if not defined OLLAMA goto :eof
:ollamarun
echo [%time%] Arrancando motor de IA: %OLLAMA% >> "%~dp0arranque.log"
start "" /min "%OLLAMA%" serve
start "" /min cmd /c ""%OLLAMA%" pull llama3.2:3b >> "%~dp0arranque.log" 2>&1"
goto :eof
