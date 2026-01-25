# Fix JavaScript Encoding Issues
$ErrorActionPreference = "Stop"

Write-Host "Fixing JavaScript file encodings..." -ForegroundColor Cyan

# List of JavaScript files with encoding issues
$files = @(
    "public\js\modules\pos\CartManager.js"
)

foreach ($file in $files) {
    $fullPath = Join-Path $PSScriptRoot $file
    
    if (Test-Path $fullPath) {
        Write-Host "Processing: $file" -ForegroundColor Yellow
        
        # Read content as UTF-8
        $content = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)
        
        # Fix specific character encoding artifacts in Spanish
        $replacements = @{
            "¿Estás" = "¿Estás"
            "acción" = "acción"
            "Sí"     = "Sí"
        }
        
        foreach ($key in $replacements.Keys) {
            if ($content -match [regex]::Escape($key)) {
                Write-Host "  - Found encoding issue with: $key" -ForegroundColor Red
            }
            $content = $content -replace [regex]::Escape($key), $replacements[$key]
        }
        
        # Write back as UTF-8 without BOM
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($fullPath, $content, $utf8NoBom)
        
        Write-Host "  ✓ Fixed: $file" -ForegroundColor Green
    }
    else {
        Write-Host "  ✗ Not found: $file" -ForegroundColor Red
    }
}

Write-Host "`nJavaScript encoding fixes completed!" -ForegroundColor Green
