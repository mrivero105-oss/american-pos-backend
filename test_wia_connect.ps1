try {
    $dm = New-Object -ComObject WIA.DeviceManager
    Write-Host "Device Count: $($dm.DeviceInfos.Count)"
    if ($dm.DeviceInfos.Count -gt 0) {
        $devInfo = $dm.DeviceInfos.Item(1)
        Write-Host "Device Name: $($devInfo.Properties.Item('Name').Value)"
        Write-Host "Device ID: $($devInfo.DeviceID)"
        
        $dev = $devInfo.Connect()
        Write-Host "Connected successfully: $($dev.DeviceID)"
        Write-Host "Item count: $($dev.Items.Count)"
        
        if ($dev.Items.Count -gt 0) {
            $item = $dev.Items.Item(1)
            Write-Host "Item 1: $item"
            
            # Print available properties
            foreach ($p in $item.Properties) {
                Write-Host "Prop $($p.PropertyID): $($p.Name) = $($p.Value)"
            }
        }
    }
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
} finally {
    if ($dev) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dev) | Out-Null }
    if ($dm) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($dm) | Out-Null }
}
