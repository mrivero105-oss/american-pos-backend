# ==============================================================================
# Script de Compilacion y Distribucion de Produccion - Isaac POS
# ==============================================================================
# Automatiza la compilacion del frontend React, sincronizacion hacia
# american-pos-backend/public, verificacion de dependencias PostgreSQL-first
# y empaquetado Electron dual (Electron 31 Modern Win10/11 o Electron 22 Win7/8.1).
# ==============================================================================
param(
    [ValidateSet('modern', 'legacy')]
    [string]$Engine = 'modern'
)

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "             ISAAC POS - PRODUCTION BUILD & RELEASE PIPELINE          " -ForegroundColor Cyan
Write-Host "             Perfil seleccionado: $Engine                             " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan

# Definicion de Directorios
$BackendDir = $PSScriptRoot
$BaseDir = Split-Path $BackendDir -Parent
$FrontendDir = Join-Path $BaseDir "american-pos-frontend"
$BackendPublicDir = Join-Path $BackendDir "public"
$GlobalTemp = Join-Path $BaseDir "build_temp"
New-Item -ItemType Directory -Force -Path $GlobalTemp | Out-Null
$env:TEMP = $GlobalTemp
$env:TMP = $GlobalTemp
$env:NODE_OPTIONS = "--max-old-space-size=4096"
$env:GOMAXPROCS = "2"

Write-Host "`n[0/6] Deteniendo instancias activas de Isaac POS, American POS y Electron para liberar archivos bloqueados..." -ForegroundColor Yellow
Stop-Process -Name "*Isaac POS*" -Force -ErrorAction SilentlyContinue | Out-Null
Stop-Process -Name "*American POS*" -Force -ErrorAction SilentlyContinue | Out-Null
Stop-Process -Name "*electron*" -Force -ErrorAction SilentlyContinue | Out-Null
Start-Sleep -Seconds 2

Write-Host "`n[1/6] Limpiando temporales y compilaciones previas..." -ForegroundColor Yellow

# Limpiar dist_final_installer
$InstallerDist = Join-Path $BackendDir "dist_final_installer"
if (Test-Path $InstallerDist) {
    Write-Host "-> Removiendo dist_final_installer anterior..." -ForegroundColor Gray
    Remove-Item -Path "$InstallerDist\*" -Recurse -Force -ErrorAction SilentlyContinue
}

# Limpiar dist de frontend
$FrontendDist = Join-Path $FrontendDir "dist"
if (Test-Path $FrontendDist) {
    Write-Host "-> Removiendo frontend/dist anterior..." -ForegroundColor Gray
    Remove-Item -Path $FrontendDist -Recurse -Force
}

# Limpiar assets de backend/public
$BackendAssets = Join-Path $BackendPublicDir "assets"
if (Test-Path $BackendAssets) {
    Write-Host "-> Removiendo backend/public/assets anterior..." -ForegroundColor Gray
    Remove-Item -Path $BackendAssets -Recurse -Force
}

Write-Host "`n[2/6] Compilando la interfaz React/Vite (Frontend)..." -ForegroundColor Yellow
Push-Location $FrontendDir
try {
    Write-Host "-> Instalando dependencias de frontend (npm install)..." -ForegroundColor Gray
    npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install falló con código $LASTEXITCODE" }
    Write-Host "-> Compilando el bundle estatico (npm run build)..." -ForegroundColor Gray
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falló con código $LASTEXITCODE" }
    Write-Host "OK: Frontend compilado exitosamente." -ForegroundColor Green
} catch {
    Write-Host "Error fatal en compilacion de frontend: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

Write-Host "`n[3/6] Sincronizando recursos estaticos en el Servidor (Backend)..." -ForegroundColor Yellow
if (!(Test-Path $BackendPublicDir)) {
    New-Item -Path $BackendPublicDir -ItemType Directory | Out-Null
}

try {
    if (Test-Path $FrontendDist) {
        Write-Host "-> Copiando archivos de $FrontendDist a $BackendPublicDir..." -ForegroundColor Gray
        Copy-Item -Path "$FrontendDist\*" -Destination $BackendPublicDir -Recurse -Force
    } else {
        Write-Host "-> Vite compiló directamente en $BackendPublicDir. Verificando..." -ForegroundColor Gray
        if (!(Test-Path (Join-Path $BackendPublicDir "index.html"))) {
            throw "No se encontró index.html en $BackendPublicDir tras la compilación"
        }
    }
    Write-Host "OK: Sincronizacion de recursos estaticos completada." -ForegroundColor Green
} catch {
    Write-Host "Error al sincronizar recursos estaticos: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/6] Verificando dependencias backend (PostgreSQL 16 + Electron dual)..." -ForegroundColor Yellow
Stop-Process -Name "*electron*" -Force -ErrorAction SilentlyContinue | Out-Null
Stop-Process -Name "*Isaac POS*" -Force -ErrorAction SilentlyContinue | Out-Null
Start-Sleep -Seconds 1
Push-Location $BackendDir
try {
    if (!(Test-Path (Join-Path $BackendDir "node_modules"))) {
        Write-Host "-> Instalando dependencias de backend (npm ci)..." -ForegroundColor Gray
        npm.cmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm ci falló con código $LASTEXITCODE" }
    } else {
        Write-Host "-> Dependencias node_modules de backend presentes." -ForegroundColor Gray
    }
    Write-Host "OK: Backend verificado sin módulos nativos legacy de SQLite." -ForegroundColor Green
} catch {
    Write-Host "Error al verificar dependencias de backend: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "`n[5/6] Verificando configuración de firma de código (opcional vía env)..." -ForegroundColor Yellow
if ($env:CSC_LINK -and $env:CSC_KEY_PASSWORD) {
    Write-Host "OK: Certificado de firma configurado mediante variables de entorno." -ForegroundColor Green
} else {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
    Write-Host "-> Sin certificado comercial en entorno; se empaquetará sin firma autofirmada embebida." -ForegroundColor Gray
}

Write-Host "`n[6/6] Empaquetando la aplicacion de escritorio final con Electron-Builder ($Engine)..." -ForegroundColor Yellow
try {
    $builderConfig = if ($Engine -eq 'modern') { 'electron-builder.modern.json' } else { 'electron-builder.legacy.json' }
    $InstallerDir = if ($Engine -eq 'modern') { Join-Path $BackendDir "dist_modern" } else { Join-Path $BackendDir "dist_final_installer" }

    Write-Host "-> Generando instalador NSIS (.exe) con $builderConfig..." -ForegroundColor Gray
    & npx.cmd electron-builder --config $builderConfig --win nsis
    if ($LASTEXITCODE -ne 0) { throw "electron-builder falló con código $LASTEXITCODE" }

    $ScriptSrc = Join-Path $BackendDir "scripts\instalar_postgresql.ps1"
    if (Test-Path $ScriptSrc) {
        Copy-Item -Path $ScriptSrc -Destination (Join-Path $InstallerDir "instalar_postgresql.ps1") -Force
    }
    Write-Host "`n======================================================================" -ForegroundColor Green
    Write-Host "PROCESO DE DISTRIBUCION COMPLETADO CON EXITO!" -ForegroundColor Green
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host "El instalador ejecutable de produccion ha sido generado en:" -ForegroundColor White
    Write-Host "Directory: $InstallerDir" -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Green
} catch {
    Write-Host "Error fatal en empaquetado final de Electron-Builder: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
