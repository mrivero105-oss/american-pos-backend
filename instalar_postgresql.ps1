param(
    [string]$SourceDir = "",
    [string]$DbPassword = "",
    [string]$ExpectedSha256 = "",
    [switch]$LocalhostOnly,
    [switch]$NoGui
)

$targetScript = Join-Path $PSScriptRoot "american-pos-backend\scripts\instalar_postgresql.ps1"
if (-not (Test-Path $targetScript)) {
    Write-Error "No se encontró el script canónico en $targetScript"
    exit 1
}

& $targetScript @PSBoundParameters
exit $LASTEXITCODE
