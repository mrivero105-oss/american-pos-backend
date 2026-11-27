# Restart Isaac POS backend service
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

$localProg = if ($env:ISAAC_ULTRA_DIR) { $env:ISAAC_ULTRA_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\Isaac POS Ultra" }
if (-not $env:PORT) { $env:PORT = "3005,5005,8080" }
$envFile = Join-Path $localProg ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '^\s*[^#=\s]+\s*=' } | ForEach-Object {
        $pair = $_ -split '=', 2
        $k = $pair[0].Trim()
        $v = $pair[1].Trim().Trim('"').Trim("'")
        if (-not [Environment]::GetEnvironmentVariable($k, "Process")) {
            [Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
}
if (-not $env:JWT_SECRET -or -not $env:SYNC_SECRET_KEY) {
    Write-Warning "JWT_SECRET o SYNC_SECRET_KEY no definidos en entorno/.env; index.js usará el SecretVault DPAPI o fallará de forma segura."
}

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
