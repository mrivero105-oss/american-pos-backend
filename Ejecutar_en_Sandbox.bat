@echo off
title Desbloquear y Ejecutar Isaac POS en Sandbox
color 0b
echo ========================================================
echo    ISAAC POS - PREPARACION PARA WINDOWS SANDBOX
echo ========================================================
echo.
echo 1. Desbloqueando archivos de directiva de seguridad...
powershell -NoProfile -Command "Get-ChildItem '%~dp0*.exe' | ForEach-Object { Unblock-File $_.FullName }"

echo 2. Desactivando restriccion de control de aplicaciones...
reg add "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v "VerifiedAndReputablePolicyState" /t REG_DWORD /d 0 /f >nul 2>&1

echo.
echo ========================================================
echo   Que instalador deseas iniciar?
echo ========================================================
echo   [1] Servidor Principal (1_IsaacPOS_Servidor_Principal_Setup.exe)
echo   [2] Caja Terminal (2_IsaacPOS_Caja_Terminal_Setup.exe)
echo   [3] Paquete Unificado (Isaac-POS-Ultra-Setup.exe)
echo   [4] Solo desbloquear y salir
echo ========================================================
set /p opt="Elige una opcion (1-4) [default 1]: "
if "%opt%"=="" set opt=1

if "%opt%"=="1" start "" "%~dp01_IsaacPOS_Servidor_Principal_Setup.exe"
if "%opt%"=="2" start "" "%~dp02_IsaacPOS_Caja_Terminal_Setup.exe"
if "%opt%"=="3" start "" "%~dp0Isaac-POS-Ultra-Setup.exe"
if "%opt%"=="4" echo Listo. Archivos desbloqueados.

exit /b 0
