@echo off
chcp 65001 >nul
echo Compilando instalador Isaac POS Ultra con codificación UTF-8...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0compilar_instalador.ps1"
pause
