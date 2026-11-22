# Delegador único hacia el instalador canónico y endurecido de PostgreSQL 16 (sin contraseña por defecto ni exposición 0.0.0.0/0)
$canonical = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\instalar_postgresql.ps1"
if (-not (Test-Path -LiteralPath $canonical)) {
    throw "No se encontró el instalador canónico de PostgreSQL en: $canonical"
}
& $canonical @args
exit $LASTEXITCODE
