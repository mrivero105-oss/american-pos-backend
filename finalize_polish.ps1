$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$indexPath = 'c:\Users\mrive\AndroidStudioProjects\american-pos-backend\public\index.html'
$cssPath = 'c:\Users\mrive\AndroidStudioProjects\american-pos-backend\public\css\main.css'

# Fix Encoding in index.html
if (Test-Path $indexPath) {
    $content = Get-Content $indexPath
    $content = $content -replace 'CategorÃ­a', 'Categoría'
    $content = $content -replace 'SesiÃ³n', 'Sesión'
    $content = $content -replace 'CÃ³digo', 'Código'
    $content = $content -replace 'DÃ­a', 'Día'
    $content = $content -replace 'CrÃ©dito', 'Crédito'
    $content = $content -replace 'MÃ¡s', 'Más'
    $content = $content -replace 'especÃ­ficamente', 'específicamente'
    $content = $content -replace 'GestiÃ³n', 'Gestión'
    $content = $content -replace 'MÃ©todo', 'Método'
    $content = $content -replace 'contraseÃ±a', 'contraseña'
    $content = $content -replace 'contraseÃ±as', 'contraseñas'
    $content = $content -replace 'AdministraciÃ³n', 'Administración'
    $content = $content -replace 'BolÃ­vares', 'Bolívares'
    $content = $content -replace 'CategorÃ­as', 'Categorías'
    
    [System.IO.File]::WriteAllLines($indexPath, $content, $utf8NoBom)
    Write-Host "Fixed index.html encoding and special characters."
}

# Fix main.css (Remove debug border and fix any encoding if needed)
if (Test-Path $cssPath) {
    $content = Get-Content $cssPath
    $content = $content -replace 'border: 2px solid red !important;', ''
    
    [System.IO.File]::WriteAllLines($cssPath, $content, $utf8NoBom)
    Write-Host "Cleaned up main.css."
}
