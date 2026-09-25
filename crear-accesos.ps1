param([string]$Version = "")
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Version) {
  $vf = Join-Path $dir 'version.txt'
  if (Test-Path $vf) { $Version = (Get-Content $vf -Raw).Trim() }
}
$name = if ($Version) { "willy-ai-vs$Version" } else { "willy-ai" }

$sh = New-Object -ComObject WScript.Shell
$launcher = Join-Path $dir 'willy-ai.exe'
$ico = Join-Path $dir 'icon.ico'

function New-Acceso($lnkPath) {
  $lnk = $sh.CreateShortcut($lnkPath)
  $lnk.TargetPath = $launcher
  $lnk.Arguments = ''
  $lnk.WorkingDirectory = $dir
  $lnk.IconLocation = "$ico,0"
  $lnk.Description = "WILLY AI $Version - Tu IA local"
  $lnk.Save()
}

$desktop = [Environment]::GetFolderPath('Desktop')
# Borra accesos de versiones anteriores para que solo quede el actual
Get-ChildItem -Path $desktop -Filter 'willy-ai-vs*.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $desktop 'WILLY AI.lnk') -Force -ErrorAction SilentlyContinue

New-Acceso (Join-Path $desktop "$name.lnk")
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'WILLY AI'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
Get-ChildItem -Path $startMenu -Filter '*.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
New-Acceso (Join-Path $startMenu "$name.lnk")
