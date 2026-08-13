[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$excludedDirectories = @('.git', '.gradle', 'build', '.idea', '.cxx', 'models')
$excludedExtensions = @('.apk', '.aab', '.jar', '.class', '.bin', '.pb', '.tflite', '.litertlm', '.onnx')
$patterns = [ordered]@{
    'private key block' = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'GitHub token' = 'gh[opusr]_[A-Za-z0-9]{16,}'
    'OpenAI-style key' = 'sk-[A-Za-z0-9_-]{16,}'
    'Google API key' = 'AIza[0-9A-Za-z_-]{25,}'
    'Slack token' = 'xox[baprs]-[0-9A-Za-z-]{10,}'
    'JWT' = 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
    'literal bearer credential' = 'Bearer\s+[A-Za-z0-9._~-]{16,}'
}

$files = Get-ChildItem -LiteralPath $repo -Recurse -Force -File | Where-Object {
    $relative = $_.FullName.Substring($repo.Length).TrimStart('\', '/')
    $segments = $relative -split '[\\/]'
    -not ($segments | Where-Object { $excludedDirectories -contains $_ }) -and
    -not ($excludedExtensions -contains $_.Extension.ToLowerInvariant())
}

$hits = @()
foreach ($file in $files) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { continue }
    foreach ($entry in $patterns.GetEnumerator()) {
        if ($text -match $entry.Value) {
            $hits += [pscustomobject]@{
                Rule = $entry.Key
                File = $file.FullName.Substring($repo.Length + 1)
            }
        }
    }
}

if ($hits.Count -gt 0) {
    $hits | Sort-Object File, Rule -Unique | Format-Table -AutoSize
    throw 'Possible credential material found. Review and remove it before committing.'
}

Write-Host "Secret check passed across $($files.Count) source/documentation files."
