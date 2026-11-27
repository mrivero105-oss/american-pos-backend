# ==============================================================================
# ISAAC POS - Compilador de Instalador Especial para Windows 7, 8 y 8.1
# ==============================================================================
# Genera:
#   dist_installers\3_IsaacPOS_Windows7_8_8.1_Setup.exe
#   3_IsaacPOS_Windows7_8_8.1_Setup.exe (en la raíz del proyecto)
#
# Motor: Electron 22.3.27 (Chromium 108 + Node.js 16.17.1 embebidos)
# Base de datos: PostgreSQL 16 (Servidor Local o modo Caja Terminal LAN)
# ==============================================================================

$ErrorActionPreference = "Stop"

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\AndroidStudioProjects\American POS PC" }
$backendDir = "$rootDir\american-pos-backend"
$distDir = "$rootDir\dist_installers"
$installerName = "3_IsaacPOS_Windows7_8_8.1_Setup.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   ISAAC POS - Compilador Windows 7 / 8 / 8.1 (Legacy)   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Asegurar directorio de destino
if (!(Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
}

# 2. Limpiar instaladores previos en dist_final_installer
Write-Host "`n[1/3] Limpiando artefactos previos de electron-builder..." -ForegroundColor Yellow
if (Test-Path "$backendDir\dist_final_installer") {
    Remove-Item "$backendDir\dist_final_installer\*.exe" -Force -ErrorAction SilentlyContinue
    Remove-Item "$backendDir\dist_final_installer\*.blockmap" -Force -ErrorAction SilentlyContinue
}

# 3. Compilar instalador NSIS con electron-builder
Write-Host "`n[2/3] Compilando instalador NSIS con motor Electron 22.3.27..." -ForegroundColor Yellow
Push-Location $backendDir
try {
    cmd.exe /c "npx electron-builder --config electron-builder.legacy.json --win nsis"
    if ($LASTEXITCODE -ne 0 -and !(Test-Path "$backendDir\dist_final_installer\$installerName")) {
        Write-Error "Fallo durante la compilacion con electron-builder."
        exit 1
    }
} finally {
    Pop-Location
}

# 4. Distribuir unicamente hacia dist_installers y validar firma Authenticode si aplica
Write-Host "`n[3/3] Distribuyendo archivo instalador final en dist_installers..." -ForegroundColor Yellow
$builtInstaller = "$backendDir\dist_final_installer\$installerName"
if (Test-Path $builtInstaller) {
    $targetExe = "$distDir\$installerName"
    Copy-Item $builtInstaller $targetExe -Force

    $sig = Get-AuthenticodeSignature -FilePath $targetExe -ErrorAction SilentlyContinue
    if ($env:REQUIRE_AUTHENTICODE_SIGNATURE -eq "true" -and (-not $sig -or $sig.Status -ne "Valid")) {
        Write-Error "REQUIRE_AUTHENTICODE_SIGNATURE=true: el instalador $targetExe no posee firma Authenticode valida ($($sig.Status)). Configure CSC_LINK o Azure Trusted Signing."
        exit 1
    }

    $sizeMb = [math]::Round((Get-Item $targetExe).Length / 1MB, 2)
    $sigLabel = if ($sig -and $sig.Status -eq "Valid") { "FIRMADA ($($sig.SignerCertificate.Subject))" } else { "Sin firma Authenticode local (configure CSC_LINK / Trusted Signing en release)" }
    Write-Host "`n==========================================================" -ForegroundColor Green
    Write-Host "   COMPILACION EXITOSA PARA WINDOWS 7 / 8 / 8.1           " -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "Archivo generado : $installerName" -ForegroundColor White
    Write-Host "Tamano           : $sizeMb MB" -ForegroundColor White
    Write-Host "Ubicacion        : $targetExe" -ForegroundColor White
    Write-Host "Firma Digital    : $sigLabel" -ForegroundColor White
    Write-Host "Compatibilidad   : Windows 7 SP1 (x64), Windows 8 (x64), Windows 8.1 (x64)" -ForegroundColor White
    Write-Host "==========================================================`n" -ForegroundColor Green
} else {
    Write-Error "No se encontro el instalador generado en: $builtInstaller"
    exit 1
}
