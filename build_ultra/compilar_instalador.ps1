# Compilador Automático de Isaac POS Ultra con codificación nativa UTF-8
$nsisExe = Get-ChildItem (Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis\*\Bin\makensis.exe") -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $nsisExe) {
    $cmdNsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($cmdNsis) { $nsisExe = $cmdNsis.Source }
}
$nsiScript = Join-Path $PSScriptRoot "installer_ultra.nsi"

if (-not $nsisExe -or -not (Test-Path $nsisExe)) {
    Write-Error "No se encontró el compilador NSIS en Cache\electron-builder ni en PATH."
    exit 1
}

Write-Host "Compilando Isaac-POS-Ultra-Setup.exe con codificación nativa UTF-8..." -ForegroundColor Cyan
& $nsisExe /INPUTCHARSET UTF8 $nsiScript

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Instalador compilado con éxito en dist_installers\Isaac-POS-Ultra-Setup.exe" -ForegroundColor Green
} else {
    Write-Error "Fallo durante la compilación del instalador."
}
