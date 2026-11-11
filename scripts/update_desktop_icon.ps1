Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$pngSource = Join-Path $projectRoot "american-pos-frontend\src\assets\isaac-emblem.png"

if (-not (Test-Path $pngSource)) {
    Write-Error "No se encontro la imagen fuente en $pngSource"
    exit 1
}

$destIco = "C:\Users\mrive\AppData\Local\Programs\Isaac POS Modern\app_icon.ico"
$buildIco = Join-Path $projectRoot "american-pos-backend\build\icon.ico"

# Generar archivo .ico valido a partir del PNG
$bmp = [System.Drawing.Bitmap]::FromFile($pngSource)
$thumb = New-Object System.Drawing.Bitmap($bmp, 256, 256)
$hIcon = $thumb.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = New-Object System.IO.FileStream($destIco, [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()

# Copiar tambien a build para empaquetados futuros
Copy-Item $destIco $buildIco -Force

$bmp.Dispose()
$thumb.Dispose()
$icon.Dispose()

Write-Host "✔ Nuevo archivo de icono generado en: $destIco"

# Actualizar accesos directos
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
        $shortcut.IconLocation = "$destIco,0"
        $shortcut.Save()
        Write-Host "✔ Icono actualizado en acceso directo: $lnk"
    }
}

# Refrescar cache de iconos del explorador de Windows
$code = @"
using System;
using System.Runtime.InteropServices;
public class ShellRefresh {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);
}
"@
Add-Type -TypeDefinition $code
[ShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "🎉 Cache de iconos de Windows notificada exitosamente."
