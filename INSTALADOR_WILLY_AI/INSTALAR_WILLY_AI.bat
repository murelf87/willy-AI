@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Instalador WILLY AI 0.0.7
color 0B
echo.
echo ==============================================
echo       PREPARANDO WILLY AI 0.0.7
echo ==============================================
echo.
if not exist "WillyAI.part000.bin" goto :missing
copy /b "WillyAI.part000.bin"+"WillyAI.part001.bin"+"WillyAI.part002.bin"+"WillyAI.part003.bin"+"WillyAI.part004.bin" "WillyAI-Setup-0.0.7.exe" >nul
if errorlevel 1 goto :error
certutil -hashfile "WillyAI-Setup-0.0.7.exe" SHA256 | find /i "96c320547283271b1e320d901a85a25373dda4fa144522986e432adfd01b0705" >nul
if errorlevel 1 goto :corrupt
echo Instalador preparado correctamente.
echo Se abrira ahora. Si Windows pregunta, pulsa Si.
start "" "WillyAI-Setup-0.0.7.exe"
exit /b 0
:missing
echo ERROR: Faltan piezas. Descarga la carpeta completa desde GitHub.
pause
exit /b 1
:corrupt
echo ERROR: La descarga no esta completa. Vuelve a descargar el ZIP de GitHub.
del /q "WillyAI-Setup-0.0.7.exe" 2>nul
pause
exit /b 1
:error
echo ERROR: Windows no pudo preparar el instalador.
pause
exit /b 1
