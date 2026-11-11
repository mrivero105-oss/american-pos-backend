# Auto-elevación a Administrador si no lo está
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$sourceLib = "$PSScriptRoot\build_temp\pgvector_extracted\lib\vector.dll"
$sourceShare = "$PSScriptRoot\build_temp\pgvector_extracted\share\extension"
$targetLib = "C:\Program Files\PostgreSQL\16\lib"
$targetShare = "C:\Program Files\PostgreSQL\16\share\extension"

if (-not (Test-Path $sourceLib)) {
    Write-Host "❌ No se encontró $sourceLib. Descargue pgvector primero." -ForegroundColor Red
    pause
    exit 1
}

Write-Host "Copiando vector.dll hacia $targetLib..." -ForegroundColor Cyan
Copy-Item -Path $sourceLib -Destination $targetLib -Force

Write-Host "Copiando extensiones hacia $targetShare..." -ForegroundColor Cyan
Copy-Item -Path "$sourceShare\*" -Destination $targetShare -Force

Write-Host "✅ Archivos de pgvector instalados con éxito en PostgreSQL 16." -ForegroundColor Green

Write-Host "Activando extensión 'vector' en la base de datos 'americanpos'..." -ForegroundColor Cyan
$psqlPath = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
if (Test-Path $psqlPath) {
    $env:PGPASSWORD = "postgres"
    & $psqlPath -h 127.0.0.1 -p 5432 -U postgres -d americanpos -c "CREATE EXTENSION IF NOT EXISTS vector;"
    & $psqlPath -h 127.0.0.1 -p 5432 -U postgres -d americanpos -c "ALTER TABLE `"Products`" ADD COLUMN IF NOT EXISTS `"embedding`" vector(768);"
    & $psqlPath -h 127.0.0.1 -p 5432 -U postgres -d americanpos -c "CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw ON `"Products`" USING hnsw (`"embedding`" vector_cosine_ops);"
    Write-Host "🎉 Extensión vector, columna de embeddings e índice HNSW activados al 100%." -ForegroundColor Green
} else {
    Write-Host "ℹ️ Los archivos quedaron instalados. La migración del backend activará la extensión automáticamente al reiniciar." -ForegroundColor Yellow
}

Write-Host "Presione cualquier tecla para cerrar esta ventana..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
