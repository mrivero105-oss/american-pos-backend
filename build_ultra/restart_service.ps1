# Restart Isaac POS backend service
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

$localProg = "C:\Users\mrive\AppData\Local\Programs\Isaac POS Ultra"
$env:PORT = "3005,5005,8080"
$env:JWT_SECRET = "4d0e0ed5b2e25fb26c0ce829cd8135a9e04c4eefdc881a2bb258d4aa98747ffe"
$env:SYNC_SECRET_KEY = "AMERICAN_POS_SYNC_SECRET_KEY_2024"

$nodeExe = Join-Path $localProg "node.exe"
$indexJs = Join-Path $localProg "index.js"
Start-Process -FilePath $nodeExe -ArgumentList "`"$indexJs`"" -WorkingDirectory $localProg -WindowStyle Hidden

$maxWait = 15
$ready = $false
for ($i = 0; $i -lt $maxWait; $i++) {
    Start-Sleep -Seconds 1
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:3005/hello" -UseBasicParsing -TimeoutSec 2
        if ($res.StatusCode -eq 200) {
            Write-Host "SERVER_RESTARTED_OK: Status $($res.StatusCode)" -ForegroundColor Green
            $ready = $true
            break
        }
    } catch {
        # still initializing
    }
}
if (-not $ready) {
    Write-Host "WAITING_FOR_SERVER..." -ForegroundColor Yellow
}
