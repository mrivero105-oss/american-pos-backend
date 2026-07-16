# ==============================================================================
# Script de Compilacion y Distribucion de Produccion - American POS
# ==============================================================================
# Este script automatiza la compilacion del frontend de React, la transferencia 
# de recursos al servidor de backend, la recompilacion de dependencias nativas 
# de C++ (sqlite3) para Electron y el empaquetado del instalador EXE final.
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "           AMERICAN POS - PRODUCTION BUILD & RELEASE PIPELINE         " -ForegroundColor Cyan
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

Write-Host "`n[0/6] Deteniendo instancias activas de American POS para liberar archivos bloqueados..." -ForegroundColor Yellow
Stop-Process -Name "American POS" -Force -ErrorAction SilentlyContinue | Out-Null
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
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install falló con código $LASTEXITCODE" }
    Write-Host "-> Compilando el bundle estatico (npm run build)..." -ForegroundColor Gray
    npm run build
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
    Write-Host "-> Copiando archivos de $FrontendDist a $BackendPublicDir..." -ForegroundColor Gray
    Copy-Item -Path "$FrontendDist\*" -Destination $BackendPublicDir -Recurse -Force
    Write-Host "OK: Sincronizacion de recursos estaticos completada." -ForegroundColor Green
} catch {
    Write-Host "Error al copiar recursos estaticos: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/6] Recompilando dependencias nativas de C++ (SQLite3) para Electron..." -ForegroundColor Yellow
Push-Location $BackendDir
try {
    Write-Host "-> Asegurando dependencias de backend (npm install)..." -ForegroundColor Gray
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install falló con código $LASTEXITCODE" }
    
    Write-Host "-> Ejecutando electron-rebuild para SQLite3..." -ForegroundColor Gray
    npx electron-rebuild -v 28.3.3 --only sqlite3 --force
    if ($LASTEXITCODE -ne 0) { throw "electron-rebuild falló con código $LASTEXITCODE" }
    
    Write-Host "OK: Recompilacion nativa de SQLite3 completada con exito." -ForegroundColor Green
} catch {
    Write-Host "Error al recompilar dependencias nativas: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

Write-Host "`n[5/6] Preparando Firma de Codigo (Self-Signed Certificate)..." -ForegroundColor Yellow
$BuildDir = Join-Path $BackendDir "build"
if (!(Test-Path $BuildDir)) {
    New-Item -Path $BuildDir -ItemType Directory | Out-Null
}
$CertPath = Join-Path $BuildDir "cert.pfx"
if (!(Test-Path $CertPath)) {
    Write-Host "-> Generando certificado autofirmado local..." -ForegroundColor Gray
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=American POS Local" -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(5) -CertStoreLocation Cert:\CurrentUser\My
    $pwd = ConvertTo-SecureString -String "americanpos" -Force -AsPlainText
    Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password $pwd | Out-Null
    Write-Host "OK: Certificado 'cert.pfx' generado en la carpeta build." -ForegroundColor Green
} else {
    Write-Host "-> Certificado 'cert.pfx' ya existe. Omitiendo generacion." -ForegroundColor Gray
}

Write-Host "`n[6/6] Empaquetando la aplicacion de escritorio final con Electron-Builder..." -ForegroundColor Yellow
try {
    Write-Host "-> Generando instalador NSIS (.exe)..." -ForegroundColor Gray
    npm run dist
    if ($LASTEXITCODE -ne 0) { throw "npm run dist falló con código $LASTEXITCODE" }
    
    $InstallerDir = Join-Path $BackendDir "dist_final_installer"
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
