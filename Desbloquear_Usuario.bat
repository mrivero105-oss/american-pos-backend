@echo off
chcp 65001 >nul
title Desbloquear Usuario - Isaac POS
echo ============================================================
echo   DESBLOQUEO INMEDIATO DE USUARIOS - ISAAC POS
echo ============================================================
echo.
set /p USERNAME_TARGET="Ingresa el nombre del usuario a desbloquear (Enter para 'sigly'): "
if "%USERNAME_TARGET%"=="" set USERNAME_TARGET=sigly

if exist "%~dp0american-pos-backend" (
    cd /d "%~dp0american-pos-backend"
) else (
    cd /d "%~dp0"
)

node scripts\desbloquear_usuario.js "%USERNAME_TARGET%"
echo.
pause
