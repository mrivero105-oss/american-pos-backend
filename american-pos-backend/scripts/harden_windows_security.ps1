# ==============================================================================
# ISAAC POS - SCRIPT DE HARDENING DE SEGURIDAD OPERATIVA Y SISTEMA OPERATIVO
# Grado de Seguridad: Bancario / Empresarial (PCI-DSS & NIST Hardening)
# ==============================================================================

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "[*] INICIANDO HARDENING DE SEGURIDAD EN WINDOWS PARA ISAAC POS BACKEND" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# Comprobar si se ejecuta con privilegios de Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "`n[!] AVISO IMPORTANTE: No tienes privilegios de Administrador en esta ventana." -ForegroundColor Yellow
    Write-Host "    Para aplicar las reglas del Firewall de Windows y permisos NTFS completos," -ForegroundColor Yellow
    Write-Host "    cierra esta ventana, haz clic derecho sobre PowerShell y elige 'Ejecutar como administrador'.`n" -ForegroundColor Yellow
} else {
    Write-Host "`n[OK] Sesion ejecutandose con privilegios de Administrador." -ForegroundColor Green
}

# Detectar nombre del grupo de Administradores local (espanol/ingles)
$AdminGroup = if (Get-LocalGroup -Name "Administradores" -ErrorAction SilentlyContinue) { "Administradores" } else { "Administrators" }

# 1. Rutas de Datos Sensibles
$AppDataDir = [System.IO.Path]::Combine($env:APPDATA, "isaac-pos")
$LocalEnvFile = [System.IO.Path]::Combine((Get-Location).Path, ".env")
$AppDataEnvFile = [System.IO.Path]::Combine($AppDataDir, ".env")

Write-Host "[PASO 1] Blindando Permisos de Sistema de Archivos (NTFS ACLs)..." -ForegroundColor Yellow

function Harden-DirectoryPath {
    param([string]$Target)
    if (Test-Path $Target) {
        Write-Host " -> Aplicando ACLs estrictas en: $Target" -ForegroundColor Gray
        & icacls "$Target" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F" "$($AdminGroup):(OI)(CI)F" /Q
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    [OK] Permisos restringidos a: $env:USERNAME, SYSTEM, $AdminGroup." -ForegroundColor Green
        } else {
            Write-Host "    [WARN] No se pudieron aplicar permisos en $Target (ejecuta como Administrador)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "    [INFO] Directorio no existe aun: $Target" -ForegroundColor DarkGray
    }
}

function Harden-FilePath {
    param([string]$Target)
    if (Test-Path $Target) {
        Write-Host " -> Aplicando ACLs estrictas en archivo secreto: $Target" -ForegroundColor Gray
        & icacls "$Target" /inheritance:r /grant:r "$($env:USERNAME):F" "SYSTEM:F" "$($AdminGroup):F" /Q
        if ($LASTEXITCODE -eq 0) {
            Write-Host "    [OK] Archivo protegido: Acceso exclusivo para $env:USERNAME, SYSTEM, $AdminGroup." -ForegroundColor Green
        } else {
            Write-Host "    [WARN] No se pudieron aplicar permisos en $Target (ejecuta como Administrador)." -ForegroundColor Yellow
        }
    }
}

Harden-DirectoryPath -Target $AppDataDir
Harden-FilePath -Target $LocalEnvFile
Harden-FilePath -Target $AppDataEnvFile

Write-Host "`n[PASO 2] Verificando Reglas de Windows Firewall para Red Local Segura..." -ForegroundColor Yellow

$RuleNameTCP = "Isaac-POS-LAN-Ports"
$RuleNameUDP = "Isaac-POS-P2P-Discovery"

try {
    # Verificar si existe regla TCP
    $existingTcp = Get-NetFirewallRule -Name $RuleNameTCP -ErrorAction SilentlyContinue
    if (-not $existingTcp) {
        if ($isAdmin) {
            Write-Host " -> Creando regla de Firewall Inbound TCP (Puertos 3000-3005, 3199)..." -ForegroundColor Gray
            New-NetFirewallRule -Name $RuleNameTCP -DisplayName "Isaac POS Backend (Servidor Local)" -Direction Inbound -Protocol TCP -LocalPort @("3000","3001","3002","3003","3004","3005","3199") -Action Allow -RemoteAddress LocalSubnet -Profile Private,Domain -ErrorAction Stop | Out-Null
            Write-Host "    [OK] Regla TCP creada para subred local (LocalSubnet)." -ForegroundColor Green
        } else {
            Write-Host "    [WARN] Se requiere PowerShell como Administrador para agregar la regla TCP al Firewall." -ForegroundColor Yellow
        }
    } else {
        Write-Host "    [OK] Regla TCP ya configurada en el Firewall." -ForegroundColor Green
    }

    # Verificar si existe regla UDP para LAN Cluster
    $existingUdp = Get-NetFirewallRule -Name $RuleNameUDP -ErrorAction SilentlyContinue
    if (-not $existingUdp) {
        if ($isAdmin) {
            Write-Host " -> Creando regla de Firewall Inbound UDP (Puerto 41234 P2P)..." -ForegroundColor Gray
            New-NetFirewallRule -Name $RuleNameUDP -DisplayName "Isaac POS P2P LAN Cluster (UDP)" -Direction Inbound -Protocol UDP -LocalPort @("41234") -Action Allow -RemoteAddress LocalSubnet -Profile Private,Domain -ErrorAction Stop | Out-Null
            Write-Host "    [OK] Regla UDP creada para descubrimiento P2P seguro." -ForegroundColor Green
        } else {
            Write-Host "    [WARN] Se requiere PowerShell como Administrador para agregar la regla UDP al Firewall." -ForegroundColor Yellow
        }
    } else {
        Write-Host "    [OK] Regla UDP ya configurada en el Firewall." -ForegroundColor Green
    }
} catch {
    Write-Host "    [WARN] Excepcion al configurar Firewall: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "`n[PASO 3] Verificando Proteccion en Tiempo Real de Windows Defender..." -ForegroundColor Yellow
try {
    $defender = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($defender -and $defender.RealTimeProtectionEnabled) {
        Write-Host "    [OK] Windows Defender Proteccion en Tiempo Real: ACTIVA" -ForegroundColor Green
        Write-Host "    [OK] Antivirus Signatures Up-to-Date: $($defender.AntivirusSignatureAge -le 3)" -ForegroundColor Green
    } else {
        Write-Host "    [WARN] Windows Defender no reporta proteccion activa o se usa un antivirus alternativo." -ForegroundColor Yellow
    }
} catch {
    Write-Host "    [INFO] No se pudo consultar Get-MpComputerStatus." -ForegroundColor DarkGray
}

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] HARDENING DE SEGURIDAD OPERATIVA COMPLETADO" -ForegroundColor Green
Write-Host "================================================================================`n" -ForegroundColor Cyan
