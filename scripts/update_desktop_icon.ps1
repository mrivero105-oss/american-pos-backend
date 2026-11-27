Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePng = Join-Path $projectRoot "american-pos-frontend\src\assets\isaac-emblem.png"

if (-not (Test-Path $sourcePng)) {
    Write-Error "No se encontro la imagen fuente en $sourcePng"
    exit 1
}

$modernDir = if ($env:ISAAC_MODERN_DIR) { $env:ISAAC_MODERN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\Isaac POS Modern" }
if (-not (Test-Path $modernDir)) { New-Item -Path $modernDir -ItemType Directory -Force | Out-Null }
$destIco = Join-Path $modernDir "app_icon_fhd.ico"
$buildIco = Join-Path $projectRoot "american-pos-backend\build\icon.ico"

# Tamaños estandar de iconos de Windows en alta resolucion con mipmaps perfectos
$sizes = @(256, 128, 64, 48, 32, 16)
$srcImg = [System.Drawing.Image]::FromFile($sourcePng)

$pngStreams = @()

foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Maxima calidad de interpolacion bicubica y antialiasing
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $g.DrawImage($srcImg, 0, 0, $sz, $sz)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    
    $pngStreams += $ms
}
$srcImg.Dispose()

# Construir contenedor binario ICO con frames PNG de 32 bits
$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoMs)

# Cabecera ICONDIR
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type 1 = Icon
$bw.Write([uint16]$sizes.Count) # Numero de imagenes

# Offset inicial donde comienzan los datos de imagen: 6 + (16 * count)
$offset = 6 + (16 * $sizes.Count)

for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]
    $dataLen = $pngStreams[$i].Length
    
    $wByte = if ($sz -eq 256) { [byte]0 } else { [byte]$sz }
    $hByte = if ($sz -eq 256) { [byte]0 } else { [byte]$sz }

    $bw.Write($wByte)
    $bw.Write($hByte)
    $bw.Write([byte]0)   # Color count (0 si >= 8bpp)
    $bw.Write([byte]0)   # Reserved
    $bw.Write([uint16]1) # Color planes
    $bw.Write([uint16]32)# Bits per pixel (32bpp ARGB)
    $bw.Write([uint32]$dataLen) # BytesInRes
    $bw.Write([uint32]$offset)  # ImageOffset

    $offset += $dataLen
}

# Escribir los bytes reales de cada imagen PNG
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $bytes = $pngStreams[$i].ToArray()
    $bw.Write($bytes)
    $pngStreams[$i].Dispose()
}

$bw.Flush()

# Guardar en destino
$fs = New-Object System.IO.FileStream($destIco, [System.IO.FileMode]::Create)
$icoMs.WriteTo($fs)
$fs.Close()

$bw.Close()
$icoMs.Dispose()

# Copiar a build para futuros empaquetados
Copy-Item $destIco $buildIco -Force

Write-Host "✔ Icono Full HD multi-resolucion generado en: $destIco"

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
        Write-Host "✔ Acceso directo actualizado: $lnk"
    }
}

# Forzar refresco del Shell de Windows
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

Write-Host "🎉 Cache de iconos de Windows refrescada con éxito en Full HD."
