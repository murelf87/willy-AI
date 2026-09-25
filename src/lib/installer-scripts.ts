// Guiones de NSIS de la fábrica de instaladores: el LANZADOR (el .exe con el nombre del programa, que abre su ventana sin
// consola) y el INSTALADOR (por usuario, sin permisos de administrador, con acceso en el menú Inicio y en el escritorio,
// entrada en «Aplicaciones instaladas» y desinstalador que deja el equipo como estaba). Funciones puras: solo generan texto.
//
// Modo /PRUEBA del instalador (lo usa WILLY para probarlo de verdad sin tocar el programa del dueño si ya lo tiene
// instalado): otra clave de registro («<id>-prueba»), los accesos directos en una carpeta de la propia prueba y no cierra
// ningún programa en marcha.

import { motorExeName, type ProgramInfo } from "@/lib/desktop-format";

export type InstallerSpec = {
  programa: ProgramInfo;
  /** Nombre de archivo del lanzador y de los accesos directos (sin .exe). */
  nombreArchivo: string;
  editor: string;
  /** Carpeta con el paquete ya montado (lo que se instala). */
  paquete: string;
  /** Entradas de primer nivel del paquete (carpetas y archivos), para desinstalar solo lo que se instaló. */
  carpetas: string[];
  archivos: string[];
  /** Lanzador ya compilado que se instala como «<nombreArchivo>.exe». */
  lanzador: string;
  /** Icono del programa (.ico) o null para el de NSIS. */
  icono: string | null;
  salida: string;
  anio: number;
};

/** Escapa un texto para usarlo DENTRO de una cadena de NSIS ($ → $$, " → $\", sin saltos de línea). */
export function nsisEscape(text: string): string {
  return text.replace(/\$/g, "$$$$").replace(/"/g, '$\\"').replace(/[\r\n\t]+/g, " ");
}

/** Cadena de NSIS entre comillas; `\u0001` marca un salto de línea visible ($\r$\n). */
export function nsisQuote(text: string): string {
  return `"${nsisEscape(text.replace(/\u0001/g, "\u0002")).replace(/\u0002/g, "$\\r$\\n")}"`;
}

const UNINST = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

function versionInfo(spec: Pick<InstallerSpec, "programa" | "editor" | "anio">, descripcion: string): string[] {
  const p = spec.programa;
  return [
    `VIProductVersion "${p.version}.0"`,
    `VIFileVersion "${p.version}.0"`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "ProductName" ${nsisQuote(p.nombre)}`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "FileDescription" ${nsisQuote(descripcion)}`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "CompanyName" ${nsisQuote(spec.editor)}`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "LegalCopyright" ${nsisQuote(`© ${spec.anio} ${spec.editor}`)}`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "FileVersion" "${p.version}"`,
    `VIAddVersionKey /LANG=\${LANG_SPANISH} "ProductVersion" "${p.version}"`,
  ];
}

/** Lanzador: arranca el motor del programa sin ventana de consola; el motor abre la ventana del programa. */
export function launcherScript(spec: Pick<InstallerSpec, "programa" | "editor" | "icono" | "anio"> & { salida: string }): string {
  const motor = motorExeName(spec.programa.id);
  return [
    "Unicode true",
    "ManifestDPIAware true",
    "RequestExecutionLevel user",
    "SilentInstall silent",
    "SetCompressor /SOLID lzma",
    `Name ${nsisQuote(spec.programa.nombre)}`,
    `OutFile ${nsisQuote(spec.salida)}`,
    spec.icono ? `Icon ${nsisQuote(spec.icono)}` : 'Icon "${NSISDIR}\\Contrib\\Graphics\\Icons\\modern-install.ico"',
    'BrandingText " "',
    '!include "LogicLib.nsh"',
    'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\Spanish.nlf"',
    ...versionInfo(spec, spec.programa.nombre),
    "",
    "Section",
    `  \${IfNot} \${FileExists} "$EXEDIR\\motor\\${motor}"`,
    `    MessageBox MB_ICONSTOP|MB_OK ${nsisQuote(`Falta el motor de ${spec.programa.nombre}. Vuelve a instalar el programa.`)}`,
    "    Quit",
    "  ${EndIf}",
    '  SetOutPath "$EXEDIR"',
    `  ExecShell "open" "$EXEDIR\\motor\\${motor}" '"$EXEDIR\\runtime\\servidor.mjs" --abrir' SW_HIDE`,
    "SectionEnd",
    "",
  ].join("\r\n");
}

/** Instalador por usuario con su desinstalador. */
export function installerScript(spec: InstallerSpec): string {
  const p = spec.programa;
  const nombre = nsisEscape(spec.nombreArchivo);
  const exe = `${nombre}.exe`;
  const motor = motorExeName(p.id);
  const icon = spec.icono ? nsisQuote(spec.icono) : '"${NSISDIR}\\Contrib\\Graphics\\Icons\\modern-install.ico"';
  const unicon = spec.icono ? nsisQuote(spec.icono) : '"${NSISDIR}\\Contrib\\Graphics\\Icons\\modern-uninstall.ico"';
  const lnk = `${nombre}$Sufijo.lnk`;
  const sep = spec.paquete.includes("\\") ? "\\" : "/";
  const carpetas = [...new Set([...spec.carpetas, "motor", "runtime"])].sort();
  const archivos = [...new Set([...spec.archivos, `${spec.nombreArchivo}.exe`, "instalacion.ini"])].sort();
  const bienvenida = [
    ...(p.descripcion ? [p.descripcion, ""] : []),
    "Se instalará solo para tu usuario: no hace falta ser administrador. Tus datos se guardan aparte y se conservan al actualizar.",
    "",
    "Pulsa Siguiente para continuar.",
  ].join("\u0001");
  return [
    "Unicode true",
    "ManifestDPIAware true",
    "RequestExecutionLevel user",
    "SetCompressor /SOLID lzma",
    `Name ${nsisQuote(p.nombre)}`,
    `OutFile ${nsisQuote(spec.salida)}`,
    `InstallDir "$LOCALAPPDATA\\Programs\\${nombre}"`,
    `InstallDirRegKey HKCU "Software\\${p.id}" "Carpeta"`,
    `BrandingText ${nsisQuote(`${p.nombre} ${p.version}`)}`,
    "ShowInstDetails nevershow",
    "ShowUninstDetails nevershow",
    "",
    '!include "MUI2.nsh"',
    '!include "FileFunc.nsh"',
    '!include "LogicLib.nsh"',
    "",
    `!define MUI_ICON ${icon}`,
    `!define MUI_UNICON ${unicon}`,
    "!define MUI_ABORTWARNING",
    `!define MUI_WELCOMEPAGE_TITLE ${nsisQuote(`Instalar ${p.nombre} ${p.version}`)}`,
    `!define MUI_WELCOMEPAGE_TEXT ${nsisQuote(bienvenida)}`,
    "!insertmacro MUI_PAGE_WELCOME",
    "!insertmacro MUI_PAGE_DIRECTORY",
    "!insertmacro MUI_PAGE_INSTFILES",
    `!define MUI_FINISHPAGE_RUN "$INSTDIR\\${exe}"`,
    `!define MUI_FINISHPAGE_RUN_TEXT ${nsisQuote(`Abrir ${p.nombre} ahora`)}`,
    "!insertmacro MUI_PAGE_FINISH",
    "!insertmacro MUI_UNPAGE_CONFIRM",
    "!insertmacro MUI_UNPAGE_INSTFILES",
    '!insertmacro MUI_LANGUAGE "Spanish"',
    "",
    ...versionInfo(spec, `Instalador de ${p.nombre}`),
    "",
    "Var ModoPrueba",
    "Var Clave",
    "Var Sufijo",
    "Var Menu",
    "Var Escritorio",
    "",
    "Function .onInit",
    '  StrCpy $ModoPrueba "0"',
    '  StrCpy $Sufijo ""',
    `  StrCpy $Clave "${p.id}"`,
    "  ${GetParameters} $R0",
    "  ClearErrors",
    '  ${GetOptions} $R0 "/PRUEBA" $R1',
    "  ${IfNot} ${Errors}",
    '    StrCpy $ModoPrueba "1"',
    '    StrCpy $Sufijo " (prueba)"',
    `    StrCpy $Clave "${p.id}-prueba"`,
    "  ${EndIf}",
    "FunctionEnd",
    "",
    'Section "Programa" SecPrograma',
    "  SectionIn RO",
    '  ${If} $ModoPrueba == "1"',
    '    StrCpy $Menu "$INSTDIR\\..\\accesos-prueba\\menu"',
    '    StrCpy $Escritorio "$INSTDIR\\..\\accesos-prueba\\escritorio"',
    "  ${Else}",
    `    nsExec::Exec 'taskkill /F /IM "${motor}"'`,
    "    Pop $0",
    "    Sleep 700",
    '    StrCpy $Menu "$SMPROGRAMS"',
    '    StrCpy $Escritorio "$DESKTOP"',
    "  ${EndIf}",
    "  ; Al actualizar solo se limpia lo que instaló este mismo programa (nunca otra carpeta del usuario).",
    '  ReadINIStr $R2 "$INSTDIR\\instalacion.ini" "instalacion" "programa"',
    `  \${If} $R2 == "${p.id}"`,
    ...carpetas.map((c) => `    RMDir /r "$INSTDIR\\${nsisEscape(c)}"`),
    "  ${EndIf}",
    '  SetOutPath "$INSTDIR"',
    `  File /r ${nsisQuote(`${spec.paquete.replace(/[\\/]+$/, "")}${sep}*`)}`,
    `  File "/oname=$INSTDIR\\${exe}" ${nsisQuote(spec.lanzador)}`,
    '  WriteUninstaller "$INSTDIR\\Desinstalar.exe"',
    '  CreateDirectory "$Menu"',
    '  CreateDirectory "$Escritorio"',
    `  CreateShortCut "$Menu\\${lnk}" "$INSTDIR\\${exe}" "" "$INSTDIR\\${exe}" 0`,
    `  CreateShortCut "$Escritorio\\${lnk}" "$INSTDIR\\${exe}" "" "$INSTDIR\\${exe}" 0`,
    '  WriteRegStr HKCU "Software\\$Clave" "Carpeta" "$INSTDIR"',
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "DisplayName" "${nsisEscape(p.nombre)}$Sufijo"`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "DisplayVersion" "${p.version}"`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "Publisher" ${nsisQuote(spec.editor)}`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "InstallLocation" "$INSTDIR"`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "DisplayIcon" "$INSTDIR\\${exe}"`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "UninstallString" '"$INSTDIR\\Desinstalar.exe"'`,
    `  WriteRegStr HKCU "${UNINST}\\$Clave" "QuietUninstallString" '"$INSTDIR\\Desinstalar.exe" /S'`,
    `  WriteRegDWORD HKCU "${UNINST}\\$Clave" "NoModify" 1`,
    `  WriteRegDWORD HKCU "${UNINST}\\$Clave" "NoRepair" 1`,
    '  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2',
    '  IntFmt $0 "0x%08X" $0',
    `  WriteRegDWORD HKCU "${UNINST}\\$Clave" "EstimatedSize" "$0"`,
    "  ; instalacion.ini en UTF-16 (con marca BOM) para que las rutas con acentos se guarden bien.",
    '  Delete "$INSTDIR\\instalacion.ini"',
    '  FileOpen $9 "$INSTDIR\\instalacion.ini" w',
    "  FileWriteWord $9 0xFEFF",
    "  FileClose $9",
    `  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "programa" "${p.id}"`,
    `  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "version" "${p.version}"`,
    '  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "modo" "$ModoPrueba"',
    '  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "clave" "$Clave"',
    `  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "acceso_menu" "$Menu\\${lnk}"`,
    `  WriteINIStr "$INSTDIR\\instalacion.ini" "instalacion" "acceso_escritorio" "$Escritorio\\${lnk}"`,
    "SectionEnd",
    "",
    'Section "Uninstall"',
    '  ReadINIStr $0 "$INSTDIR\\instalacion.ini" "instalacion" "modo"',
    '  ReadINIStr $1 "$INSTDIR\\instalacion.ini" "instalacion" "clave"',
    '  ReadINIStr $2 "$INSTDIR\\instalacion.ini" "instalacion" "acceso_menu"',
    '  ReadINIStr $3 "$INSTDIR\\instalacion.ini" "instalacion" "acceso_escritorio"',
    '  ${If} $1 == ""',
    `    StrCpy $1 "${p.id}"`,
    "  ${EndIf}",
    '  ${If} $0 != "1"',
    `    nsExec::Exec 'taskkill /F /IM "${motor}"'`,
    "    Pop $R9",
    "    Sleep 700",
    "  ${EndIf}",
    '  ${If} $2 != ""',
    '    Delete "$2"',
    "  ${EndIf}",
    '  ${If} $3 != ""',
    '    Delete "$3"',
    "  ${EndIf}",
    `  DeleteRegKey HKCU "${UNINST}\\$1"`,
    '  DeleteRegKey HKCU "Software\\$1"',
    ...carpetas.map((c) => `  RMDir /r "$INSTDIR\\${nsisEscape(c)}"`),
    ...archivos.map((f) => `  Delete "$INSTDIR\\${nsisEscape(f)}"`),
    '  Delete "$INSTDIR\\Desinstalar.exe"',
    '  RMDir "$INSTDIR"',
    '  ${If} $0 != "1"',
    "  ${AndIfNot} ${Silent}",
    `    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 ${nsisQuote(`¿Borrar también tus datos de ${p.nombre}? Si vas a volver a instalarlo, pulsa No y se conservarán.`)} IDNO datos_conservados`,
    `    RMDir /r "$LOCALAPPDATA\\${p.id}"`,
    "    datos_conservados:",
    "  ${EndIf}",
    "SectionEnd",
    "",
  ].join("\r\n");
}
