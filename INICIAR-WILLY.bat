@echo off
setlocal
chcp 65001 >nul
title WILLY AI - Actualizar e iniciar
set "WILLY_LAUNCHER_FILE=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:WILLY_LAUNCHER_FILE); $p=$s.LastIndexOf('# WILLY_POWERSHELL_BEGIN'); & ([scriptblock]::Create($s.Substring($p)))"
exit /b %errorlevel%
# WILLY_POWERSHELL_BEGIN
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Join-Path $env:LOCALAPPDATA 'WillyAI-GitHub'
$repo = Join-Path $root 'source'
$mutex = New-Object System.Threading.Mutex($false, 'Local\WillyAI-GitHub-Launcher')
$locked = $false
$logging = $false
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path
}
function Run-Git {
  $out = & git @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Git fallo: $($args -join ' '). Salida: $out" }
  return $out
}
function Ensure-Tool($command, $id) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Falta $command. Instala $id manualmente." }
  Write-Host "Instalando $id..." -ForegroundColor Yellow
  & winget install --exact --id $id --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar $id." }
  Refresh-Path
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Cierra esta ventana y vuelve a abrir el BAT para reconocer $command." }
}
try {
  try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Ya hay otro lanzador actualizando o ejecutando WILLY. Cierra su ventana antes de volver a abrirlo.' }
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $log = Join-Path $root ('inicio-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
  Start-Transcript -Path $log | Out-Null
  $logging = $true
  Write-Host 'WILLY AI - ACTUALIZAR E INICIAR' -ForegroundColor Cyan
  Write-Host 'Se comprobara la ultima version de main en cada inicio.'
  Ensure-Tool 'git.exe' 'Git.Git'
  Ensure-Tool 'node.exe' 'OpenJS.NodeJS.LTS'
  Ensure-Tool 'npm.cmd' 'OpenJS.NodeJS.LTS'
  # Verificar Node >= 18 (compatible con WILLY AI)
  & node -e "const [a]=process.versions.node.split('.').map(Number);process.exit(a>=18?0:1)"
  if ($LASTEXITCODE -ne 0) { throw 'Node es demasiado antiguo. Instala Node.js LTS desde https://nodejs.org y vuelve a abrir el BAT.' }
  if (-not (Test-Path (Join-Path $repo '.git'))) {
    if (Test-Path $repo) { throw "La carpeta $repo ya existe sin Git. Renombrala y vuelve a iniciar." }
    Write-Host '[1/4] Descargando el proyecto (primera vez, puede tardar varios minutos)...'
    Run-Git clone --branch main --single-branch https://github.com/murelf87/willy-AI.git $repo
  }
  Set-Location -LiteralPath $repo
  # Corregir URL del remote si apunta a la URL antigua (willy-ai en minuscula)
  $currentUrl = (& git remote get-url origin 2>&1).Trim()
  $correctUrl = 'https://github.com/murelf87/willy-AI.git'
  if ($currentUrl -ne $correctUrl -and $currentUrl -notmatch 'willy-AI') {
    Write-Host "Actualizando URL del repositorio a la nueva direccion..." -ForegroundColor Yellow
    & git remote set-url origin $correctUrl
  }
  Write-Host '[1/4] Comprobando cambios en GitHub...'
  Run-Git fetch origin main
  $head = (Run-Git rev-parse HEAD).Trim()
  $latest = (Run-Git rev-parse origin/main).Trim()
  if ($head -ne $latest) {
    $dirty = & git status --porcelain --untracked-files=no
    if ($dirty) { throw "Hay cambios locales en $repo. Revisalos antes de actualizar." }
    Run-Git merge --ff-only origin/main
    $head = (Run-Git rev-parse HEAD).Trim()
  }
  Write-Host "Commit: $head" -ForegroundColor Green
  # Comprobar puerto 3000
  $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback,3000)
  try { $listener.Start() } catch { throw 'El puerto 3000 esta ocupado. Cierra el WILLY anterior y vuelve a abrir este BAT.' } finally { $listener.Stop() }
  $marker = Join-Path $root 'build-correcta.txt'
  $entry = Join-Path $repo '.output\server\index.mjs'
  $nodeVersion = (& node --version).Trim()
  $lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'package-lock.json').Hash
  $buildKey = "$head|$nodeVersion|$lockHash"
  $previous = if (Test-Path $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
  if ($previous -ne $buildKey -or -not (Test-Path $entry)) {
    Write-Host '[2/4] Instalando dependencias. La primera vez puede tardar varios minutos...'
    & npm.cmd ci --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Fallo npm ci. Revisa el error anterior.' }
    Write-Host '[3/4] Compilando WILLY AI para Windows...'
    $backup = $null
    if (Test-Path '.output') {
      $backup = Join-Path $root ('build-anterior-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      Move-Item -LiteralPath '.output' -Destination $backup
    }
    # Usar vite.config.local.ts si existe, si no usar vite.config.ts normal
    $buildConfig = if (Test-Path 'vite.config.local.ts') { '--config vite.config.local.ts' } else { '' }
    try {
      if ($buildConfig) {
        & npm.cmd run build -- --config vite.config.local.ts
      } else {
        & npm.cmd run build
      }
      if ($LASTEXITCODE -ne 0 -or -not (Test-Path $entry)) { throw 'La compilacion ha fallado.' }
      Set-Content -LiteralPath $marker -Value $buildKey -Encoding ASCII
    } catch {
      if (Test-Path '.output') { Move-Item -LiteralPath '.output' -Destination (Join-Path $root ('build-fallida-' + [guid]::NewGuid().ToString('N'))) }
      if ($backup) { Move-Item -LiteralPath $backup -Destination (Join-Path $repo '.output') }
      throw
    }
  } else { Write-Host '[2/4] y [3/4] Build ya preparada para este commit, saltando...' }
  # Iniciar Ollama si esta instalado
  $ollamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (-not (Test-Path $ollamaPath)) { $ollamaPath = 'C:\Program Files\Ollama\ollama.exe' }
  if ((Test-Path $ollamaPath) -and -not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WindowStyle Minimized | Out-Null
    Start-Sleep -Seconds 2
  }
  # Variables de entorno para el servidor Nitro/Node
  $env:PORT = '3000'
  $env:APP_PORT = '3000'
  $env:NITRO_PORT = '3000'
  $env:HOST = '0.0.0.0'
  $env:NITRO_HOST = '0.0.0.0'
  $env:NODE_ENV = 'production'
  Write-Host '[4/4] Iniciando WILLY en http://localhost:3000 ...'
  $outLog = Join-Path $root 'servidor.log'
  $errLog = Join-Path $root 'servidor-error.log'
  # Limpiar logs anteriores
  if (Test-Path $outLog) { Clear-Content $outLog }
  if (Test-Path $errLog) { Clear-Content $errLog }
  $nodeExe = (Get-Command node.exe).Source
  $server = Start-Process -FilePath $nodeExe -ArgumentList '".output\server\index.mjs"' -WorkingDirectory $repo -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden
  try {
    $ready = $false
    Write-Host 'Esperando a que WILLY arranque' -NoNewline
    for ($i = 0; $i -lt 90; $i++) {
      Write-Host '.' -NoNewline
      if ($server.HasExited) {
        Write-Host ''
        $errContent = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { '(vacio)' }
        throw "El servidor se ha detenido inesperadamente.`nError: $errContent"
      }
      try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
      } catch { }
      Start-Sleep -Seconds 1
    }
    Write-Host ''
    if (-not $ready) {
      $errContent = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { '(vacio)' }
      throw "WILLY no responde en 90 segundos.`nError: $errContent"
    }
    Start-Process 'http://localhost:3000/'
    Write-Host 'WILLY abierto en el navegador.' -ForegroundColor Green
    Write-Host 'Deja esta ventana abierta mientras lo utilizas.'
    Write-Host 'Pulsa ENTER aqui para detener WILLY.'
    Read-Host | Out-Null
  } finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  }
} catch {
  Write-Host "`nERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Registros en: $root" -ForegroundColor Yellow
  Read-Host 'Pulsa ENTER para cerrar' | Out-Null
  exit 1
} finally {
  if ($logging) { try { Stop-Transcript | Out-Null } catch {} }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
