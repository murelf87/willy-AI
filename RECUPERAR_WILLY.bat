@echo off
title Recuperar WILLY AI
cd /d "%~dp0"
echo.
echo  Recuperar WILLY AI: comprueba si WILLY responde y, si no, vuelve a poner
echo  la ultima version buena del programa y lo arranca. No toques nada, solo espera.
echo.
if not exist "%~dp0tools\node.exe" (
  echo No encuentro el motor de WILLY AI ^(tools\node.exe^). No se ha cambiado nada.
  pause
  exit /b 1
)
if not exist "%~dp0supervisor\recuperar.mjs" (
  echo Falta supervisor\recuperar.mjs. Vuelve a ejecutar la ultima actualizacion de WILLY AI.
  pause
  exit /b 1
)
"%~dp0tools\node.exe" "%~dp0supervisor\recuperar.mjs" "%~dp0."
echo.
pause
