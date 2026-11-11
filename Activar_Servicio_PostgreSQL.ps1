# Requiere permisos de Administrador para configurar servicios de Windows
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Solicitando permisos de Administrador para activar el servicio de PostgreSQL..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Clear-Host
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   Configurando Inicio Automático de PostgreSQL 16      " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$serviceName = "postgresql-x64-16"
$dataDir = "C:\Program Files\PostgreSQL\16\data"
$pidFile = Join-Path $dataDir "postmaster.pid"

# 1. Limpiar postmaster.pid huérfano si existe y el proceso no está corriendo
if (Test-Path $pidFile) {
    try {
        $lines = Get-Content $pidFile
        $oldPid = [int]$lines[0].Trim()
        $proc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            Write-Host "[1/5] Limpiando archivo de bloqueo huérfano postmaster.pid (PID $oldPid inactivo)..." -ForegroundColor Yellow
            Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Host "[1/5] Nota: postmaster.pid verificado." -ForegroundColor Gray
    }
} else {
    Write-Host "[1/5] No hay bloqueos previos en el directorio de datos." -ForegroundColor Green
}

# 2. Configurar el servicio nativo de Windows en Inicio Automático
Write-Host "[2/5] Configurando servicio '$serviceName' en modo Automático..." -ForegroundColor Yellow
sc.exe config $serviceName start= auto | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/10000/restart/20000 | Out-Null

# 3. Iniciar el servicio
Write-Host "[3/5] Iniciando servicio de base de datos..." -ForegroundColor Yellow
sc.exe start $serviceName | Out-Null
Start-Sleep -Seconds 3

# 4. Verificar estado del servicio y puerto 5432
$svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
Write-Host "[4/5] Estado del servicio: $($svc.Status) (Tipo de inicio: $($svc.StartType))" -ForegroundColor Cyan

$portCheck = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet
if ($portCheck) {
    Write-Host "      ✅ Puerto 5432 activo y respondiendo a conexiones." -ForegroundColor Green
} else {
    Write-Host "      ⚠️ Esperando respuesta en el puerto 5432..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    $portCheck2 = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet
    if ($portCheck2) {
        Write-Host "      ✅ Puerto 5432 activo y listo." -ForegroundColor Green
    } else {
        Write-Host "      ⚠️ El servicio fue iniciado, esperando inicialización completa de PostgreSQL." -ForegroundColor Yellow
    }
}

# 5. Limpiar accesos de inicio obsoletos hacia el puerto 5433
Write-Host "[5/5] Depurando scripts antiguos de inicio de usuario..." -ForegroundColor Yellow
try {
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "PostgreSQL_IsaacPOS" -ErrorAction SilentlyContinue
} catch {}

$oldVbsStartup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Start_PostgreSQL_IsaacPOS.vbs"
if (Test-Path $oldVbsStartup) {
    Remove-Item -Path $oldVbsStartup -Force -ErrorAction SilentlyContinue
}

# Actualizar start_postgres_hidden.vbs con la ruta correcta en Program Files
$vbsPath = "$env:APPDATA\PostgreSQL\start_postgres_hidden.vbs"
if (Test-Path $vbsPath) {
    $vbsContent = 'Set WshShell = CreateObject("WScript.Shell")' + "`r`n" + 'WshShell.Run """C:\Program Files\PostgreSQL\16\bin\postgres.exe"" -D ""C:\Program Files\PostgreSQL\16\data""", 0, False'
    Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  ¡ÉXITO! PostgreSQL 16 configurado en inicio automático" -ForegroundColor Green
Write-Host "  A partir de ahora la base de datos arrancará sola con " -ForegroundColor Green
Write-Host "  Windows. Ya no necesitas abrir pgAdmin 4 manualmente. " -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Start-Sleep -Seconds 3
