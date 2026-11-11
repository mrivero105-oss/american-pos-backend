Add-Type -AssemblyName System.Drawing

$sourcePath = 'C:\AndroidStudioProjects\Isaac Page\public\icon-512x512.png'
if (-not (Test-Path $sourcePath)) {
    Write-Error "Source icon not found at: $sourcePath"
    exit 1
}

$sourceImg = [System.Drawing.Bitmap]::FromFile($sourcePath)

$resRoot = "C:\AndroidStudioProjects\American POS PC\american-pos-frontend\android\app\src\main\res"

$densities = @(
    @{ Name = 'mdpi'; Launcher = 48; Foreground = 108 },
    @{ Name = 'hdpi'; Launcher = 72; Foreground = 162 },
    @{ Name = 'xhdpi'; Launcher = 96; Foreground = 216 },
    @{ Name = 'xxhdpi'; Launcher = 144; Foreground = 324 },
    @{ Name = 'xxxhdpi'; Launcher = 192; Foreground = 432 }
)

$bgColor = [System.Drawing.ColorTranslator]::FromHtml('#05132F')

function Get-RoundedRectPath($rect, $radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $arc = New-Object System.Drawing.RectangleF($rect.X, $rect.Y, $diameter, $diameter)
    
    $path.AddArc($arc, 180, 90)
    $arc.X = $rect.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $rect.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $rect.Left
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()
    return $path
}

foreach ($d in $densities) {
    $dir = Join-Path $resRoot ("mipmap-" + $d.Name)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # 1. ic_launcher_foreground.png (Adaptive icon)
    $fgSize = $d.Foreground
    $fgBmp = New-Object System.Drawing.Bitmap($fgSize, $fgSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gFg = [System.Drawing.Graphics]::FromImage($fgBmp)
    $gFg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gFg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gFg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gFg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $gFg.Clear([System.Drawing.Color]::Transparent)

    $logoSize = [int]($fgSize * 0.68)
    $logoOffset = [int](($fgSize - $logoSize) / 2)
    $gFg.DrawImage($sourceImg, $logoOffset, $logoOffset, $logoSize, $logoSize)
    $gFg.Dispose()

    $fgPath = Join-Path $dir "ic_launcher_foreground.png"
    $fgBmp.Save($fgPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $fgBmp.Dispose()
    Write-Host "Generated: $fgPath ($fgSize x $fgSize)"

    # 2. ic_launcher.png (Legacy square with rounded corners)
    $lSize = $d.Launcher
    $lBmp = New-Object System.Drawing.Bitmap($lSize, $lSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gL = [System.Drawing.Graphics]::FromImage($lBmp)
    $gL.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gL.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gL.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gL.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $gL.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.RectangleF(0, 0, $lSize, $lSize)
    $radius = $lSize * 0.22
    $path = Get-RoundedRectPath $rect $radius
    $brush = New-Object System.Drawing.SolidBrush($bgColor)
    $gL.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()

    $lLogoSize = [int]($lSize * 0.78)
    $lOffset = [int](($lSize - $lLogoSize) / 2)
    $gL.DrawImage($sourceImg, $lOffset, $lOffset, $lLogoSize, $lLogoSize)
    $gL.Dispose()

    $lPath = Join-Path $dir "ic_launcher.png"
    $lBmp.Save($lPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $lBmp.Dispose()
    Write-Host "Generated: $lPath ($lSize x $lSize)"

    # 3. ic_launcher_round.png (Legacy round icon)
    $rBmp = New-Object System.Drawing.Bitmap($lSize, $lSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gR = [System.Drawing.Graphics]::FromImage($rBmp)
    $gR.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gR.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gR.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gR.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $gR.Clear([System.Drawing.Color]::Transparent)

    $brushR = New-Object System.Drawing.SolidBrush($bgColor)
    $gR.FillEllipse($brushR, 0, 0, $lSize, $lSize)
    $brushR.Dispose()

    $rLogoSize = [int]($lSize * 0.72)
    $rOffset = [int](($lSize - $rLogoSize) / 2)
    $gR.DrawImage($sourceImg, $rOffset, $rOffset, $rLogoSize, $rLogoSize)
    $gR.Dispose()

    $rPath = Join-Path $dir "ic_launcher_round.png"
    $rBmp.Save($rPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $rBmp.Dispose()
    Write-Host "Generated: $rPath ($lSize x $lSize)"
}

$sourceImg.Dispose()
Write-Host "All Android icons generated successfully!"
