@echo off
chcp 65001 >nul
title Configurar PostgreSQL 16 en Inicio Automatico
color 0A

:: Verificar si se ejecuta con permisos de administrador
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [INFO] Solicitando permisos de Administrador de Windows...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

echo ========================================================
echo    Configurando Inicio Automatico de PostgreSQL 16      
echo ========================================================
echo.

set "SERVICE_NAME=postgresql-x64-16"
set "DATA_DIR=C:\Program Files\PostgreSQL\16\data"
set "PID_FILE=%DATA_DIR%\postmaster.pid"

echo [1/5] Verificando bloqueos previos...
if exist "%PID_FILE%" (
    powershell -Command "$p = '%PID_FILE%'; if (Test-Path $p) { try { $pidVal = (Get-Content $p)[0].Trim(); if (-not (Get-Process -Id $pidVal -ErrorAction SilentlyContinue)) { Remove-Item -Path $p -Force; Write-Host '     Bloqueo huerfano eliminado.' } } catch {} }"
)

echo [2/5] Configurando servicio en inicio AUTOMATICO...
sc.exe config %SERVICE_NAME% start= auto
sc.exe failure %SERVICE_NAME% reset= 86400 actions= restart/5000/restart/10000/restart/20000

echo [3/5] Iniciando servicio de PostgreSQL...
sc.exe start %SERVICE_NAME%
net start %SERVICE_NAME% >nul 2>&1

timeout /t 3 /nobreak >nul

echo [4/5] Verificando puerto 5432...
powershell -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 5432 -InformationLevel Quiet; if ($ok) { Write-Host '     [OK] Puerto 5432 conectado y escuchando.' -ForegroundColor Green } else { Write-Host '     [INFO] Esperando inicio...' -ForegroundColor Yellow }"

echo [5/5] Limpiando scripts obsoletos en puerto 5433...
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "PostgreSQL_IsaacPOS" /f >nul 2>&1
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Start_PostgreSQL_IsaacPOS.vbs" >nul 2>&1

echo.
echo ========================================================
echo   ¡LISTO! PostgreSQL 16 ya esta configurado para iniciar
echo   automaticamente con Windows sin abrir pgAdmin 4.
echo ========================================================
echo.
pause
