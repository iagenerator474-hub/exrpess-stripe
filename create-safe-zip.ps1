# Zip du projet sans fichiers dangereux (secrets, node_modules, .git, etc.)
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path $PSScriptRoot).Path
$zipPath = Join-Path (Split-Path $projectRoot -Parent) "express-stripe-auth-skeleton-safe.zip"

$excludeDirs = @("node_modules", ".git", "dist", "build", "coverage", ".next", "out", ".turbo", ".cursor", "_zip_temp")
$excludePatterns = @("\.env", "\.env\.", "\.log$", "\.DS_Store$", "Thumbs\.db$")

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")

function ShouldExcludeFile($name) {
    foreach ($pat in $excludePatterns) {
        if ($name -match $pat) { return $true }
    }
    if ($name -like "*.log") { return $true }
    return $false
}

$baseName = "express-stripe-auth-skeleton"
$count = 0

function Add-DirToZip($dirPath) {
    $children = $null
    try {
        $children = Get-ChildItem -Path $dirPath -Force -ErrorAction SilentlyContinue
    } catch {
        return
    }
    if (-not $children) { return }
    foreach ($item in $children) {
        $rel = $item.FullName.Substring($projectRoot.Length).TrimStart("\")
        if ($item.PSIsContainer) {
            if ($excludeDirs -contains $item.Name) { continue }
            Add-DirToZip $item.FullName
        } else {
            if (ShouldExcludeFile $item.Name) { continue }
            $entryName = "$baseName/$rel" -replace "\\", "/"
            try {
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $item.FullName, $entryName, "Optimal") | Out-Null
                $script:count++
            } catch {
                Write-Warning "Skip: $rel"
            }
        }
    }
}

Add-DirToZip $projectRoot
$zip.Dispose()
Write-Host "OK: $count fichiers -> $zipPath"