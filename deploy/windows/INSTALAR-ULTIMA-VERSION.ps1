# ============================================================
#  WILLY AI — Instalador de la última versión
#  Descarga e instala siempre el instalador más reciente
#  publicado en GitHub (murelf87/willy-AI).
#
#  Uso:  Doble clic en INSTALAR-ULTIMA-VERSION.bat
#        (o: powershell -ExecutionPolicy Bypass -File INSTALAR-ULTIMA-VERSION.ps1)
# ============================================================

$ErrorActionPreference = "Stop"
$ProgressPreference    = "SilentlyContinue"   # más rápido

$REPO = "murelf87/willy-AI"
$API  = "https://api.github.com/repos/$REPO/releases/latest"
$TMP  = Join-Path $env:TEMP "willy-install"

# ──────────────────────────────────────────────────────────────
# Cabecera
# ──────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        WILLY AI — Última versión         ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ──────────────────────────────────────────────────────────────
# 1. Consultar la última versión en GitHub
# ──────────────────────────────────────────────────────────────
Write-Host "  [1/4] Consultando la última versión disponible..." -ForegroundColor Yellow
try {
    $headers = @{ "User-Agent" = "WILLY-AI-Installer/1.0" }
    $release = Invoke-RestMethod -Uri $API -Headers $headers -TimeoutSec 30
} catch {
    Write-Host ""
    Write-Host "  [ERROR] No se pudo conectar con GitHub." -ForegroundColor Red
    Write-Host "          Comprueba tu conexión a Internet e inténtalo de nuevo." -ForegroundColor Red
    Write-Host ""
    Read-Host "  Pulsa Enter para cerrar"
    exit 1
}

$version = $release.tag_name -replace '^v',''
Write-Host "         Versión disponible: $($release.tag_name)" -ForegroundColor Green

# Buscar el .exe en los assets del release
$asset = $release.assets | Where-Object { $_.name -like "WillyAI-Setup-*.exe" } | Select-Object -First 1
if (-not $asset) {
    # Si no hay exe en releases, construir URL directa desde el repositorio
    Write-Host ""
    Write-Host "  [AVISO] No se encontró instalador publicado en este release." -ForegroundColor Yellow
    Write-Host "          Intentando obtener el instalador desde el repositorio..." -ForegroundColor Yellow
    # Fallback: buscar en la rama main
    $downloadUrl = "https://github.com/$REPO/raw/main/WillyAI-Setup-$version.exe"
    $fileName    = "WillyAI-Setup-$version.exe"
} else {
    $downloadUrl = $asset.browser_download_url
    $fileName    = $asset.name
}

# ──────────────────────────────────────────────────────────────
# 2. Comprobar si ya tenemos esta versión instalada
# ──────────────────────────────────────────────────────────────
$installDir     = Join-Path $env:LOCALAPPDATA "Programs\WILLY AI"
$versionFile    = Join-Path $installDir "resources\app\src\lib\version.ts"
$installedVer   = $null

if (Test-Path $versionFile) {
    $verContent   = Get-Content $versionFile -Raw
    $verMatch     = [regex]::Match($verContent, 'version\s*=\s*"([^"]+)"')
    if ($verMatch.Success) { $installedVer = $verMatch.Groups[1].Value }
}

if ($installedVer -and ($installedVer -eq $version)) {
    Write-Host ""
    Write-Host "  Ya tienes instalada la versión $version (la más reciente)." -ForegroundColor Green
    Write-Host "  No hay nada que actualizar." -ForegroundColor Green
    Write-Host ""
    Read-Host "  Pulsa Enter para cerrar"
    exit 0
}

if ($installedVer) {
    Write-Host "         Versión instalada:  $installedVer  →  se actualizará a $version" -ForegroundColor Cyan
} else {
    Write-Host "         WILLY AI no está instalado. Se instalará la versión $version." -ForegroundColor Cyan
}

Write-Host ""

# ──────────────────────────────────────────────────────────────
# 3. Descargar el instalador
# ──────────────────────────────────────────────────────────────
Write-Host "  [2/4] Descargando $fileName..." -ForegroundColor Yellow

if (-not (Test-Path $TMP)) { New-Item -ItemType Directory -Path $TMP | Out-Null }
$dest = Join-Path $TMP $fileName

try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("User-Agent", "WILLY-AI-Installer/1.0")

    $done = $false
    Register-ObjectEvent -InputObject $wc -EventName DownloadProgressChanged -Action {
        $pct = $Event.SourceEventArgs.ProgressPercentage
        $mb  = [math]::Round($Event.SourceEventArgs.BytesReceived / 1MB, 1)
        Write-Host -NoNewline "`r         $pct%  ($mb MB descargados)   "
    } | Out-Null

    $wc.DownloadFileAsync([uri]$downloadUrl, $dest)

    while ($wc.IsBusy) { Start-Sleep -Milliseconds 200 }
    Write-Host ""
    Write-Host "         Descarga completada." -ForegroundColor Green
} catch {
    # Fallback con Invoke-WebRequest si falla el WebClient
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $dest -UseBasicParsing -Headers @{"User-Agent"="WILLY-AI-Installer/1.0"}
        Write-Host "         Descarga completada." -ForegroundColor Green
    } catch {
        Write-Host ""
        Write-Host "  [ERROR] No se pudo descargar el instalador." -ForegroundColor Red
        Write-Host "          $_" -ForegroundColor Red
        Write-Host ""
        Read-Host "  Pulsa Enter para cerrar"
        exit 1
    }
}

if (-not (Test-Path $dest) -or (Get-Item $dest).Length -lt 1KB) {
    Write-Host "  [ERROR] El archivo descargado está vacío o no se guardó." -ForegroundColor Red
    Read-Host "  Pulsa Enter para cerrar"
    exit 1
}

# ──────────────────────────────────────────────────────────────
# 4. Ejecutar el instalador
# ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  [3/4] Lanzando el instalador de la versión $version..." -ForegroundColor Yellow
Write-Host "         (Sigue las instrucciones en pantalla)" -ForegroundColor White
Write-Host ""

Start-Process -FilePath $dest -Wait

Write-Host "  [4/4] Instalación completada." -ForegroundColor Green
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   WILLY AI $version instalado correctamente  ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Puedes arrancar WILLY AI desde el acceso directo del escritorio." -ForegroundColor White
Write-Host ""

# Limpiar el instalador descargado
try { Remove-Item $dest -Force } catch {}

Read-Host "  Pulsa Enter para cerrar"
