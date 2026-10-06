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
$previousHead = $null
$previousVersion = $null
$buildBackup = $null
$updatedThisRun = $false

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') + ';' + $env:Path
}

# Git escribe mensajes normales (por ejemplo "From https://github.com/...") en stderr.
# Con ErrorActionPreference=Stop, Windows PowerShell 5.1 puede convertirlos en errores
# terminantes aunque git haya finalizado correctamente. Ejecutamos git temporalmente
# con Continue y usamos el codigo de salida real como unica fuente de verdad.
function Run-Git {
  $tmpErr = [System.IO.Path]::GetTempFileName()
  $oldErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $out = & git @args 2>$tmpErr
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldErrorActionPreference
  }
  $errText = ''
  if (Test-Path $tmpErr) {
    $errText = Get-Content -LiteralPath $tmpErr -Raw -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmpErr -Force -ErrorAction SilentlyContinue
  }
  if ($exitCode -ne 0) {
    $detalle = if ($errText -and $errText.Trim()) { "`n$($errText.Trim())" } else { '' }
    throw "Git ha fallado ($exitCode): git $($args -join ' ')$detalle"
  }
  # Git puede escribir informacion normal en stderr aunque termine con codigo 0.
  # No la mostramos como error; solo se usa si el codigo de salida es distinto de cero.
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

function Read-WillyVersion($repoPath) {
  try {
    $versionFile = Join-Path $repoPath 'src\lib\version.ts'
    if (-not (Test-Path $versionFile)) { return $null }
    $text = Get-Content -LiteralPath $versionFile -Raw
    $match = [regex]::Match($text, 'APP_VERSION\s*=\s*"([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
  } catch { }
  return $null
}

try {
  # Espera unos segundos por si la ventana anterior se esta cerrando todavia.
  try { $locked = $mutex.WaitOne(5000) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { throw 'Ya hay otra ventana de WILLY abierta. Cierrala (mira en la barra de tareas: "WILLY AI - Actualizar e iniciar") y vuelve a abrir este archivo.' }

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

  # Punto de restauracion de codigo: si la nueva version no compila o no arranca,
  # se vuelve automaticamente al commit que funcionaba antes de actualizar.
  try {
    $previousHead = (& git rev-parse HEAD 2>$null).Trim()
    if (-not $previousHead) { $previousHead = $null }
  } catch { $previousHead = $null }
  $previousVersion = Read-WillyVersion $repo

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
  $updatedThisRun = [bool]($previousHead -and $previousHead -ne $head)
  Write-Host "Version actual: $head" -ForegroundColor Green
  if ($updatedThisRun) { Write-Host "Punto de rollback: $previousHead" -ForegroundColor DarkGray }

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
    $buildBackup = $null
    if (Test-Path '.output') {
      $buildBackup = Join-Path $root ('build-anterior-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
      Move-Item -LiteralPath '.output' -Destination $buildBackup
      Write-Host "Copia de seguridad de la build: $buildBackup" -ForegroundColor DarkGray
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
      if ($buildBackup -and (Test-Path $buildBackup)) {
        Move-Item -LiteralPath $buildBackup -Destination (Join-Path $repo '.output')
        $buildBackup = $null
      }
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
  # Esta copia es editable: Autoconstrucción puede promover una candidata a la .output que está ejecutándose.
  $env:WILLY_RUNTIME_MODE = 'source'

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

    # Solo después de compilar Y comprobar que el servidor responde se registra la actualización.
    # La interfaz lee este archivo y mantiene la tarjeta visible hasta que el usuario pulse Aceptar.
    if ($updatedThisRun) {
      try {
        $currentVersion = Read-WillyVersion $repo
        if (-not $currentVersion) { $currentVersion = '0.0.0' }
        $notes = @()
        if ($previousHead -and $head) {
          $notes = @(Run-Git log --format=%s "$previousHead..$head" | Select-Object -First 12)
        }
        if (-not $notes.Count) { $notes = @('Código actualizado, compilado y arranque verificado correctamente.') }
        $dataDir = Join-Path $repo 'datos-privados'
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        $noticePath = Join-Path $dataDir 'actualizacion.json'
        $from = if ($previousVersion -and $previousVersion -ne $currentVersion) { $previousVersion } else { '' }
        $notice = [ordered]@{
          version = $currentVersion
          from = $from
          label = 'Actualización instalada correctamente'
          at = (Get-Date).ToUniversalTime().ToString('o')
          notes = @($notes)
          ack = $false
        }
        $notice | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $noticePath -Encoding UTF8
        Write-Host "Actualización verificada: la tarjeta de novedades se mostrará en WILLY." -ForegroundColor Green
      } catch {
        Write-Host "Aviso: la actualización funciona, pero no se pudo guardar la tarjeta de novedades: $($_.Exception.Message)" -ForegroundColor Yellow
      }
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
  $originalError = $_.Exception.Message

  # Rollback automatico: si esta ejecucion acababa de cambiar de commit y algo fallo
  # al compilar o arrancar, restaura tanto el codigo como la ultima build conocida.
  if ($updatedThisRun -and $previousHead -and (Test-Path (Join-Path $repo '.git'))) {
    Write-Host ''
    Write-Host 'La actualización no ha quedado operativa. Restaurando la versión anterior...' -ForegroundColor Yellow
    try {
      Set-Location -LiteralPath $repo
      if ($buildBackup -and (Test-Path $buildBackup)) {
        if (Test-Path '.output') {
          Move-Item -LiteralPath '.output' -Destination (Join-Path $root ('build-fallida-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
        }
        Move-Item -LiteralPath $buildBackup -Destination (Join-Path $repo '.output')
        $buildBackup = $null
      }
      Run-Git reset --hard $previousHead | Out-Null
      $markerRollback = Join-Path $root 'build-correcta.txt'
      if (Test-Path $markerRollback) { Remove-Item -LiteralPath $markerRollback -Force -ErrorAction SilentlyContinue }
      Write-Host "Rollback completado: $previousHead" -ForegroundColor Green
    } catch {
      Write-Host "ATENCION: el rollback automatico no se pudo completar: $($_.Exception.Message)" -ForegroundColor Red
    }
  }

  # Se libera el bloqueo ANTES de esperar al usuario: si no, una ventana parada
  # en "Pulsa ENTER" impide abrir el lanzador otra vez.
  if ($locked) {
    try { $mutex.ReleaseMutex() } catch { }
    $locked = $false
  }
  if ($logging) { try { Stop-Transcript | Out-Null } catch { }; $logging = $false }
  Write-Host ''
  Write-Host "ERROR: $originalError" -ForegroundColor Red
  Write-Host "Registros en: $root" -ForegroundColor Yellow
  Read-Host 'Pulsa ENTER para cerrar' | Out-Null
  exit 1
} finally {
  if ($logging) { try { Stop-Transcript | Out-Null } catch { } }
  if ($locked) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
