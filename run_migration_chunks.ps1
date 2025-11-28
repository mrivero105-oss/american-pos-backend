$chunks = Get-ChildItem -Path ".\migration_chunks" -Filter "*.sql" | Sort-Object { [int]($_.BaseName -replace 'chunk_', '') }

foreach ($chunk in $chunks) {
    Write-Host "Executing $($chunk.Name)..."
    $command = "echo y | npx wrangler d1 execute american-pos-db --file=$($chunk.FullName) --remote"
    Invoke-Expression $command
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to execute $($chunk.Name)"
        break
    }
    Start-Sleep -Seconds 2
}
