$ErrorActionPreference = "Stop"

$sourceDir = Get-Location
$tempDir = "C:\Temp\american-pos-build"
$distDir = Join-Path $sourceDir "dist"

Write-Host ">>> STARTING ISOLATED BUILD <<<" -ForegroundColor Cyan

# 1. Cleaning Temp Dir
if (Test-Path $tempDir) {
    Write-Host "Cleaning temp dir..."
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null
Write-Host "Temp dir created: $tempDir" -ForegroundColor Green

# 2. Copying Files
Write-Host "Copying project files..."
$exclude = @("node_modules", "dist", ".git", ".idea", "data", "pos.sqlite", "pos.sqlite-journal")
Get-ChildItem -Path $sourceDir -Exclude $exclude | Copy-Item -Destination $tempDir -Recurse
Write-Host "Files copied." -ForegroundColor Green

# 3. Installing Dependencies
Set-Location $tempDir
Write-Host "Installing dependencies (npm install)..."
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "Dependencies installed." -ForegroundColor Green

# 4. Rebuilding Native Modules
Write-Host "Rebuilding native modules (electron-rebuild)..."
./node_modules/.bin/electron-rebuild
if ($LASTEXITCODE -ne 0) { throw "electron-rebuild failed" }
Write-Host "Native modules rebuilt." -ForegroundColor Green

# 5. Building Executable
Write-Host "Building .exe (electron-builder)..."
cmd /c "npx electron-builder --win --x64 > build_log.txt 2>&1"
if ($LASTEXITCODE -ne 0) { 
    Get-Content build_log.txt | Select-Object -Last 20
    throw "electron-builder failed (check build_log.txt)" 
}
Write-Host "Build completed." -ForegroundColor Green

# 6. Copying Result
Write-Host "Copying installers back to original dist folder..."
$builtExes = Get-ChildItem "$tempDir\dist\*.exe"

if ($builtExes) {
    if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
    foreach ($exe in $builtExes) {
        Copy-Item $exe.FullName -Destination $distDir -Force
        Write-Host "SUCCESS: Installer retrieved: $distDir\$($exe.Name)" -ForegroundColor Magenta
    }
}
else {
    Write-Host "ERROR: No .exe file found in temp dist." -ForegroundColor Red
}

Set-Location $sourceDir
