<#
Levanta GitSight (backend en :8000 y frontend en :5173) con un solo comando en Windows.

  .\start.ps1                 instala lo que falte, arranca todo y abre el navegador
  .\start.ps1 -NoBrowser      igual, pero sin abrir el navegador
  .\start.ps1 -InstallOnly    solo comprueba requisitos e instala dependencias

La primera vez crea el entorno virtual de Python e instala las dependencias (puede tardar unos
minutos). Las veces siguientes solo reinstala si cambiaron los archivos de dependencias.
Lo mas comodo es hacer doble clic en start.bat.
#>
param(
    [switch]$NoBrowser,
    [switch]$InstallOnly
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$BackendPort = 8000
$FrontendPort = 5173
$MinPython = '3.12'
$MinNode = '22.18'
$Url = "http://localhost:${FrontendPort}"
$LogDir = Join-Path $PSScriptRoot '.tid-logs'

function Say($text)  { Write-Host $text -ForegroundColor Cyan }
function Ok($text)   { Write-Host "[ok] ${text}" -ForegroundColor Green }
function Warn($text) { Write-Host "[!] ${text}" -ForegroundColor Yellow }
function Fail($text) { Write-Host "[x] ${text}" -ForegroundColor Red; exit 1 }

# --- 1. Requisitos ---------------------------------------------------------------------------

Say 'Comprobando requisitos...'

function Find-Python {
    $candidates = @(@('py', '-3.13'), @('py', '-3.12'), @('python3'), @('python'))
    foreach ($c in $candidates) {
        if (-not (Get-Command $c[0] -ErrorAction SilentlyContinue)) { continue }
        $extra = @()
        if ($c.Length -gt 1) { $extra = $c[1..($c.Length - 1)] }
        try {
            & $c[0] @extra -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>$null
            if ($LASTEXITCODE -eq 0) { return , @($c[0]) + $extra }
        } catch { }
    }
    return $null
}

$py = Find-Python
if (-not $py) { Fail "Falta Python ${MinPython} o superior. Instalalo desde https://www.python.org/downloads/ (marca 'Add python.exe to PATH') y vuelve a ejecutar." }
$pyExe = $py[0]
$pyArgs = @()
if ($py.Length -gt 1) { $pyArgs = $py[1..($py.Length - 1)] }
Ok ("Python: " + (& $pyExe @pyArgs --version 2>&1))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Falta Node.js ${MinNode} o superior. Instalalo desde https://nodejs.org/ (version LTS) y vuelve a ejecutar." }
$nodeVersion = (& node --version).TrimStart('v')
$nodeParts = $nodeVersion.Split('.') | ForEach-Object { [int]$_ }
$minParts = $MinNode.Split('.') | ForEach-Object { [int]$_ }
$nodeOk = ($nodeParts[0] -gt $minParts[0]) -or (($nodeParts[0] -eq $minParts[0]) -and ($nodeParts[1] -ge $minParts[1]))
if (-not $nodeOk) { Fail "Tu Node.js es v${nodeVersion} y se necesita ${MinNode} o superior. Actualizalo desde https://nodejs.org/ (version LTS)." }
Ok "Node.js: v${nodeVersion}"

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { Fail 'Falta npm (viene con Node.js). Reinstala Node.js desde https://nodejs.org/.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'Falta git, que se usa para descargar los repositorios de los estudiantes. Instalalo desde https://git-scm.com/downloads.' }
Ok ("git: " + (& git --version))

# --- 2. Dependencias (solo si faltan o cambiaron) --------------------------------------------------

function Get-Stamp($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
function Read-Stamp($path) { if (Test-Path -LiteralPath $path) { (Get-Content -LiteralPath $path -Raw).Trim() } else { '' } }

$venvPython = Join-Path $PSScriptRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    Say 'Creando el entorno virtual de Python (solo la primera vez)...'
    & $pyExe @pyArgs -m venv (Join-Path $PSScriptRoot 'backend\.venv')
    if ($LASTEXITCODE -ne 0) { Fail 'No se pudo crear el entorno virtual de Python.' }
}
$reqStamp = Get-Stamp (Join-Path $PSScriptRoot 'backend\requirements.txt')
$reqStampFile = Join-Path $PSScriptRoot 'backend\.venv\.tid-requirements'
if ((Read-Stamp $reqStampFile) -ne $reqStamp) {
    Say 'Instalando las dependencias del backend (puede tardar unos minutos)...'
    & $venvPython -m pip install --quiet --upgrade pip
    & $venvPython -m pip install --quiet -r (Join-Path $PSScriptRoot 'backend\requirements.txt')
    if ($LASTEXITCODE -ne 0) { Fail 'No se pudieron instalar las dependencias del backend. Revisa tu conexion a internet.' }
    Set-Content -LiteralPath $reqStampFile -Value $reqStamp -NoNewline
}
Ok 'Backend listo'

$lockStamp = Get-Stamp (Join-Path $PSScriptRoot 'frontend\package-lock.json')
$nodeModules = Join-Path $PSScriptRoot 'frontend\node_modules'
$lockStampFile = Join-Path $nodeModules '.tid-lock'
if ((-not (Test-Path -LiteralPath $nodeModules)) -or ((Read-Stamp $lockStampFile) -ne $lockStamp)) {
    Say 'Instalando las dependencias del frontend (puede tardar unos minutos)...'
    Push-Location (Join-Path $PSScriptRoot 'frontend')
    try { & npm.cmd install --no-audit --no-fund --loglevel=error } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Fail 'No se pudieron instalar las dependencias del frontend. Revisa tu conexion a internet.' }
    Set-Content -LiteralPath $lockStampFile -Value $lockStamp -NoNewline
}
Ok 'Frontend listo'

if ($InstallOnly) { Say 'Dependencias instaladas. Para arrancar: .\start.ps1'; exit 0 }

# --- 3. Puertos --------------------------------------------------------------------------------------

function Ensure-PortFree([int]$port, [string]$what) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { return }
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    Warn "El puerto ${port} (${what}) ya esta en uso por:"
    foreach ($p in $pids) {
        $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
        Write-Host ("    PID {0}  {1}" -f $p, $(if ($proc) { $proc.ProcessName } else { '?' }))
    }
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $answer = Read-Host 'Quieres cerrarlo para continuar? [s/N]'
        if ($answer -match '^(s|si|y|yes)$') {
            foreach ($p in $pids) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 2
            if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { return }
            Fail "No se pudo liberar el puerto ${port}. Cierra el programa a mano y vuelve a ejecutar."
        }
    }
    Fail "Libera el puerto ${port} (cierra ese programa) y vuelve a ejecutar start.bat."
}

Ensure-PortFree $BackendPort 'backend'
Ensure-PortFree $FrontendPort 'frontend'

# --- 4. Arranque -----------------------------------------------------------------------------------

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$back = $null
$front = $null

function Stop-Tree($proc) {
    if ($proc -and -not $proc.HasExited) { & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null }
}

try {
    Say "Arrancando el backend en el puerto ${BackendPort}..."
    $back = Start-Process -FilePath $venvPython -PassThru -NoNewWindow `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', "${BackendPort}") `
        -RedirectStandardOutput (Join-Path $LogDir 'backend.log') -RedirectStandardError (Join-Path $LogDir 'backend.err.log')

    Say "Arrancando el frontend en el puerto ${FrontendPort}..."
    $front = Start-Process -FilePath 'npm.cmd' -PassThru -NoNewWindow -WorkingDirectory (Join-Path $PSScriptRoot 'frontend') `
        -ArgumentList @('run', 'dev', '--', '--port', "${FrontendPort}", '--strictPort') `
        -RedirectStandardOutput (Join-Path $LogDir 'frontend.log') -RedirectStandardError (Join-Path $LogDir 'frontend.err.log')

    function Wait-For($uri, $name, $proc, $log) {
        for ($i = 0; $i -lt 120; $i++) {
            try {
                Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 2 | Out-Null
                return
            } catch { }
            if ($proc.HasExited) {
                Warn "${name} se cerro al arrancar. Ultimas lineas de ${log} y su .err.log:"
                foreach ($f in @($log, ($log -replace '\.log$', '.err.log'))) {
                    if (Test-Path -LiteralPath $f) { Get-Content -LiteralPath $f -Tail 15 }
                }
                throw "${name} no arranco"
            }
            Start-Sleep -Milliseconds 500
        }
        throw "${name} no respondio en 60 segundos. Revisa la carpeta .tid-logs"
    }
    Wait-For "http://127.0.0.1:${BackendPort}/api/health" 'El backend' $back (Join-Path $LogDir 'backend.log')
    Wait-For $Url 'El frontend' $front (Join-Path $LogDir 'frontend.log')

    Write-Host ''
    Say "GitSight esta listo:  ${Url}"
    Write-Host '  Para cerrarlo, presiona Ctrl+C en esta ventana (o cierrala).'
    Write-Host '  Registros: carpeta .tid-logs'

    if (-not $NoBrowser) { Start-Process $Url }

    while (-not $back.HasExited -and -not $front.HasExited) { Start-Sleep -Seconds 1 }
    Warn 'Uno de los servidores se detuvo. Revisa la carpeta .tid-logs.'
}
catch {
    Write-Host "[x] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Write-Host ''
    Say 'Cerrando GitSight...'
    Stop-Tree $front
    Stop-Tree $back
}
