@echo off
title Desbloquear Control de Aplicaciones - Windows Sandbox
echo ========================================================
echo    DESBLOQUEANDO CONTROL DE APLICACIONES EN SANDBOX
echo ========================================================
echo.
echo [1/3] Desactivando Smart App Control (SAC) en el registro...
reg add "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v VerifiedAndReputablePolicyState /t REG_DWORD /d 0 /f >nul 2>&1

echo [2/3] Actualizando directivas de integridad de codigo (CiTool)...
CiTool.exe --refresh >nul 2>&1

echo [3/3] Desbloqueando archivos en el Escritorio...
powershell.exe -NoProfile -Command "Get-ChildItem -Path \"$env:USERPROFILE\Desktop\" -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

echo.
echo ========================================================
echo  LISTO: Ya puedes abrir el instalador de Isaac POS.
echo ========================================================
echo.
pause
