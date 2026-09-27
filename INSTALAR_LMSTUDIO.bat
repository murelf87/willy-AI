@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   WILLY AI — Instalador LM Studio + Qwen2.5-Coder   ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

REM ── 1. Descargar LM Studio ──────────────────────────────────────────────────
set "LMS_URL=https://releases.lmstudio.ai/win32/x64/0.3.5/LM-Studio-0.3.5-Setup.exe"
set "LMS_INSTALLER=%TEMP%\LMStudio-Setup.exe"

echo  [1/4] Descargando LM Studio...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Invoke-WebRequest -Uri '%LMS_URL%' -OutFile '%LMS_INSTALLER%' -UseBasicParsing"

if not exist "%LMS_INSTALLER%" (
  echo  [ERROR] No se pudo descargar LM Studio.
  echo  Descargalo manualmente desde: https://lmstudio.ai
  pause & exit /b 1
)
echo  OK — LM Studio descargado.
echo.

REM ── 2. Instalar LM Studio en silencio ───────────────────────────────────────
echo  [2/4] Instalando LM Studio (puede tardar 1-2 minutos)...
"%LMS_INSTALLER%" /S /D=%LOCALAPPDATA%\Programs\LM-Studio
timeout /t 5 /nobreak >nul

REM Esperar a que termine el instalador
:wait_install
tasklist /fi "imagename eq LMStudio-Setup.exe" 2>nul | find /i "LMStudio-Setup.exe" >nul
if not errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait_install
)
echo  OK — LM Studio instalado.
echo.

REM ── 3. Descargar el modelo Qwen2.5-Coder 7B (GGUF Q4_K_M ~4.7 GB) ─────────
set "MODEL_URL=https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
set "MODEL_DIR=%USERPROFILE%\.cache\lm-studio\models\Qwen\Qwen2.5-Coder-7B-Instruct-GGUF"
set "MODEL_FILE=%MODEL_DIR%\qwen2.5-coder-7b-instruct-q4_k_m.gguf"

echo  [3/4] Descargando modelo Qwen2.5-Coder 7B (~4.7 GB)...
echo        (esto puede tardar varios minutos segun tu conexion)
echo.
mkdir "%MODEL_DIR%" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='%MODEL_URL%';" ^
  "$out='%MODEL_FILE%';" ^
  "$wc=New-Object System.Net.WebClient;" ^
  "$wc.DownloadProgressChanged += { param($s,$e) Write-Host -NoNewline ('  ' + $e.ProgressPercentage + '%% descargado    `r') };" ^
  "$wc.DownloadFileCompleted += { param($s,$e) if($e.Error){ Write-Host '  ERROR: ' + $e.Error.Message } else { Write-Host '  OK — Modelo descargado.   ' } };" ^
  "$task = $wc.DownloadFileTaskAsync($url, $out);" ^
  "while(-not $task.IsCompleted){ Start-Sleep -Milliseconds 500 };" ^
  "if($task.IsFaulted){ throw $task.Exception }"

if not exist "%MODEL_FILE%" (
  echo.
  echo  [AVISO] El modelo no se descargo automaticamente.
  echo  Abre LM Studio, busca "Qwen2.5-Coder-7B-Instruct" y descargalo desde ahi.
  goto :config
)
echo.

REM ── 4. Instrucciones de configuracion en WILLY ──────────────────────────────
:config
echo  [4/4] Configuracion en WILLY AI
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  PASOS FINALES (hazlo una sola vez):                 ║
echo  ║                                                      ║
echo  ║  1. Abre LM Studio (icono en el escritorio)          ║
echo  ║  2. Ve a "Local Server" (icono ^<-^> en la barra)       ║
echo  ║  3. Selecciona: Qwen2.5-Coder-7B-Instruct-Q4        ║
echo  ║  4. Pulsa "Start Server"                             ║
echo  ║     (el servidor queda en http://localhost:1234)     ║
echo  ║                                                      ║
echo  ║  En WILLY AI:                                        ║
echo  ║  Ajustes ^> Motor de IA ^> Endpoint:                  ║
echo  ║    http://localhost:1234                             ║
echo  ║  Modelo: qwen2.5-coder-7b-instruct                  ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  Abriendo LM Studio...
start "" "%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe" 2>nul

pause
