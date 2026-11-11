@echo off
chcp 65001 >nul
title Habilitar Conexion de Red - Isaac POS
color 0A

:: Verificar permisos de administrador
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Solicitando permisos de Administrador de Windows...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ========================================================
echo    Configurando Red y Firewall para Isaac POS Celulares
echo ========================================================
echo.

echo [1/3] Cambiando red de Publica a PRIVADA...
powershell -Command "Get-NetConnectionProfile | ForEach-Object { Set-NetConnectionProfile -InputObject $_ -NetworkCategory Private -ErrorAction SilentlyContinue }; Write-Host '     [OK] Red cambiada a Privada.'"

echo [2/3] Abriendo puertos en Firewall de Windows (3005, 5005, 8080)...
netsh advfirewall firewall delete rule name="Isaac POS Server (Port 3005)" >nul 2>&1
netsh advfirewall firewall delete rule name="Isaac POS Server (Port 5005)" >nul 2>&1
netsh advfirewall firewall delete rule name="Isaac POS Server (Port 8080)" >nul 2>&1

netsh advfirewall firewall add rule name="Isaac POS Server (Port 3005)" dir=in action=allow protocol=TCP localport=3005 profile=any >nul
netsh advfirewall firewall add rule name="Isaac POS Server (Port 5005)" dir=in action=allow protocol=TCP localport=5005 profile=any >nul
netsh advfirewall firewall add rule name="Isaac POS Server (Port 8080)" dir=in action=allow protocol=TCP localport=8080 profile=any >nul
echo      [OK] Puertos 3005, 5005 y 8080 desbloqueados.

echo [3/3] Obteniendo direccion IP local de esta PC...
echo.
echo ========================================================
powershell -Command "$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' }).IPAddress; Write-Host '   TU DIRECCION IP ES: ' -NoNewline; Write-Host $ip -ForegroundColor Yellow; Write-Host '   (Ingresa exactamente esa IP en tu celular)'"
echo ========================================================
echo.
echo ¡Listo! Ahora abre la app en tu celular, pulsa REINTENTAR.
echo.
pause
