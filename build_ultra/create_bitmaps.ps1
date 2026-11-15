Add-Type -AssemblyName System.Drawing

$iconPath = "c:\AndroidStudioProjects\American POS PC\american-pos-backend\public\favicon.ico"

# 1. Wizard Bitmap (164 x 314)
$wBmp = New-Object System.Drawing.Bitmap 164, 314
$g = [System.Drawing.Graphics]::FromImage($wBmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$rect = New-Object System.Drawing.Rectangle 0, 0, 164, 314
$c1 = [System.Drawing.ColorTranslator]::FromHtml("#070D1E")
$c2 = [System.Drawing.ColorTranslator]::FromHtml("#1E3A8A")
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 90.0
$g.FillRectangle($brush, $rect)

if (Test-Path $iconPath) {
    $ico = New-Object System.Drawing.Icon $iconPath, 64, 64
    $g.DrawIcon($ico, 50, 60)
}

$fontTitle = New-Object System.Drawing.Font "Segoe UI", 13, [System.Drawing.FontStyle]::Bold
$fontSub = New-Object System.Drawing.Font "Segoe UI", 9, [System.Drawing.FontStyle]::Bold
$fontVer = New-Object System.Drawing.Font "Segoe UI", 8, [System.Drawing.FontStyle]::Regular
$whiteBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$cyanBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#38BDF8"))

$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center

$g.DrawString("ISAAC POS", $fontTitle, $whiteBrush, 82, 140, $sf)
$g.DrawString("EDICION ULTRA", $fontSub, $cyanBrush, 82, 168, $sf)
$g.DrawString("Windows 10 / 11", $fontVer, $whiteBrush, 82, 192, $sf)

$wBmp.Save("c:\AndroidStudioProjects\American POS PC\build_ultra\wizard.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$g.Dispose()
$wBmp.Dispose()

# 2. Header Bitmap (150 x 57)
$hBmp = New-Object System.Drawing.Bitmap 150, 57
$gh = [System.Drawing.Graphics]::FromImage($hBmp)
$gh.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$hRect = New-Object System.Drawing.Rectangle 0, 0, 150, 57
$hBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$gh.FillRectangle($hBrush, $hRect)

if (Test-Path $iconPath) {
    $ico48 = New-Object System.Drawing.Icon $iconPath, 48, 48
    $gh.DrawIcon($ico48, 95, 4)
}

$hBmp.Save("c:\AndroidStudioProjects\American POS PC\build_ultra\header.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$gh.Dispose()
$hBmp.Dispose()

Write-Output "Installer Bitmaps Generated Cleanly"
