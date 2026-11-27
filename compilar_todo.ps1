# ==============================================================================
# ISAAC POS - PIPELINE MAESTRO DE COMPILACION Y GENERACION DE INSTALADORES
# ==============================================================================
$ErrorActionPreference = "Stop"

$rootDir = if ($PSScriptRoot) { $PSScriptRoot } else { "C:\AndroidStudioProjects\American POS PC" }
$frontendDir = "$rootDir\american-pos-frontend"
$backendDir = "$rootDir\american-pos-backend"
$distDir = "$rootDir\dist_installers"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   ISAAC POS - PIPELINE COMPLETO DE INSTALADORES         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Compilar Frontend (React + Vite)
Write-Host "`n>>> [1/5] Compilando Frontend (React/Vite)..." -ForegroundColor Yellow
Push-Location $frontendDir
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build fallo con codigo $LASTEXITCODE" }
    Write-Host "OK: Frontend compilado y sincronizado a backend/public." -ForegroundColor Green
} finally {
    Pop-Location
}

# 2. Compilar Instaladores Principales (Servidor, Terminal, Ultra) con motor Moderno (Electron 45)
Write-Host "`n>>> [2/5] Generando Instaladores Principales (Servidor, Terminal, Ultra)..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$rootDir\build_ultra\compilar_ambos_instaladores.ps1" -Engine modern
if ($LASTEXITCODE -ne 0) { throw "compilar_ambos_instaladores fallo con codigo $LASTEXITCODE" }

# 3. Compilar Instalador Legacy (Windows 7 / 8 / 8.1)
Write-Host "`n>>> [3/5] Generando Instalador Windows 7 / 8 / 8.1 (Legacy)..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$rootDir\compilar_instalador_win7_8.ps1"
if ($LASTEXITCODE -ne 0) { throw "compilar_instalador_win7_8 fallo con codigo $LASTEXITCODE" }

# 4. Compilar Instalador Moderno (Windows 10 / 11 - Electron 45)
Write-Host "`n>>> [4/5] Generando Instalador Windows 10 / 11 (Moderno - Electron 45)..." -ForegroundColor Yellow
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$rootDir\compilar_instalador_moderno_win10_11.ps1"
if ($LASTEXITCODE -ne 0) { throw "compilar_instalador_moderno_win10_11 fallo con codigo $LASTEXITCODE" }

# 5. Sincronizar app.asar hacia instalacion local
Write-Host "`n>>> [5/5] Sincronizando paquete app.asar a instalacion local..." -ForegroundColor Yellow
$localInstallDir = "$env:LOCALAPPDATA\Programs\Isaac POS Ultra\resources"
if (Test-Path $localInstallDir) {
    Copy-Item "$rootDir\build_ultra\app_files\resources\app.asar" "$localInstallDir\app.asar" -Force -ErrorAction SilentlyContinue
    Write-Host "OK: app.asar sincronizado a $localInstallDir." -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "   TODOS LOS INSTALADORES GENERADOS EXITOSAMENTE         " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Get-ChildItem -Path $distDir -Filter "*Setup.exe" | Format-Table Name, Length, LastWriteTime
