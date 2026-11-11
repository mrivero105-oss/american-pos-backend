try {
    $dm = New-Object -ComObject WIA.DeviceManager
    Write-Host "Device Count: $($dm.DeviceInfos.Count)"
    if ($dm.DeviceInfos.Count -gt 0) {
        $devInfo = $dm.DeviceInfos.Item(1)
        $devName = $devInfo.Properties.Item('Name').Value
        $devId = $devInfo.DeviceID
        Write-Host "Device Name: $devName"
        Write-Host "Device ID: $devId"
        
        $dev = $devInfo.Connect()
        Write-Host "Connected successfully: $($dev.DeviceID)"
        Write-Host "Item count: $($dev.Items.Count)"
        
        $item = $dev.Items.Item(1)
        Write-Host "Item 1: $item"
        
        foreach ($prop in $item.Properties) {
            if ($prop.PropertyID -in 6146, 6147, 6148) {
                Write-Host "Prop $($prop.PropertyID) ($($prop.Name)) = $($prop.Value)"
            }
        }
    }
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
}
