# ==============================================================================
# ISAAC POS - Compilador de Instalador Moderno para Windows 10 y 11
# ==============================================================================
# Genera:
#   dist_installers\4_IsaacPOS_Windows10_11_Modern_Setup.exe
#   4_IsaacPOS_Windows10_11_Modern_Setup.exe (en la raíz del proyecto)
#
# Motor: Electron 31.4.0 (Chromium 128 + Node.js 20 LTS embebidos)
# Características: Aceleración por hardware completa, DirectWrite y máxima seguridad
# ==============================================================================

$ErrorActionPreference = "Stop"

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\AndroidStudioProjects\American POS PC" }
$backendDir = "$rootDir\american-pos-backend"
$distDir = "$rootDir\dist_installers"
$installerName = "4_IsaacPOS_Windows10_11_Modern_Setup.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   ISAAC POS - Compilador Moderno (Windows 10 / 11)      " -ForegroundColor Cyan
Write-Host "   Motor: Electron 31.4.0 (Chromium 128 + Node 20 LTS)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Asegurar directorio de destino
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

# 2. Limpiar artefactos previos en dist_modern
Write-Host "`n[1/3] Limpiando artefactos previos de dist_modern..." -ForegroundColor Yellow
if (Test-Path "$backendDir\dist_modern") {
    Remove-Item "$backendDir\dist_modern\*.exe" -Force -ErrorAction SilentlyContinue
    Remove-Item "$backendDir\dist_modern\*.blockmap" -Force -ErrorAction SilentlyContinue
}

# 3. Compilar instalador NSIS con electron-builder apuntando a configuración moderna
Write-Host "`n[2/3] Compilando instalador NSIS con motor Electron 31.4.0..." -ForegroundColor Yellow
Push-Location $backendDir
try {
    cmd.exe /c "npx electron-builder --config electron-builder.modern.json"
    if ($LASTEXITCODE -ne 0 -and !(Test-Path "$backendDir\dist_modern\$installerName")) {
        Write-Error "Fallo durante la compilacion moderna con electron-builder."
        exit 1
    }
} finally {
    Pop-Location
}

# 4. Copiar instalador a dist_installers y a la raíz
Write-Host "`n[3/3] Distribuyendo archivo instalador final..." -ForegroundColor Yellow
$builtInstaller = "$backendDir\dist_modern\$installerName"
if (Test-Path $builtInstaller) {
    Copy-Item $builtInstaller "$distDir\$installerName" -Force
    Copy-Item $builtInstaller "$rootDir\$installerName" -Force

    $sizeMb = [math]::Round((Get-Item "$distDir\$installerName").Length / 1MB, 2)
    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "   COMPILACION EXITOSA PARA WINDOWS 10 Y 11 (MODERNO)    " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Archivo generado : $installerName" -ForegroundColor White
    Write-Host "Tamano           : $sizeMb MB" -ForegroundColor White
    Write-Host "Ubicacion 1      : $distDir\$installerName" -ForegroundColor White
    Write-Host "Ubicacion 2      : $rootDir\$installerName" -ForegroundColor White
    Write-Host "Compatibilidad   : Windows 10 (x64), Windows 11 (x64)" -ForegroundColor White
    Write-Host "Motor Embebido   : Electron 31.4.0 (Chromium 128 / Node 20 LTS)" -ForegroundColor White
    Write-Host "==========================================================`n" -ForegroundColor Green
} else {
    Write-Error "No se encontro el instalador generado en: $builtInstaller"
    exit 1
}
