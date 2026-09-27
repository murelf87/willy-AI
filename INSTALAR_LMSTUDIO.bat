@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo.
echo  === WILLY AI - Instalador LM Studio + Qwen2.5-Coder ===
echo.

REM -- 1. Descargar LM Studio --------------------------------------------------
set "LMS_URL=https://releases.lmstudio.ai/win32/x64/0.3.5/LM-Studio-0.3.5-Setup.exe"
set "LMS_INSTALLER=%TEMP%\LMStudio-Setup.exe"

echo  [1/4] Descargando LM Studio...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%LMS_URL%' -OutFile '%LMS_INSTALLER%' -UseBasicParsing"

if not exist "%LMS_INSTALLER%" (
  echo  [ERROR] No se pudo descargar LM Studio.
  echo  Descargalo manualmente desde: https://lmstudio.ai
  pause & exit /b 1
)
echo  OK - LM Studio descargado.
echo.

REM -- 2. Instalar LM Studio ---------------------------------------------------
echo  [2/4] Instalando LM Studio (puede tardar 1-2 minutos)...
start /wait "" "%LMS_INSTALLER%" /S
echo  OK - LM Studio instalado.
echo.

REM -- 3. Descargar modelo Qwen2.5-Coder 7B (~4.7 GB) -------------------------
set "MODEL_DIR=%USERPROFILE%\.cache\lm-studio\models\Qwen\Qwen2.5-Coder-7B-Instruct-GGUF"
set "MODEL_FILE=%MODEL_DIR%\qwen2.5-coder-7b-instruct-q4_k_m.gguf"
set "MODEL_URL=https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf"

echo  [3/4] Descargando modelo Qwen2.5-Coder 7B (~4.7 GB)...
echo        Esto puede tardar varios minutos segun tu conexion.
echo.
mkdir "%MODEL_DIR%" 2>nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url='%MODEL_URL%'; $out='%MODEL_FILE%';" ^
  "Write-Host '  Descargando...';" ^
  "Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing;" ^
  "Write-Host '  OK - Modelo descargado.'"

if not exist "%MODEL_FILE%" (
  echo.
  echo  [AVISO] El modelo no se descargo automaticamente.
  echo  Abre LM Studio, busca "Qwen2.5-Coder-7B-Instruct" y descargalo desde ahi.
  goto :config
)
echo.

REM -- 4. Instrucciones finales -------------------------------------------------
:config
echo  [4/4] Instalacion completada.
echo.
echo  PASOS FINALES EN LM STUDIO (una sola vez):
echo.
echo    1. Abre LM Studio (icono en el escritorio)
echo    2. Ve a "Local Server" (icono en la barra lateral)
echo    3. Selecciona: Qwen2.5-Coder-7B-Instruct-Q4
echo    4. Pulsa "Start Server"
echo       El servidor queda en: http://localhost:1234
echo.
echo  EN WILLY AI:
echo    Ajustes > Motor de IA > Endpoint: http://localhost:1234
echo    Modelo: qwen2.5-coder-7b-instruct
echo.
echo  Abriendo LM Studio...
start "" "%LOCALAPPDATA%\Programs\LM-Studio\LM Studio.exe" 2>nul

echo.
pause
