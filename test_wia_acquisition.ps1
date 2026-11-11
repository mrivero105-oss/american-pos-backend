Write-Host "=== TEST 1: CommonDialog ShowAcquireImage ==="
try {
    $cd = New-Object -ComObject WIA.CommonDialog
    # ShowAcquireImage(1 = ScannerDeviceType, 1 = ColorIntent, 0 = MinimizeSize, FormatID, AlwaysSelectDevice, UseCommonUI, CancelError)
    $image = $cd.ShowAcquireImage(1, 1, 0, "{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}", $false, $false, $false)
    if ($image) {
        $testOut = "$PSScriptRoot\test_out.jpg"
        if (Test-Path $testOut) { Remove-Item $testOut -Force }
        $image.SaveFile($testOut)
        Write-Host "TEST 1 SUCCESS: Saved to $testOut"
    } else {
        Write-Host "TEST 1: No image acquired."
    }
} catch {
    Write-Host "TEST 1 ERROR: $($_.Exception.Message)"
}

Write-Host "`n=== TEST 2: DeviceManager Direct Connect ==="
try {
    $dm = New-Object -ComObject WIA.DeviceManager
    Write-Host "Devices count: $($dm.DeviceInfos.Count)"
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
        $devInfo = $dm.DeviceInfos.Item($i)
        $name = $devInfo.Properties.Item('Name').Value
        $id = $devInfo.DeviceID
        Write-Host "Dev: $i - $name [ID: $id]"
        try {
            $dev = $devInfo.Connect()
            Write-Host "  Connected to $name"
            Write-Host "  Items count: $($dev.Items.Count)"
            if ($dev.Items.Count -gt 0) {
                $item = $dev.Items.Item(1)
                $itemName = $item.Properties.Item('Item Name').Value
                Write-Host "  Item 1 Name: $itemName"
                try {
                    $img = $item.Transfer("{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}")
                    $testOut2 = "$PSScriptRoot\test_out2.jpg"
                    if (Test-Path $testOut2) { Remove-Item $testOut2 -Force }
                    $img.SaveFile($testOut2)
                    Write-Host "  TEST 2 SUCCESS: Saved to $testOut2"
                } catch {
                    Write-Host "  TEST 2 Transfer Error: $($_.Exception.Message)"
                }
            }
        } catch {
            Write-Host "  TEST 2 Connect Error: $($_.Exception.Message)"
        }
    }
} catch {
    Write-Host "TEST 2 ERROR: $($_.Exception.Message)"
}
