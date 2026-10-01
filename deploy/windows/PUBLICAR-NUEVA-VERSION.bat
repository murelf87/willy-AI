@echo off
chcp 65001 >nul
title Publicar nueva version de WILLY AI en GitHub

:: Ir a la raiz del repo (dos niveles arriba de deploy\windows\)
cd /d "%~dp0..\.."
if errorlevel 1 (
  echo [ERROR] No se pudo ir a la raiz del repositorio.
  echo Ruta del script: %~dp0
  pause & exit /b 1
)

:: Verificar que estamos en el repo correcto
if not exist "src\lib\version.ts" (
  echo [ERROR] No encuentro src\lib\version.ts
  echo Asegurate de que el .bat esta dentro de la carpeta deploy\windows\ del repo de WILLY AI.
  echo Ruta actual: %CD%
  pause & exit /b 1
)

echo Raiz del repo: %CD%

echo.
echo  ============================================================
echo   PUBLICAR NUEVA VERSION DE WILLY AI EN GITHUB
echo  ============================================================
echo.

:: ── Leer version actual ──────────────────────────────────────
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content src\lib\version.ts | Select-String 'APP_VERSION\s*=').Line -replace '.*APP_VERSION\s*=\s*\"([^\"]+)\".*','$1'"') do set "VER=%%v"

if "%VER%"=="" (
  echo [ERROR] No se pudo leer la version de src\lib\version.ts
  pause & exit /b 1
)

echo  Version: v%VER%
echo.
echo  Este script:
echo    1. git pull
echo    2. npm run build
echo    3. Genera WillyAI-Setup-%VER%.exe con NSIS
echo    4. git push + tag v%VER%
echo    5. Publica el .exe en GitHub Releases
echo.
set /p "OK=Escribe SI para continuar: "
if /i not "%OK%"=="SI" (echo Cancelado. & pause & exit /b 0)

:: ── 1. Git pull ──────────────────────────────────────────────
echo.
echo  [1/5] Sincronizando con GitHub...
git pull --rebase origin main
if errorlevel 1 (echo [ERROR] git pull fallo. Resuelve conflictos primero. & pause & exit /b 1)

:: ── 2. Build ─────────────────────────────────────────────────
echo.
echo  [2/5] Compilando la app...
call npm run build
if errorlevel 1 (echo [ERROR] Build fallido. Corrige los errores primero. & pause & exit /b 1)

:: ── 3. Instalador NSIS ───────────────────────────────────────
echo.
echo  [3/5] Preparando el instalador...

:: Comprobar NSIS
set "MAKENSIS="
for /f "delims=" %%p in ('where makensis 2^>nul') do set "MAKENSIS=%%p"
if not defined MAKENSIS (
  if exist "C:\Program Files (x86)\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
)
if not defined MAKENSIS (
  echo  NSIS no encontrado. Instalando con winget...
  winget install NSIS.NSIS --silent --accept-source-agreements --accept-package-agreements
  if exist "C:\Program Files (x86)\NSIS\makensis.exe" set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
)
if not defined MAKENSIS (
  echo [ERROR] No se pudo instalar NSIS. Instalalo desde https://nsis.sourceforge.io y vuelve a ejecutar.
  pause & exit /b 1
)

:: Ruta de la instalacion actual de WILLY
set "INSTDIR=%LOCALAPPDATA%\Programs\WILLY AI"

:: Staging en TEMP
set "STAGE=%TEMP%\willy-release-%VER%"
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%"

:: -- Build web (.output de TanStack/Vite)
if exist ".output" (
  xcopy /E /I /Q ".output" "%STAGE%\app\.output" >nul
) else if exist "dist" (
  xcopy /E /I /Q "dist" "%STAGE%\app\.output" >nul
) else (
  echo [ERROR] No encuentro la carpeta de build. Haz npm run build primero.
  pause & exit /b 1
)

:: -- Fuentes para el instalador
mkdir "%STAGE%\source" >nul 2>nul
xcopy /E /I /Q "src"    "%STAGE%\source\src"    >nul
xcopy /E /I /Q "public" "%STAGE%\source\public" >nul
copy "package.json"    "%STAGE%\source\package.json"    >nul
copy "vite.config.ts"  "%STAGE%\source\vite.config.ts"  >nul
copy "tsconfig.json"   "%STAGE%\source\tsconfig.json"   >nul
if exist "vite.config.local.ts" copy "vite.config.local.ts" "%STAGE%\source\vite.config.local.ts" >nul

:: -- node_modules: reutiliza los del repo (ya instalados)
echo  Copiando node_modules (puede tardar 1-2 minutos)...
xcopy /E /I /Q "node_modules" "%STAGE%\source\node_modules" >nul

:: -- willy-ai.exe: el ejecutable que arranca WILLY (de la instalacion actual)
mkdir "%STAGE%\tools" "%STAGE%\updates" >nul 2>nul
if exist "%INSTDIR%\willy-ai.exe" (
  copy "%INSTDIR%\willy-ai.exe" "%STAGE%\willy-ai.exe" >nul
  echo  willy-ai.exe copiado de la instalacion actual.
) else if exist "tools\willy-ai.exe" (
  copy "tools\willy-ai.exe" "%STAGE%\willy-ai.exe" >nul
  echo  willy-ai.exe copiado de tools\.
) else (
  echo [AVISO] No encontre willy-ai.exe. El instalador se generara sin el ejecutable.
  echo         Los archivos de codigo fuente se instalaran correctamente.
  echo         Para iniciar WILLY habra que usar willy-ai.bat.
)

:: -- node.exe portatil
if exist "tools\node.exe" (
  copy "tools\node.exe" "%STAGE%\tools\node.exe" >nul
) else if exist "%INSTDIR%\tools\node.exe" (
  copy "%INSTDIR%\tools\node.exe" "%STAGE%\tools\node.exe" >nul
) else (
  for /f "delims=" %%n in ('where node 2^>nul') do (
    copy "%%n" "%STAGE%\tools\node.exe" >nul
    goto :node_ok
  )
  echo [ERROR] No encontre node.exe. Ponlo en tools\node.exe del repo.
  pause & exit /b 1
  :node_ok
)

:: -- Otros archivos del instalador
copy "icon.ico"          "%STAGE%\icon.ico"          >nul
copy "willy.nsi"         "%STAGE%\willy.nsi"         >nul
copy "crear-accesos.ps1" "%STAGE%\crear-accesos.ps1" >nul
if exist "willy-ai.bat" copy "willy-ai.bat" "%STAGE%\willy-ai.bat" >nul
if exist "willy.vbs"    copy "willy.vbs"    "%STAGE%\willy.vbs"    >nul
echo %VER%> "%STAGE%\updates\version.txt"

:: -- Compilar .exe con NSIS
set "OUTFILE=WillyAI-Setup-%VER%.exe"
echo  Compilando el .exe con NSIS...
pushd "%STAGE%"
"%MAKENSIS%" /DVERSION=%VER% /DOUTFILE="%OUTFILE%" willy.nsi
if errorlevel 1 (
  popd
  echo [ERROR] NSIS fallo. Revisa los mensajes de arriba.
  pause & exit /b 1
)
popd
move "%STAGE%\%OUTFILE%" "%CD%\%OUTFILE%" >nul
echo  Generado: %OUTFILE%

:: ── 4. Commit + tag + push ───────────────────────────────────
echo.
echo  [4/5] Publicando en GitHub...
git add src\lib\version.ts
git diff --cached --quiet >nul 2>nul
if errorlevel 1 git commit -m "release: v%VER%

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
if errorlevel 1 (echo [ERROR] git push fallo. & pause & exit /b 1)
git tag -f "v%VER%"
git push origin "v%VER%" --force
if errorlevel 1 (echo [ERROR] push del tag fallo. & pause & exit /b 1)

:: ── 5. GitHub Release ────────────────────────────────────────
echo.
echo  [5/5] Publicando el Release...
where gh >nul 2>nul
if errorlevel 1 (
  echo  Instalando GitHub CLI...
  winget install GitHub.cli --silent --accept-source-agreements --accept-package-agreements >nul 2>nul
)
where gh >nul 2>nul
if errorlevel 1 (
  echo [AVISO] No se pudo instalar gh. Sube %OUTFILE% manualmente a:
  echo         https://github.com/murelf87/willy-AI/releases/new?tag=v%VER%
  goto :fin
)

gh release delete "v%VER%" --yes >nul 2>nul
gh release create "v%VER%" "%OUTFILE%" --title "WILLY AI v%VER%" --notes "Instalador de WILLY AI v%VER%. Descargalo y ejecutalo: WILLY AI se actualiza solo conservando tus datos."
if errorlevel 1 (
  echo [AVISO] gh fallo. Sube %OUTFILE% manualmente a:
  echo         https://github.com/murelf87/willy-AI/releases/new?tag=v%VER%
) else (
  echo.
  echo  ============================================================
  echo   Release v%VER% publicado correctamente.
  echo   WILLY AI detectara la actualizacion automaticamente.
  echo  ============================================================
)

:fin
echo.
pause
