# ==============================================================================
# Script de Compilacion Legacy - American POS (Windows 7 / 8.1)
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "     AMERICAN POS - LEGACY BUILD PIPELINE (Windows 7/8.1)             " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$BackendDir = $PSScriptRoot

Write-Host "`n[1/6] Limpiando temporales y respaldando configuracion..." -ForegroundColor Yellow
$InstallerDist = Join-Path $BackendDir "dist_legacy_installer"
if (Test-Path $InstallerDist) {
    Write-Host "-> Removiendo dist_legacy_installer anterior..." -ForegroundColor Gray
    Remove-Item -Path "$InstallerDist\*" -Recurse -Force -ErrorAction SilentlyContinue
}
$PackagePath = Join-Path $BackendDir "package.json"
$BackupPath = Join-Path $BackendDir "package.json.bak"
Copy-Item -Path $PackagePath -Destination $BackupPath -Force

try {
    Write-Host "`n[2/6] Configurando Electron 22 (Legacy) al vuelo..." -ForegroundColor Yellow
    $content = Get-Content -Raw $PackagePath
    $content = $content -replace '"electron": "\^28\.3\.3"', '"electron": "22.3.27"'
    $content = $content -replace '"productName": "American POS"', '"productName": "American POS Legacy"'
    $content = $content -replace '"output": "dist_final_installer"', '"output": "dist_legacy_installer"'
    $utf8NoBom = New-Object System.Text.UTF8Encoding $False
    [System.IO.File]::WriteAllText($PackagePath, $content, $utf8NoBom)

    Write-Host "`n[3/6] Instalando dependencias legacy..." -ForegroundColor Yellow
    $ElectronModPath = Join-Path $BackendDir "node_modules\electron"
    if (Test-Path $ElectronModPath) {
        Remove-Item -Path $ElectronModPath -Recurse -Force
    }
    npm install --no-audit --no-fund

    Write-Host "`n[4/6] Recompilando dependencias nativas de C++ (SQLite3) para Electron 22..." -ForegroundColor Yellow
    npx electron-rebuild -v 22.3.27 --only sqlite3 --force

    Write-Host "`n[5/6] Empaquetando la aplicacion Legacy con Electron-Builder..." -ForegroundColor Yellow
    npm run dist
    
    $InstallerDir = Join-Path $BackendDir "dist_legacy_installer"
    Write-Host "`n======================================================================" -ForegroundColor Green
    Write-Host "PROCESO DE DISTRIBUCION LEGACY COMPLETADO CON EXITO!" -ForegroundColor Green
    Write-Host "Directory: $InstallerDir" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Green

} catch {
    Write-Host "Error fatal en proceso Legacy: $_" -ForegroundColor Red
} finally {
    Write-Host "`n[6/6] Restaurando entorno moderno (Electron 28)..." -ForegroundColor Yellow
    Copy-Item -Path $BackupPath -Destination $PackagePath -Force
    Remove-Item -Path $BackupPath -Force
    
    $ElectronModPath = Join-Path $BackendDir "node_modules\electron"
    if (Test-Path $ElectronModPath) {
        Remove-Item -Path $ElectronModPath -Recurse -Force
    }
    npm install --no-audit --no-fund
    
    npx electron-rebuild -v 28.3.3 --only sqlite3 --force
    Write-Host "Entorno moderno restaurado correctamente." -ForegroundColor Green
}
