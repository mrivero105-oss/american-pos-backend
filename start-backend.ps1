# American POS Backend - Script de Inicio Local
Set-Location $PSScriptRoot
Write-Host "=== Iniciando American POS Backend ===" -ForegroundColor Cyan
Write-Host "Puerto: 3000" -ForegroundColor Yellow
$env:PORT = 3000
npm start
