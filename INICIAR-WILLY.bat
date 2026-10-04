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
$repoUrl = 'https://github.com/murelf87/willy-AI.git'
$mutex = New-Object System.Threading.Mutex($false, 'Local\WillyAI-GitHub-Launcher')
$locked = $false
$logging = $false

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path
}

# IMPORTANTE: no se redirige la salida de error de git.
# git escribe mensajes normales (como "From https://github.com/...") en stderr y,
# si se redirigen con 2>&1, PowerShell los convierte en errores fatales.
function Run-Git {
  $out = & git @args
  if ($LASTEXITCODE -ne 0) { throw "Git ha fallado: git $($args -join ' ')" }
  return $out
}

function Ensure-Tool($command, $id) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { return }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Falta $command. Instala $id manualmente desde su pagina oficial." }
  Write-Host "Instalando $id. Windows puede pedir autorizacion..." -ForegroundColor Yellow
  & winget install --exact --id $id --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Cierra esta ventana y vuelve a abrir el BAT para que Windows reconozca $command." }
}

function Show-Log($titulo, $ruta) {
  if (Test-Path $ruta) {
    $texto = Get-Content -LiteralPath $ruta -Raw
    if ($texto -and $texto.Trim()) {
      Write-Host ""
      Write-Host "--- $titulo ---" -ForegroundColor Yellow
      Write-Host $texto
    }
  }
}

try {
  try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Ya hay otro lanzador de WILLY abierto. Cierra su ventana antes de volver a abrirlo.' }

  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $log = Join-Path $root ('inicio-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
  Start-Transcript -Path $log | Out-Null
  $logging = $true

  Write-Host 'WILLY AI - ACTUALIZAR E INICIAR' -ForegroundColor Cyan
  Write-Host 'Se comprobara la ultima version de main en cada inicio.'
  Write-Host ''

  Ensure-Tool 'git.exe' 'Git.Git'
  Ensure-Tool 'node.exe' 'OpenJS.NodeJS.LTS'
  Ensure-Tool 'npm.cmd' 'OpenJS.NodeJS.LTS'

  & node -e "const a=Number(process.versions.node.split('.')[0]);process.exit(a>=18?0:1)"
  if ($LASTEXITCODE -ne 0) { throw 'Node es demasiado antiguo. Instala Node.js LTS desde https://nodejs.org y vuelve a abrir el BAT.' }

  # ---- Descarga o actualizacion del codigo ----
  if (-not (Test-Path (Join-Path $repo '.git'))) {
    if (Test-Path $repo) {
      $aparcada = Join-Path $root ('source-antigua-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      Write-Host "La carpeta del codigo no es un repositorio Git. Se aparta en: $aparcada" -ForegroundColor Yellow
      Move-Item -LiteralPath $repo -Destination $aparcada
    }
    Write-Host '[1/4] Descargando el proyecto. La primera vez puede tardar varios minutos...'
    Run-Git clone --branch main --single-branch $repoUrl $repo | Out-Null
  }

  Set-Location -LiteralPath $repo

  # Corrige la direccion del repositorio si quedo apuntando a la antigua
  $urlActual = & git remote get-url origin
  if ($LASTEXITCODE -ne 0 -or -not $urlActual) {
    & git remote add origin $repoUrl
  } elseif ($urlActual.Trim() -ne $repoUrl) {
    Write-Host 'Actualizando la direccion del repositorio...' -ForegroundColor Yellow
    & git remote set-url origin $repoUrl
  }

  Write-Host '[1/4] Comprobando cambios en GitHub...'
  Run-Git fetch origin main | Out-Null

  # Esta carpeta es una copia de uso, no de desarrollo: se deja siempre igual que GitHub.
  # Si hubiera cambios locales se guarda antes una copia en un archivo .patch.
  $sucio = & git status --porcelain --untracked-files=no
  if ($sucio) {
    $parche = Join-Path $root ('cambios-locales-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.patch')
    & git diff > $parche
    Write-Host "Habia cambios locales. Se ha guardado una copia en:" -ForegroundColor Yellow
    Write-Host "  $parche" -ForegroundColor Yellow
    Write-Host 'Se restaura el codigo oficial de GitHub...' -ForegroundColor Yellow
  }
  # reset --hard solo afecta a archivos del repositorio.
  # node_modules y .output no se tocan, asi no hay que recompilar desde cero.
  Run-Git reset --hard origin/main | Out-Null
  $head = (Run-Git rev-parse HEAD).Trim()
  Write-Host "Version actual: $head" -ForegroundColor Green

  # ---- Puerto libre ----
  $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 3000)
  try { $listener.Start() }
  catch { throw 'El puerto 3000 esta ocupado. Cierra el WILLY anterior y vuelve a abrir este BAT.' }
  finally { $listener.Stop() }

  # ---- Dependencias y compilacion ----
  $marker = Join-Path $root 'build-correcta.txt'
  $entry = Join-Path $repo '.output\server\index.mjs'
  $nodeVersion = (& node --version).Trim()
  $lockHash = (Get-FileHash -Algorithm SHA256 -LiteralPath 'package-lock.json').Hash
  $buildKey = "$head|$nodeVersion|$lockHash"
  $previous = ''
  if (Test-Path $marker) { $previous = (Get-Content -LiteralPath $marker -Raw).Trim() }

  if ($previous -ne $buildKey -or -not (Test-Path $entry)) {
    Write-Host '[2/4] Instalando dependencias. La primera vez puede tardar varios minutos...'
    & npm.cmd ci --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Ha fallado npm ci. Revisa el error que aparece encima.' }

    Write-Host '[3/4] Compilando WILLY AI para Windows...'
    $backup = $null
    if (Test-Path '.output') {
      $backup = Join-Path $root ('build-anterior-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      Move-Item -LiteralPath '.output' -Destination $backup
    }
    try {
      if (Test-Path 'vite.config.local.ts') {
        & npm.cmd run build -- --config vite.config.local.ts
      } else {
        & npm.cmd run build
      }
      if ($LASTEXITCODE -ne 0) { throw 'La compilacion ha fallado.' }
      if (-not (Test-Path $entry)) { throw "La compilacion no ha generado el servidor ($entry)." }
      Set-Content -LiteralPath $marker -Value $buildKey -Encoding ASCII
    } catch {
      if (Test-Path '.output') { Move-Item -LiteralPath '.output' -Destination (Join-Path $root ('build-fallida-' + [guid]::NewGuid().ToString('N'))) }
      if ($backup) { Move-Item -LiteralPath $backup -Destination (Join-Path $repo '.output') }
      throw
    }
  } else {
    Write-Host '[2/4] y [3/4] Ya estaban preparadas para esta version. Se omiten.'
  }

  # ---- Motor de IA (solo si ya esta instalado) ----
  $ollamaExe = $null
  $candidato = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
  if (Test-Path $candidato) { $ollamaExe = $candidato }
  if (-not $ollamaExe) {
    $candidato = Join-Path $env:ProgramFiles 'Ollama\ollama.exe'
    if (Test-Path $candidato) { $ollamaExe = $candidato }
  }
  if (-not $ollamaExe) {
    $cmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($cmd) { $ollamaExe = $cmd.Source }
  }
  if ($ollamaExe -and -not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    Write-Host 'Arrancando el motor de IA local...'
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Minimized | Out-Null
  }

  # ---- Arranque del servidor ----
  $env:PORT = '3000'
  $env:APP_PORT = '3000'
  $env:NITRO_PORT = '3000'
  $env:HOST = '0.0.0.0'
  $env:NITRO_HOST = '0.0.0.0'
  $env:NODE_ENV = 'production'

  Write-Host '[4/4] Iniciando WILLY en http://localhost:3000 ...'
  $outLog = Join-Path $root 'servidor.log'
  $errLog = Join-Path $root 'servidor-error.log'
  Set-Content -LiteralPath $outLog -Value '' -Encoding UTF8
  Set-Content -LiteralPath $errLog -Value '' -Encoding UTF8

  $nodeExe = (Get-Command node.exe).Source
  $server = Start-Process -FilePath $nodeExe -ArgumentList '".output\server\index.mjs"' -WorkingDirectory $repo -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -WindowStyle Hidden

  try {
    $ready = $false
    Write-Host -NoNewline 'Esperando a que responda'
    for ($i = 0; $i -lt 90; $i++) {
      Write-Host -NoNewline '.'
      if ($server.HasExited) {
        Write-Host ''
        Show-Log 'Salida del servidor' $outLog
        Show-Log 'Error del servidor' $errLog
        throw 'El servidor se ha detenido nada mas arrancar. El motivo aparece justo encima.'
      }
      # Se consulta 127.0.0.1: en Windows "localhost" puede resolverse a IPv6 y fallar aqui.
      foreach ($destino in @('http://127.0.0.1:3000/', 'http://localhost:3000/')) {
        try {
          $resp = Invoke-WebRequest -UseBasicParsing -Uri $destino -TimeoutSec 2
          if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) { $ready = $true }
        } catch {
          # El servidor todavia no acepta conexiones: se reintenta.
        }
        if ($ready) { break }
      }
      if ($ready) { break }
      Start-Sleep -Seconds 1
    }
    Write-Host ''

    if (-not $ready) {
      Show-Log 'Salida del servidor' $outLog
      Show-Log 'Error del servidor' $errLog
      throw 'WILLY no ha respondido en 90 segundos. El motivo aparece justo encima.'
    }

    # Se abre localhost para conservar el origen del almacenamiento del navegador.
    Start-Process 'http://localhost:3000/'
    Write-Host ''
    Write-Host 'WILLY esta abierto en el navegador.' -ForegroundColor Green
    Write-Host 'Deja esta ventana abierta mientras lo usas.'
    Write-Host 'Pulsa ENTER aqui para detener WILLY.'
    Read-Host | Out-Null
  } finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Registros en: $root" -ForegroundColor Yellow
  Read-Host 'Pulsa ENTER para cerrar' | Out-Null
  exit 1
} finally {
  if ($logging) { try { Stop-Transcript | Out-Null } catch { } }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
