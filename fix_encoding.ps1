$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$files = @(
    'c:\Users\mrive\AndroidStudioProjects\american-pos-backend\public\index.html',
    'c:\Users\mrive\AndroidStudioProjects\american-pos-backend\public\css\main.css'
)

foreach ($file in $files) {
    if (Test-Path $file) {
        $content = Get-Content $file
        [System.IO.File]::WriteAllLines($file, $content, $utf8NoBom)
        Write-Host "Fixed encoding for: $file"
    }
    else {
        Write-Warning "File not found: $file"
    }
}
