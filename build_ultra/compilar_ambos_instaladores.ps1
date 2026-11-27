# ISAAC POS - Script de compilacion de instaladores comerciales
# Genera:
#   1. dist_installers\1_IsaacPOS_Servidor_Principal_Setup.exe
#   2. dist_installers\2_IsaacPOS_Caja_Terminal_Setup.exe
#   3. dist_installers\Isaac-POS-Ultra-Setup.exe
param(
    [ValidateSet('legacy', 'modern')]
    [string]$Engine = 'modern'
)

$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$projectRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$src = Join-Path $projectRoot "american-pos-backend"
$appFiles = Join-Path $scriptDir "app_files"
$distDir = Join-Path $projectRoot "dist_installers"

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

$nsisExe = Find-MakeNsis

if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

# Cerrar únicamente procesos provenientes del árbol de compilación del proyecto (preservar instancias instaladas del usuario en AppData)
Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and (
        $_.Path.StartsWith($src, [System.StringComparison]::OrdinalIgnoreCase) -or
        $_.Path.StartsWith($appFiles, [System.StringComparison]::OrdinalIgnoreCase)
    )
} | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

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
    Write-Error "No se encontro el directorio win-unpacked generado por electron-builder en: $unpackedDir"
    exit 1
}

Write-Host "Paso 2: Sincronizando paquete Electron y scripts hacia app_files..." -ForegroundColor Cyan
if (!(Test-Path $appFiles)) {
    New-Item -ItemType Directory -Path $appFiles -Force | Out-Null
}

# Limpiar archivos obsoletos previos de app_files
Get-ChildItem -Path $appFiles | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Copiar todo el paquete Electron (ya incluye resources\scripts desde extraResources sin duplicar en app.asar)
Copy-Item -Path "$unpackedDir\*" -Destination $appFiles -Recurse -Force

# Seguridad: limpiar archivos sensibles o locales antes de empaquetar NSIS (preservando resources\mobile-ota\Isaac-POS-Mobile.apk).
foreach ($pat in @('.env', '.env.*', 'settings.json', 'db-config.json', '.dbcfg.key.dpapi', 'secrets.vault.json', '*.vault.json', '.secrets.key.dpapi', '.*.key.dpapi', 'cloud_mirror_config.json', 'cloud_license_config.json', 'cert.pfx', '*.pfx', '*.p12', '*.key', '*private*.pem', '*.sqlite*', 'audit_*.json')) {
    Get-ChildItem -Path $appFiles -Filter $pat -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -Path $appFiles -Filter '*.apk' -Recurse -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notlike '*\resources\mobile-ota\Isaac-POS-Mobile.apk'
} | Remove-Item -Force -ErrorAction SilentlyContinue
foreach ($dirName in @('.wwebjs_auth', '.wwebjs_cache', '.test_wwebjs_auth', 'auto-backups', 'invoices', 'product_images', 'scratch', 'private', 'tests')) {
    Get-ChildItem -Path $appFiles -Filter $dirName -Directory -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Paso 3: Compilando 1_IsaacPOS_Servidor_Principal_Setup.exe..." -ForegroundColor Yellow
$serverNsi = Join-Path $scriptDir "installer_server.nsi"
& $nsisExe /INPUTCHARSET UTF8 "/DPROJECT_ROOT=$projectRoot" $serverNsi
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo durante la compilacion del instalador del Servidor Principal."
    exit 1
}

Write-Host "Paso 4: Compilando 2_IsaacPOS_Caja_Terminal_Setup.exe..." -ForegroundColor Green
$terminalNsi = Join-Path $scriptDir "installer_terminal.nsi"
& $nsisExe /INPUTCHARSET UTF8 "/DPROJECT_ROOT=$projectRoot" $terminalNsi
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo durante la compilacion del instalador de la Caja Terminal."
    exit 1
}

Write-Host "Paso 5: Compilando Isaac-POS-Ultra-Setup.exe..." -ForegroundColor Magenta
$ultraNsi = Join-Path $scriptDir "installer_ultra.nsi"
& $nsisExe /INPUTCHARSET UTF8 "/DPROJECT_ROOT=$projectRoot" $ultraNsi
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo durante la compilacion del instalador Ultra."
    exit 1
}

Write-Host "Paso 6: Verificando instaladores finales en $distDir..." -ForegroundColor Cyan
$generatedExes = Get-ChildItem -Path $distDir -Filter "*Setup.exe"
if ($env:REQUIRE_AUTHENTICODE_SIGNATURE -eq 'true') {
    foreach ($exe in $generatedExes) {
        $sig = Get-AuthenticodeSignature -FilePath $exe.FullName -ErrorAction SilentlyContinue
        if (-not $sig -or $sig.Status -ne 'Valid') {
            Write-Error "REQUIRE_AUTHENTICODE_SIGNATURE=true: falta firma Authenticode en $($exe.Name) (configure CSC_LINK o Azure Trusted Signing)."
            exit 1
        }
    }
}

Write-Host "COMPILACION EXITOSA DE TODOS LOS INSTALADORES" -ForegroundColor Green
$generatedExes | Select-Object Name, Length, LastWriteTime
