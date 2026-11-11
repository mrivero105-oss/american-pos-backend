<#
.SYNOPSIS
    Limpia los archivos temporales abandonados de Google Chrome / BITS (chrome_chrome_BITS_*) en la carpeta %TEMP%.
.DESCRIPTION
    Google Chrome a veces deja archivos temporales bloqueados con permisos restringidos durante actualizaciones (BITS).
    Este script toma posesión, restablece permisos y elimina de forma segura los archivos huérfanos para liberar espacio.
#>

$ErrorActionPreference = 'SilentlyContinue'
$tempPath = [System.IO.Path]::GetTempPath()
$pattern = "chrome_chrome_BITS_*"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " LIMPIEZA AUTOMÁTICA DE ARCHIVOS TEMPORALES CHROME (BITS)" -ForegroundColor Cyan
Write-Host " Carpeta Temp: $tempPath" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$files = Get-ChildItem -Path $tempPath -Filter $pattern -File -Force

if ($files.Count -eq 0) {
    Write-Host "`n[OK] No se encontraron archivos temporales huérfanos de Chrome BITS. Todo limpio." -ForegroundColor Green
    exit 0
}

Write-Host "`nSe encontraron $($files.Count) archivos huérfanos. Iniciando limpieza..." -ForegroundColor Yellow

$deletedCount = 0
$freedBytes = 0

foreach ($file in $files) {
    try {
        # Intento directo de borrado
        $size = $file.Length
        Remove-Item -Path $file.FullName -Force -ErrorAction Stop
        $deletedCount++
        $freedBytes += $size
    } catch {
        # Si falla por permisos (ACL), tomamos posesión y restablecemos permisos
        try {
            cmd.exe /c "takeown /f `"$($file.FullName)`" /a >nul 2>&1"
            cmd.exe /c "icacls `"$($file.FullName)`" /grant *S-1-5-32-544:F /T /C /Q >nul 2>&1"
            Remove-Item -Path $file.FullName -Force -ErrorAction Stop
            $deletedCount++
            $freedBytes += $size
        } catch {
            # Si aún falla, es porque Chrome está activamente escribiendo en ese archivo (no está huérfano)
        }
    }
}

$freedMB = [Math]::Round($freedBytes / 1MB, 2)
Write-Host "`n[COMPLETADO] Se eliminaron $deletedCount de $($files.Count) archivos huérfanos." -ForegroundColor Green
Write-Host "[ESPACIO LIBERADO] $freedMB MB`n" -ForegroundColor Green
