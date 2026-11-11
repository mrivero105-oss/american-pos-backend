@echo off
title Limpieza de Archivos Temporales Chrome BITS
echo ==========================================================
echo  EJECUTANDO LIMPIEZA DE ARCHIVOS TEMPORALES DE CHROME...
echo ==========================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0clean_chrome_bits_temp.ps1"
echo.
pause
