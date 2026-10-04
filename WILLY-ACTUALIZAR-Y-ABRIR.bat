@echo off
setlocal
title WILLY - Actualizar desde GitHub y abrir
set "WILLY_SCRIPT=%~f0"
powershell.exe -NoProfile -Command "$s=[IO.File]::ReadAllText($env:WILLY_SCRIPT); $m='# INICIO_'+'POWERSHELL'; & ([scriptblock]::Create($s.Substring($s.IndexOf($m)+$m.Length)))"
if errorlevel 1 pause
exit /b
# INICIO_POWERSHELL
$ErrorActionPreference = 'Stop'
$lock = $null
function Git-Run {
  & git.exe @args
  if ($LASTEXITCODE -ne 0) { throw 'Git no pudo completar la operacion. No se abrira una version antigua. Revisa el mensaje anterior.' }
}
try {
  Write-Host 'WILLY: ultima version publicada en main, no necesariamente una version estable.'
  Write-Host 'Copia independiente. No migra los datos de instalaciones anteriores.'
  if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'Falta Git para Windows. Instala Git desde https://git-scm.com/downloads/win y vuelve a abrir este archivo.' }
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Falta Node.js con npm. Instala Node.js LTS desde https://nodejs.org/ y vuelve a abrir este archivo.' }
  $nv = & node.exe -p 'process.versions.node'
  if ($LASTEXITCODE -ne 0) { throw 'Node.js no funciona.' }
  if ([version]$nv -lt [version]'22.12.0') { throw 'Este lanzador requiere Node.js 22.12 o superior. Instala una version LTS compatible.' }
  $base = Join-Path $env:LOCALAPPDATA 'Willy-GitHub'
  $app = Join-Path $base 'app'
  $stamp = Join-Path $base 'dependencias.sha256'
  New-Item -ItemType Directory -Path $base -Force | Out-Null
  try { $lock = [IO.File]::Open((Join-Path $base 'lanzador.lock'),'OpenOrCreate','ReadWrite','None') } catch { throw 'Este lanzador ya esta abierto. Usa su ventana o cierrala antes de intentarlo otra vez.' }
  $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,3000)
  try { $probe.Start() } catch { throw 'El puerto 3000 esta ocupado. Cierra el servidor de WILLY anterior y vuelve a intentarlo. No se cerraran procesos automaticamente.' } finally { $probe.Stop() }
  $env:GIT_TERMINAL_PROMPT = '0'
  if (-not (Test-Path -LiteralPath $app)) {
    Write-Host 'Primera descarga de GitHub. Puede tardar...'
    Git-Run clone --depth 1 --single-branch --branch main -- https://github.com/murelf87/willy-AI.git $app
  }
  if (-not (Test-Path -LiteralPath (Join-Path $app '.git'))) { throw ('La carpeta no es una copia Git valida: ' + $app + '. No se modificara. Pide ayuda en el chat.') }
  Set-Location -LiteralPath $app
  $origin = Git-Run remote get-url origin
  if ($origin -ne 'https://github.com/murelf87/willy-AI.git') { throw 'El origen Git no coincide con el repositorio esperado.' }
  $branch = Git-Run branch --show-current
  if ($branch -ne 'main') { throw 'La copia no esta en main. No se cambiara de rama automaticamente.' }
  $dirty = Git-Run status --porcelain --untracked-files=all
  if ($dirty) { throw ('Hay archivos locales modificados o sin registrar en ' + $app + '. Se conservan: no se actualizara hasta revisarlos.') }
  Write-Host 'Consultando y descargando los cambios de main...'
  Git-Run fetch origin main
  $ahead = Git-Run rev-list --count origin/main..HEAD
  if ([int]$ahead -gt 0) { throw 'Hay commits locales. Se conservan y no se mezclaran automaticamente.' }
  Git-Run merge --ff-only --no-overwrite-ignore origin/main
  $head = Git-Run rev-parse HEAD
  $remote = Git-Run rev-parse origin/main
  if ($head -ne $remote) { throw 'No se pudo verificar la actualizacion.' }
  Write-Host ('Codigo actualizado: ' + $head.Substring(0,12))
  if (-not (Test-Path -LiteralPath 'package-lock.json')) { throw 'Falta package-lock.json. No se instalaran dependencias sin un archivo de bloqueo.' }
  $package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  if ($package.scripts.dev -ne 'vite dev') { throw 'El comando de arranque ha cambiado. Pide revisar este lanzador.' }
  $fingerprint = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash + (Get-FileHash 'package.json' -Algorithm SHA256).Hash + $nv
  $previous = ''; if (Test-Path -LiteralPath $stamp) { $previous = [IO.File]::ReadAllText($stamp) }
  if ($previous -ne $fingerprint -or -not (Test-Path -LiteralPath 'node_modules\.bin\vite.cmd')) {
    Write-Host 'Instalando dependencias del proyecto. Requiere internet y ejecuta scripts de sus paquetes.'
    if (Test-Path -LiteralPath $stamp) { Remove-Item -LiteralPath $stamp }
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Fallo npm ci. No se abrira WILLY. Envia una captura del error.' }
    [IO.File]::WriteAllText($stamp,$fingerprint)
  }
  try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 | Out-Null } catch {
    $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $exe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if ($ollama) { $exe = $ollama.Source }
    if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Minimized | Out-Null }
    else { Write-Host 'AVISO: Ollama no esta instalado. La interfaz abrira sin IA local. No se descargan modelos automaticamente.' }
  }
  $env:WILLY_ROOT = $app
  $env:NODE_ENV = 'development'
  $env:PORT = '3000'; $env:HOST = '127.0.0.1'
  Write-Host ('Carpeta utilizada: ' + $app)
  Write-Host 'Arranque en modo desarrollo. No inicia Docker ni un backend externo.'
  $server = Start-Process -FilePath $env:ComSpec -WorkingDirectory $app -ArgumentList '/d /c "npm run dev -- --host 127.0.0.1 --port 3000 --strictPort & pause"' -PassThru
  $ready = $false
  for ($i=0; $i -lt 90; $i++) {
    if ($server.HasExited) { throw 'La ventana del servidor se ha cerrado.' }
    try { $r = Invoke-WebRequest 'http://localhost:3000/app' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready=$true; break } } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'WILLY no responde. Revisa y envia una captura de la ventana del servidor. No se ha cerrado automaticamente.' }
  Start-Process 'http://localhost:3000/app'
  Write-Host 'WILLY abierto. Deja las ventanas abiertas mientras lo utilizas.'
  Write-Host 'Para actualizar otra vez, cierra primero el servidor y vuelve a ejecutar este BAT.'
  $server.WaitForExit()
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($lock) { $lock.Dispose() }
}
