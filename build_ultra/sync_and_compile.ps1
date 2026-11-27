# ==============================================================================
# Sincronización y Compilación Automática de Isaac POS Ultra
# Soporta perfil dual: legacy (Electron 22 Win7/8.1) o modern (Electron 31 Win10/11)
# ==============================================================================
param(
    [ValidateSet('legacy', 'modern')]
    [string]$Engine = 'modern',
    [switch]$SyncLocalInstall
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$src = Join-Path $projectRoot "american-pos-backend"
$appFiles = Join-Path $scriptDir "app_files"
$distDir = Join-Path $projectRoot "dist_installers"
$localProg = Join-Path $env:LOCALAPPDATA "Programs\Isaac POS Ultra"

if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

function Find-MakeNsis {
    $cacheRoot = Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis"
    if (Test-Path $cacheRoot) {
        $found = Get-ChildItem -Path $cacheRoot -Recurse -Filter "makensis.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    $cmd = Get-Command "makensis.exe" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $pf = Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe"
    if (Test-Path $pf) { return $pf }
    throw "No se encontro makensis.exe en Cache de electron-builder, PATH ni Program Files."
}

function Remove-SensitivePackagingFiles {
    param([string]$TargetDir)
    if (!(Test-Path $TargetDir)) { return }
    $patterns = @(
        '.env', '.env.*', 'settings.json', 'db-config.json', '.dbcfg.key.dpapi',
        'secrets.vault.json', '*.vault.json', '.secrets.key.dpapi', '.*.key.dpapi',
        'cloud_mirror_config.json', 'cert.pfx', '*.pfx', '*.p12', '*.key',
        '*private*.pem', '*.apk', '*.sqlite*'
    )
    foreach ($pat in $patterns) {
        Get-ChildItem -Path $TargetDir -Filter $pat -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }
    foreach ($dirName in @('.wwebjs_auth', '.wwebjs_cache', '.test_wwebjs_auth', 'auto-backups', 'invoices', 'product_images', 'scratch')) {
        Get-ChildItem -Path $TargetDir -Filter $dirName -Directory -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Paso 1: Empaquetando motor Electron ($Engine) con electron-builder..." -ForegroundColor Cyan
$builderConfig = if ($Engine -eq 'modern') { 'electron-builder.modern.json' } else { 'electron-builder.legacy.json' }
$unpackedBase = if ($Engine -eq 'modern') { 'dist_modern' } else { 'dist_final_installer' }

Push-Location $src
try {
    & npx.cmd electron-builder --config $builderConfig --dir
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fallo durante la compilacion de Electron ($Engine) con electron-builder."
        exit 1
    }
} finally {
    Pop-Location
}

$unpackedDir = Join-Path $src "$unpackedBase\win-unpacked"
if (!(Test-Path $unpackedDir)) {
    Write-Error "No se encontro el directorio win-unpacked generado en: $unpackedDir"
    exit 1
}

Write-Host "Paso 2: Sincronizando paquete Electron y scripts hacia app_files..." -ForegroundColor Cyan
if (!(Test-Path $appFiles)) {
    New-Item -ItemType Directory -Path $appFiles -Force | Out-Null
}

Get-ChildItem -Path $appFiles | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "$unpackedDir\*" -Destination $appFiles -Recurse -Force

if (!(Test-Path (Join-Path $appFiles "scripts"))) {
    New-Item -ItemType Directory -Path (Join-Path $appFiles "scripts") -Force | Out-Null
}
Copy-Item -Path (Join-Path $src "scripts\*") -Destination (Join-Path $appFiles "scripts") -Recurse -Force

# Seguridad: NUNCA copiar .env ni configuraciones locales de desarrollo al instalador.
Remove-SensitivePackagingFiles -TargetDir $appFiles

if ($SyncLocalInstall -and (Test-Path $localProg)) {
    Write-Host "Sincronizando hacia instalacion local en AppData..." -ForegroundColor Cyan
    Copy-Item -Path "$appFiles\*" -Destination $localProg -Recurse -Force
}

Write-Host "Paso 3: Compilando instalador NSIS..." -ForegroundColor Yellow
$nsisExe = Find-MakeNsis
$nsiScript = Join-Path $scriptDir "installer_ultra.nsi"

& $nsisExe /INPUTCHARSET UTF8 "/DPROJECT_ROOT=$projectRoot" $nsiScript
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo durante la compilacion de NSIS."
    exit 1
}

Write-Host "COMPLETADO CON EXITO ($Engine): dist_installers\Isaac-POS-Ultra-Setup.exe" -ForegroundColor Green
