Add-Type -AssemblyName System.Drawing

$outJpg = "$PSScriptRoot\test_scanned_invoice.jpg"
$tempBmp = "$PSScriptRoot\test_temp_scan.bmp"

Write-Host "Iniciando prueba directa sin mutación de propiedades..."

try {
    $dm = New-Object -ComObject WIA.DeviceManager
    $devInfo = $dm.DeviceInfos.Item(1)
    Write-Host "Conectando a: $($devInfo.Properties.Item('Name').Value)..."
    $dev = $devInfo.Connect()
    $item = $dev.Items.Item(1)
    
    Write-Host "Ejecutando item.Transfer()..."
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
    
    Write-Host "SUCCESS: Imagen escaneada exitosamente en $outJpg (Size: $((Get-Item $outJpg).Length) bytes)"
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
} finally {
    if ($dev) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dev) | Out-Null }
    if ($dm) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dm) | Out-Null }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
