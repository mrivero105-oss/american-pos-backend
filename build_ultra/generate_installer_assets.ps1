Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$logoPath = "$projectRoot\american-pos-frontend\public\logo.png"
$outputDir = "$projectRoot\build_ultra\assets"

if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

# --- 1. Generar wizard.bmp (164 x 314 px) para la barra lateral de bienvenida ---
$wWidth = 164
$wHeight = 314
$wizardBmp = New-Object System.Drawing.Bitmap($wWidth, $wHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gW = [System.Drawing.Graphics]::FromImage($wizardBmp)
$gW.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gW.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gW.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# Fondo degradado moderno (azul oscuro profundo a azul noche)
$rectW = New-Object System.Drawing.Rectangle(0, 0, $wWidth, $wHeight)
$brushBg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rectW,
    [System.Drawing.Color]::FromArgb(11, 23, 56),     # #0b1738
    [System.Drawing.Color]::FromArgb(7, 13, 30),      # #070d1e
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
)
$gW.FillRectangle($brushBg, $rectW)

# Borde decorativo vertical a la derecha
$penBorder = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 56, 189, 248), 1)
$gW.DrawLine($penBorder, $wWidth - 1, 0, $wWidth - 1, $wHeight)

# Dibujar Logo
if (Test-Path $logoPath) {
    $logoImg = [System.Drawing.Image]::FromFile($logoPath)
    $logoSize = 88
    $logoX = [int](($wWidth - $logoSize) / 2)
    $logoY = 32
    $gW.DrawImage($logoImg, $logoX, $logoY, $logoSize, $logoSize)
    $logoImg.Dispose()
}

# Textos en banner lateral
$fontTitle = New-Object System.Drawing.Font("Segoe UI", [float]13, [System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font("Segoe UI", [float]8.5, [System.Drawing.FontStyle]::Bold)
$fontBadge = New-Object System.Drawing.Font("Segoe UI", [float]7.5, [System.Drawing.FontStyle]::Regular)

$brushWhite = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$brushCyan = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 189, 248))
$brushMuted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(148, 163, 184))

$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center

$gW.DrawString("ISAAC POS", $fontTitle, $brushWhite, [float]($wWidth / 2), 132, $sf)
$gW.DrawString("EDICION ULTRA", $fontSub, $brushCyan, [float]($wWidth / 2), 156, $sf)

# Badge decorativo
$badgeY = 195
$badgeWidth = 130
$badgeHeight = 48
$badgeX = [int](($wWidth - $badgeWidth) / 2)
$badgeRect = New-Object System.Drawing.Rectangle($badgeX, $badgeY, $badgeWidth, $badgeHeight)
$brushBadgeBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 255, 255, 255))
$gW.FillRectangle($brushBadgeBg, $badgeRect)
$penBadge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 56, 189, 248), 1)
$gW.DrawRectangle($penBadge, $badgeRect)

$gW.DrawString("WINDOWS 10 / 11", $fontSub, $brushWhite, [float]($wWidth / 2), [float]($badgeY + 8), $sf)
$gW.DrawString("Motor Nativo Ultra Ligero", $fontBadge, $brushMuted, [float]($wWidth / 2), [float]($badgeY + 26), $sf)

$gW.DrawString("v24.04 64-bit", $fontBadge, $brushMuted, [float]($wWidth / 2), 285, $sf)

$gW.Dispose()
$wizardPath = "$outputDir\wizard.bmp"
$wizardBmp.Save($wizardPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$wizardBmp.Dispose()
Write-Host "Generado: $wizardPath"


# --- 2. Generar header.bmp (150 x 57 px) para la cabecera del instalador ---
$hWidth = 150
$hHeight = 57
$headerBmp = New-Object System.Drawing.Bitmap($hWidth, $hHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$gH = [System.Drawing.Graphics]::FromImage($headerBmp)
$gH.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gH.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Fondo blanco puro para que se integre perfectamente con la cabecera blanca nativa de Windows Modern UI 2
$rectH = New-Object System.Drawing.Rectangle(0, 0, $hWidth, $hHeight)
$brushWhiteH = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$gH.FillRectangle($brushWhiteH, $rectH)

# Dibujar logo a la derecha (44x44)
if (Test-Path $logoPath) {
    $logoImgH = [System.Drawing.Image]::FromFile($logoPath)
    $hLogoSize = 44
    $hLogoX = $hWidth - $hLogoSize - 10
    $hLogoY = [int](($hHeight - $hLogoSize) / 2)
    $gH.DrawImage($logoImgH, $hLogoX, $hLogoY, $hLogoSize, $hLogoSize)
    $logoImgH.Dispose()
}

$gH.Dispose()
$headerPath = "$outputDir\header.bmp"
$headerBmp.Save($headerPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$headerBmp.Dispose()
Write-Host "Generado: $headerPath"
