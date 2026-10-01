@echo off
chcp 65001 >nul
title WILLY AI — Instalador de la última versión

:: Lanza el script PowerShell con permisos de ejecución locales.
:: No requiere cambiar la política global del sistema.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR-ULTIMA-VERSION.ps1"

:: Si PowerShell falla por política del sistema, intentar con el bypass alternativo
if %errorlevel% neq 0 (
  powershell.exe -NoProfile -Command "& {Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass; & '%~dp0INSTALAR-ULTIMA-VERSION.ps1'}"
)
