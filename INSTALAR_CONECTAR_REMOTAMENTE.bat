@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  WILLY AI — Conectar Remotamente (con permiso por acción)
REM  Versión: 1.0   Fecha: 2026-09-27
REM  Crea backup, aplica cambios y permite rollback inmediato.
REM ============================================================

set "WILLY_ROOT=%LOCALAPPDATA%\Programs\WILLY AI"
set "SRC=%WILLY_ROOT%\resources\app\src"
set "BACKUP_DIR=%WILLY_ROOT%\backups\conectar-remotamente-%date:~-4%-%date:~3,2%-%date:~0,2%"

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   WILLY AI — Conectar Remotamente        ║
echo  ╚══════════════════════════════════════════╝
echo.

REM — Verificar que existe la carpeta de WILLY
if not exist "%SRC%" (
  echo  [ERROR] No se encuentra: %SRC%
  echo  Asegúrate de que WILLY AI está instalado correctamente.
  pause & exit /b 1
)

echo  [1/5] Creando copia de seguridad en:
echo        %BACKUP_DIR%
echo.
mkdir "%BACKUP_DIR%" 2>nul
if exist "%SRC%\components\settings-view.tsx" (
  copy /y "%SRC%\components\settings-view.tsx" "%BACKUP_DIR%\settings-view.tsx.bak" >nul
)

echo  [2/5] Instalando componente RemotePermissionDialog...
(
echo import { Shield, ShieldAlert } from "lucide-react";
echo import { Button } from "@/components/ui/button";
echo.
echo export interface RemoteAction {
echo   id: string;
echo   description: string;
echo   detail?: string;
echo }
echo.
echo interface Props {
echo   action: RemoteAction ^| null;
echo   onAllow: ^(id: string^) =^> void;
echo   onDeny: ^(id: string^) =^> void;
echo }
echo.
echo export function RemotePermissionDialog^({ action, onAllow, onDeny }: Props^) {
echo   if ^(!action^) return null;
echo   return ^(
echo     ^<div role="dialog" aria-modal="true" aria-label="Accion remota pendiente de autorizacion"
echo          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"^>
echo       ^<div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"^>
echo         ^<div className="mb-4 flex items-center gap-3"^>
echo           ^<ShieldAlert className="size-6 shrink-0 text-amber-500" /^>
echo           ^<div^>
echo             ^<p className="text-sm font-bold"^>Solicitud de accion remota^</p^>
echo             ^<p className="text-xs text-muted-foreground"^>WILLY esta intentando ejecutar una accion en tu equipo.^</p^>
echo           ^</div^>
echo         ^</div^>
echo         ^<div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-50/10 p-4 dark:bg-amber-900/10"^>
echo           ^<p className="text-sm font-semibold text-amber-700 dark:text-amber-400"^>{action.description}^</p^>
echo           {action.detail ^&^& ^<p className="mt-1 font-mono text-xs text-muted-foreground break-all"^>{action.detail}^</p^>}
echo         ^</div^>
echo         ^<div className="flex gap-3"^>
echo           ^<Button variant="secondary" className="flex-1" onClick={^(^) =^> onDeny^(action.id^)}^>Denegar^</Button^>
echo           ^<Button className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={^(^) =^> onAllow^(action.id^)}^>
echo             ^<Shield className="size-4" /^>Permitir
echo           ^</Button^>
echo         ^</div^>
echo         ^<p className="mt-3 text-center text-xs text-muted-foreground"^>Si no reconoces esta accion, pulsa ^<strong^>Denegar^</strong^>.^</p^>
echo       ^</div^>
echo     ^</div^>
echo   ^);
echo }
) > "%SRC%\components\remote-permission-dialog.tsx"
echo  OK

echo  [3/5] Instalando hook useRemoteConnection...
REM El hook es largo; se copia desde la carpeta del instalador
REM (el .bat ya incluye el archivo junto a él en el ZIP de distribución)
if exist "%~dp0src\hooks\use-remote-connection.ts" (
  copy /y "%~dp0src\hooks\use-remote-connection.ts" "%SRC%\hooks\use-remote-connection.ts" >nul
  echo  OK ^(copiado desde el instalador^)
) else (
  echo  [AVISO] No se encontro use-remote-connection.ts junto al .bat.
  echo          El componente settings-view.tsx lo importara desde GitHub
  echo          en la proxima sincronizacion de WILLY.
)

echo  [4/5] Parcheando settings-view.tsx...
REM PowerShell hace la sustitucion exacta de texto (mas fiable que sed en Windows)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$f='%SRC:\=\\%\\components\\settings-view.tsx';" ^
  "$t=[IO.File]::ReadAllText($f,'utf-8');" ^
  "if($t -notmatch 'RemoteConnectCard'){" ^
  "  $t=$t -replace 'import \{ apiAuthService \}','import { useRemoteConnection } from \"@/hooks/use-remote-connection\";`nimport { RemotePermissionDialog } from \"@/components/remote-permission-dialog\";`nimport { apiAuthService }';" ^
  "  $t=$t -replace 'Copy, Database, FolderOpen, HardDrive, Loader2, Power,','Copy, Database, FolderOpen, HardDrive, Loader2, Monitor, Power,';" ^
  "  $t=$t -replace 'Stethoscope, Trash2, Wrench,','Stethoscope, Trash2, WifiOff, Wrench,';" ^
  "  $t=$t -replace '      <BackendCard ping={ping} />','      <BackendCard ping={ping} />`n      <RemoteConnectCard ping={ping} />';" ^
  "  [IO.File]::WriteAllText($f,$t,'utf-8');" ^
  "  Write-Host '  OK';" ^
  "} else { Write-Host '  (ya parcheado, sin cambios)'; }"

echo.
echo  [5/5] Verificacion rapida...
findstr /c:"RemoteConnectCard" "%SRC%\components\settings-view.tsx" >nul 2>&1
if %errorlevel%==0 (
  echo  OK — El boton «Conectar Remotamente» esta listo.
) else (
  echo  [ERROR] El parche no se aplico correctamente.
  echo  Ejecuta ROLLBACK_CONECTAR_REMOTAMENTE.bat para restaurar.
  goto :end
)

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  Instalacion completada con exito        ║
echo  ║  Reinicia WILLY AI para ver el cambio.   ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  El boton aparece en:
echo    Ajustes ^> Opciones avanzadas ^> Conectar Remotamente
echo.
echo  Copia de seguridad guardada en:
echo    %BACKUP_DIR%
echo.

:end
pause

REM ============================================================
REM  ROLLBACK — Ejecuta esto si algo falla
REM ============================================================
REM  Para volver atras, crea un fichero ROLLBACK_CONECTAR_REMOTAMENTE.bat
REM  con el contenido siguiente (o ejecuta manualmente):
REM
REM    copy /y "%BACKUP_DIR%\settings-view.tsx.bak" "%SRC%\components\settings-view.tsx"
REM    del "%SRC%\components\remote-permission-dialog.tsx"
REM    del "%SRC%\hooks\use-remote-connection.ts"
REM
REM ============================================================
