if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Solicitando permisos de Administrador..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

Clear-Host
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Activando Entorno Aislado de Windows (Windows Sandbox)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Activando característica... Por favor espera unos segundos..." -ForegroundColor Yellow
Write-Host ""

$process = Start-Process dism.exe -ArgumentList "/Online /Enable-Feature /FeatureName:Containers-DisposableClientVM /All /NoRestart" -Wait -NoNewWindow -PassThru

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010) {
    Write-Host "¡LISTO! Windows Sandbox se ha activado correctamente." -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANTE: Debes REINICIAR tu computadora para aplicar los cambios." -ForegroundColor Yellow
} else {
    Write-Host "Resultado del comando DISM (Código: $($process.ExitCode))." -ForegroundColor Yellow
    Write-Host "Si ya estaba activado, recuerda reiniciar para usar Sandbox." -ForegroundColor Yellow
}
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Presiona Enter para cerrar esta ventana"
