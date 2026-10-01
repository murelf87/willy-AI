@echo off
chcp 65001 >nul
title Recuperar WILLY AI
cd /d "%~dp0"
echo.
echo  ============================================================
echo   RECUPERAR WILLY AI
echo  ============================================================
echo.
echo  1. Comprueba si hay una version nueva en GitHub y la instala.
echo  2. Si WILLY no responde, vuelve a poner la ultima version
echo     buena y lo arranca. No toques nada, solo espera.
echo.

:: ── Paso 0: comprobar dependencias básicas ───────────────────────
if not exist "%~dp0tools\node.exe" (
  echo [AVISO] No encuentro el motor de WILLY AI ^(tools\node.exe^).
  echo         Descargando la ultima version de GitHub para repararlo...
  goto :DESCARGAR
)
if not exist "%~dp0supervisor\recuperar.mjs" (
  echo [AVISO] Falta supervisor\recuperar.mjs. Descargando version nueva...
  goto :DESCARGAR
)

:: ── Paso 1: comprobar si hay versión nueva en GitHub ─────────────
echo  [1/3] Comprobando si hay actualizacion disponible en GitHub...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri 'https://api.github.com/repos/murelf87/willy-AI/releases/latest' -Headers @{'User-Agent'='WILLY-Recuperar/1.0'} -TimeoutSec 15; $v = $r.tag_name -replace '^v',''; $src = Get-Content '%~dp0src\lib\version.ts' -Raw -ErrorAction SilentlyContinue; $cur = if ($src -match 'APP_VERSION\s*=\s*\"([^\"]+)\"') { $matches[1] } else { '0.0.0' }; if ([version]$v -gt [version]$cur) { Write-Output \"NUEVA:$v\" } else { Write-Output \"OK:$cur\" } } catch { Write-Output 'SIN-RED' }" > "%TEMP%\willy-ver-check.txt" 2>nul

set /p VER_CHECK=<"%TEMP%\willy-ver-check.txt"
del "%TEMP%\willy-ver-check.txt" 2>nul

if "%VER_CHECK:~0,6%"=="NUEVA:" (
  set "NUEVA_VER=%VER_CHECK:~6%"
  echo.
  echo  [!] Version nueva disponible: v%NUEVA_VER%
  echo      Descargando e instalando antes de recuperar...
  echo.
  goto :DESCARGAR
)

if "%VER_CHECK:~0,3%"=="OK:" (
  echo      Ya tienes la ultima version ^(%VER_CHECK:~3%^). Procediendo a recuperar...
  echo.
)

if "%VER_CHECK%"=="SIN-RED" (
  echo      Sin conexion a Internet. Recuperando con la version instalada...
  echo.
)

:: ── Paso 2: recuperar con la versión local ───────────────────────
goto :RECUPERAR

:DESCARGAR
echo  [2/3] Descargando la ultima version desde GitHub...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\INSTALAR-ULTIMA-VERSION.ps1"
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "& {Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; & '%~dp0deploy\windows\INSTALAR-ULTIMA-VERSION.ps1'}"
)
echo.
echo  Cuando termine el instalador, WILLY AI se habra actualizado.
echo  Si necesitas seguir recuperando, vuelve a ejecutar este archivo.
pause
exit /b 0

:RECUPERAR
echo  [3/3] Recuperando WILLY AI con la version local...
"%~dp0tools\node.exe" "%~dp0supervisor\recuperar.mjs" "%~dp0."
echo.
pause
