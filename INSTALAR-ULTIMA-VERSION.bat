@echo off
chcp 65001 >nul
title WILLY AI — Instalador de la última versión

:: Lanza el script PowerShell que descarga e instala siempre la última versión.
:: No requiere cambiar la política global del sistema.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\INSTALAR-ULTIMA-VERSION.ps1"

if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "& {Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; & '%~dp0deploy\windows\INSTALAR-ULTIMA-VERSION.ps1'}"
)
