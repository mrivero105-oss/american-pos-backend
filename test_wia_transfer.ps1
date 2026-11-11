Add-Type -AssemblyName System.Drawing

$outJpg = "$PSScriptRoot\test_scanned_invoice.jpg"
$tempBmp = "$PSScriptRoot\test_temp_scan.bmp"

$maxAttempts = 5
$attempt = 1
$success = $false

while ($attempt -le $maxAttempts -and -not $success) {
    Write-Host "Attempt $attempt of $maxAttempts..."
    try {
        $dm = New-Object -ComObject WIA.DeviceManager
        $devInfo = $dm.DeviceInfos.Item(1)
        $dev = $devInfo.Connect()
        $item = $dev.Items.Item(1)
        
        # Configure Intent: 1 = Color, 2 = Gray, 4 = Text
        try {
            $item.Properties.Item('6146').Value = 1 # Color
        } catch {
            Write-Host "Warning setting Intent: $($_.Exception.Message)"
        }
        
        Write-Host "Iniciando transferencia física desde el escáner..."
        $img = $item.Transfer()
        
        if (Test-Path $tempBmp) { Remove-Item $tempBmp -Force }
        $img.SaveFile($tempBmp)
        Write-Host "Guardado temporal BMP en: $tempBmp (Size: $((Get-Item $tempBmp).Length) bytes)"
        
        # Convert BMP to high-quality JPG using .NET System.Drawing
        $bmp = [System.Drawing.Bitmap]::FromFile($tempBmp)
        if (Test-Path $outJpg) { Remove-Item $outJpg -Force }
        $bmp.Save($outJpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $bmp.Dispose()
        
        if (Test-Path $tempBmp) { Remove-Item $tempBmp -Force }
        
        Write-Host "SUCCESS: Imagen convertida y guardada exitosamente en $outJpg (Size: $((Get-Item $outJpg).Length) bytes)"
        $success = $true
    } catch {
        Write-Host "Attempt $attempt failed: $($_.Exception.Message)"
        Start-Sleep -Seconds 3
    } finally {
        if ($dev) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dev) | Out-Null }
        if ($dm) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dm) | Out-Null }
        [System.GC]::Collect()
        [System.GC]::WaitForPendingFinalizers()
    }
    $attempt++
}
