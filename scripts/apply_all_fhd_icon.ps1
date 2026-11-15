$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$exePath = "C:\Users\mrive\AppData\Local\Programs\Isaac POS Modern\Isaac POS Modern.exe"
$icoPath = "C:\Users\mrive\AppData\Local\Programs\Isaac POS Modern\app_icon_fhd.ico"
$rcedit = "C:\Users\mrive\AppData\Local\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\rcedit-x64.exe"
$installedResources = "C:\Users\mrive\AppData\Local\Programs\Isaac POS Modern\resources"

Write-Host "Verificando ejecutable y recursos..."
if (-not (Test-Path $exePath)) {
    Write-Error "No se encontro el ejecutable en $exePath"
    exit 1
}

if (-not (Test-Path $icoPath)) {
    Write-Error "No se encontro el archivo .ico en $icoPath"
    exit 1
}

# 1. Verificar si Isaac POS esta abierto
$running = Get-Process -Name "Isaac POS Modern" -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Intentando cerrar la aplicacion Isaac POS Modern..."
    Stop-Process -Name "Isaac POS Modern" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 2. Inyectar nuevo icono oficial directamente en el ejecutable .exe con rcedit
Write-Host "Inyectando icono Ultra HD en el binario .exe..."
try {
    & $rcedit "$exePath" --set-icon "$icoPath"
    Write-Host "✔ Recurso de icono inyectado con exito en $exePath"
} catch {
    Write-Warning "No se pudo inyectar en el .exe (posible bloqueo): $($_.Exception.Message)"
}

# 3. Aplicar app.asar pendiente si existe
$pendingAsar = Join-Path $installedResources "app.asar.new"
$targetAsar = Join-Path $installedResources "app.asar"

if (Test-Path $pendingAsar) {
    Write-Host "Aplicando nuevo app.asar pendiente..."
    try {
        Move-Item -Path $pendingAsar -Destination $targetAsar -Force
        Write-Host "✔ app.asar actualizado exitosamente."
    } catch {
        Write-Warning "No se pudo mover app.asar.new: $($_.Exception.Message)"
    }
}

# 4. Actualizar accesos directos
$wsh = New-Object -ComObject WScript.Shell
$desktopPaths = @(
    "C:\Users\mrive\OneDrive\Desktop\Isaac POS Modern.lnk",
    "C:\Users\mrive\Desktop\Isaac POS Modern.lnk",
    "C:\Users\mrive\OneDrive\Desktop\Isaac POS - Servidor Principal.lnk",
    "C:\Users\mrive\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Isaac POS Modern\Isaac POS Modern.lnk"
)

foreach ($lnk in $desktopPaths) {
    if (Test-Path $lnk) {
        $shortcut = $wsh.CreateShortcut($lnk)
        $shortcut.IconLocation = "$icoPath,0"
        $shortcut.Save()
        Write-Host "✔ Acceso directo actualizado: $lnk"
    }
}

# 5. Forzar refresco inmediato del Shell de Windows
$code = @"
using System;
using System.Runtime.InteropServices;
public class ShellRefreshDirect {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
[ShellRefreshDirect]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "🎉 Proceso de actualizacion de icono completado exitosamente."
