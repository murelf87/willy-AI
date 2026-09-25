Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)

' Lee la version instalada
ver = ""
verFile = dir & "\version.txt"
If fso.FileExists(verFile) Then
  On Error Resume Next
  ver = Trim(fso.OpenTextFile(verFile, 1).ReadAll())
  ver = Replace(Replace(ver, vbCr, ""), vbLf, "")
  On Error Goto 0
End If

If ver <> "" Then
  lnkName = "willy-ai-vs" & ver
Else
  lnkName = "willy-ai"
End If

' Recrea el acceso directo del escritorio si falta
desktop = sh.SpecialFolders("Desktop")
lnkPath = desktop & "\" & lnkName & ".lnk"
If Not fso.FileExists(lnkPath) Then
  Set lnk = sh.CreateShortcut(lnkPath)
  lnk.TargetPath = sh.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"
  lnk.Arguments = """" & dir & "\willy.vbs"""
  lnk.WorkingDirectory = dir
  lnk.IconLocation = dir & "\icon.ico,0"
  lnk.Description = "WILLY AI " & ver & " - Tu IA local"
  lnk.Save
End If

' Arranca la app sin ventana
sh.Run """" & dir & "\willy-ai.bat""", 0, False
