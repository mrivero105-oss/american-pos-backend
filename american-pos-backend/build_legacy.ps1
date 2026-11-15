# ==============================================================================
# Script de Compilacion Legacy - Isaac POS (Windows 7 / 8 / 8.1)
# Motor: Electron 22.3.27 (Chromium 108 + Node.js 16.17.1 embebidos)
# ==============================================================================
param(
    [ValidateSet('x64', 'ia32', 'all')]
    [string]$Arch = 'x64'
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "       ISAAC POS - LEGACY BUILD PIPELINE (Windows 7 / 8 / 8.1)        " -ForegroundColor Cyan
Write-Host "       Motor: Electron 22.3.27 | Arquitectura: $Arch                  " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

$BackendDir = $PSScriptRoot
$BaseDir = Split-Path $BackendDir -Parent
$FrontendDir = Join-Path $BaseDir "american-pos-frontend"
$InstallerDist = Join-Path $BackendDir "dist_final_installer"

Write-Host "`n[1/4] Limpiando artefactos previos en dist_final_installer..." -ForegroundColor Yellow
if (Test-Path $InstallerDist) {
    Remove-Item -Path "$InstallerDist\*.exe" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$InstallerDist\*.blockmap" -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$InstallerDist\win-unpacked" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "$InstallerDist\win-ia32-unpacked" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`n[2/4] Verificando bundle frontend compilado para Chromium 108..." -ForegroundColor Yellow
Push-Location $FrontendDir
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build en frontend fallo con codigo $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "`n[3/4] Verificando dependencias backend..." -ForegroundColor Yellow
Push-Location $BackendDir
try {
    if (!(Test-Path (Join-Path $BackendDir "node_modules"))) {
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci en backend fallo con codigo $LASTEXITCODE" }
    }

    Write-Host "`n[4/4] Empaquetando instalador Legacy con electron-builder.legacy.json..." -ForegroundColor Yellow
    $archArgs = @('--config', 'electron-builder.legacy.json', '--win', 'nsis')
    if ($Arch -eq 'x64') { $archArgs += '--x64' }
    elseif ($Arch -eq 'ia32') { $archArgs += '--ia32' }
    else { $archArgs += @('--x64', '--ia32') }

    & npx.cmd electron-builder @archArgs
    if ($LASTEXITCODE -ne 0) { throw "electron-builder (legacy) fallo con codigo $LASTEXITCODE" }

    Write-Host "`n======================================================================" -ForegroundColor Green
    Write-Host "PROCESO DE DISTRIBUCION LEGACY COMPLETADO CON EXITO!" -ForegroundColor Green
    Write-Host "Directorio: $InstallerDist" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Green
} finally {
    Pop-Location
}
