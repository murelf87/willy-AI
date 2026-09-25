; WILLY AI - Instalador autoinstalable
; Compilar: makensis /DVERSION=0.0.10 /DOUTFILE=WillyAI-Setup-0.0.10.exe willy.nsi

!ifndef VERSION
  !define VERSION "0.0.10"
!endif
!ifndef OUTFILE
  !define OUTFILE "WillyAI-Setup-${VERSION}.exe"
!endif
!ifndef VERSIONFILE
  !define VERSIONFILE "updates\version.txt"
!endif

!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "WILLY AI ${VERSION}"
OutFile "${OUTFILE}"
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

; Ruta fija: siempre sustituye la instalacion anterior
InstallDir "$LOCALAPPDATA\Programs\WILLY AI"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "WILLY AI"
VIAddVersionKey "FileDescription" "WILLY AI - Tu IA local"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "WILLY AI"
VIAddVersionKey "LegalCopyright" "WILLY AI"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
; Portada del asistente: siempre anuncia la actualizacion
!define MUI_WELCOMEPAGE_TITLE "Actualizando WILLY AI a la versión ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Este asistente actualiza WILLY AI a la versión ${VERSION}.$\r$\n$\r$\nSe cerrará la versión anterior, se sustituirán los archivos del programa y se renovará el acceso directo de tu escritorio. Tus datos, conversaciones y modelos descargados se conservan.$\r$\n$\r$\nPulsa Siguiente para continuar."
!insertmacro MUI_PAGE_WELCOME
; Sin pagina de directorio: la ruta es fija
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir WILLY AI ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchApp
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Spanish"

Function SkipDirectory
  Abort
FunctionEnd

Function LaunchApp
  ExecShell "open" "$INSTDIR\willy-ai.exe"
FunctionEnd

Section "WILLY AI" SecMain
  SetOutPath "$INSTDIR"

  DetailPrint "Actualizando WILLY AI a la versión ${VERSION}..."
  ; Cierra la version anterior si esta en ejecucion
  nsExec::Exec 'taskkill /F /IM willy-ai.exe /T'
  nsExec::Exec 'taskkill /F /IM node.exe /T'
  Sleep 1500

  ; Copia de seguridad de la version previa
  IfFileExists "$INSTDIR\version.txt" 0 +6
    CreateDirectory "$INSTDIR\backups"
    CopyFiles "$INSTDIR\version.txt" "$INSTDIR\backups\version-anterior.txt"
    IfFileExists "$INSTDIR\backups" +2
      CreateDirectory "$INSTDIR\backups"

  ; Limpia la instalacion anterior (conserva datos del usuario)
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\updates"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\node_modules"

  ; Instala los archivos nuevos
  SetOutPath "$INSTDIR\app"
  File /r "app\.output"
  SetOutPath "$INSTDIR\tools"
  File "tools\node.exe"
  SetOutPath "$INSTDIR\updates"
  File "updates\version.txt"
  SetOutPath "$INSTDIR\src"
  File /r "source\src\*"
  SetOutPath "$INSTDIR\public"
  File /r "source\public\*"
  SetOutPath "$INSTDIR\node_modules"
  File /r "source\node_modules\*"
  SetOutPath "$INSTDIR"
  File "source\package.json"
  File "source\vite.config.ts"
  File "source\vite.config.local.ts"
  File "source\tsconfig.json"
  File "willy-ai.exe"
  File /nonfatal "willy-ai.bat"
  File /nonfatal "willy.vbs"
  File "crear-accesos.ps1"
  File "willy.nsi"
  File "icon.ico"
  File /nonfatal "version.txt"

  ; Escribe la version instalada
  FileOpen $0 "$INSTDIR\version.txt" w
  FileWrite $0 "${VERSION}$\r$\n"
  FileClose $0

  ; Accesos directos (Escritorio y Menu Inicio) con el logo y el numero de version
  DetailPrint "Renovando el acceso directo del escritorio: willy-ai-vs${VERSION}..."
  Delete "$DESKTOP\WILLY AI.lnk"
  Delete "$DESKTOP\willy-ai-vs*.lnk"
  Delete "$SMPROGRAMS\WILLY AI\*.lnk"
  CreateDirectory "$SMPROGRAMS\WILLY AI"
  CreateShortcut "$SMPROGRAMS\WILLY AI\willy-ai-vs${VERSION}.lnk" "$INSTDIR\willy-ai.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "WILLY AI ${VERSION} - Tu IA local"
  CreateShortcut "$DESKTOP\willy-ai-vs${VERSION}.lnk" "$INSTDIR\willy-ai.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "WILLY AI ${VERSION} - Tu IA local"

  ; Refuerzo: script que recrea los accesos con el nombre de la version


  ; Desinstalador
  WriteUninstaller "$INSTDIR\desinstalar.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI" "DisplayName" "WILLY AI ${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI" "UninstallString" "$INSTDIR\desinstalar.exe"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM node.exe /T'
  Delete "$DESKTOP\WILLY AI.lnk"
  Delete "$DESKTOP\willy-ai-vs*.lnk"
  RMDir /r "$SMPROGRAMS\WILLY AI"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\WillyAI"
SectionEnd
