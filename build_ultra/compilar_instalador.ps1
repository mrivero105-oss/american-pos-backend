# Compilador Automático de Isaac POS Ultra con codificación nativa UTF-8
$nsisExe = "C:\Users\mrive\AppData\Local\electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe"
$nsiScript = Join-Path $PSScriptRoot "installer_ultra.nsi"

if (-not (Test-Path $nsisExe)) {
    Write-Error "No se encontró el compilador NSIS en: $nsisExe"
    exit 1
}

Write-Host "Compilando Isaac-POS-Ultra-Setup.exe con codificación nativa UTF-8..." -ForegroundColor Cyan
& $nsisExe /INPUTCHARSET UTF8 $nsiScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Instalador compilado con éxito en dist_installers\Isaac-POS-Ultra-Setup.exe" -ForegroundColor Green
} else {
    Write-Error "Fallo durante la compilación del instalador."
}
