[CmdletBinding()]
param(
    # Alternate checkout roots allow isolated regression tests; no credentials
    # or excluded private artifacts are ever echoed by this scanner.
    [string]$RepoPath = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath $RepoPath).Path
# Check the index as well: .gitignore cannot protect an already tracked secret.
$tracked = @(& git -C $repo ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the Git index.' }
$forbidden = $tracked | Where-Object {
    $_ -match '(^|/)(backups|audits|captures|screenshots|models|face_models)/' -or
    $_ -match '(^|/)(\.env(?:\..+)?|\.audit-key|local\.properties|secrets\.py)$' -and $_ -notmatch '\.example$' -or
    $_ -match '\.(apk|aab|jks|keystore|p12|pfx|pem|key|token|litertlm|onnx|tflite|db|sqlite\d*|jsonl|tar|zip|dump|dmp)$' -or
    $_ -match '^firmware/pico/(servo_channels|named_walk|dog_cal|dog_gait|gaze_cal|stock_commands)\.json$' -or
    $_ -eq 'firmware/pico/control_token.txt'
}
if ($forbidden) { $forbidden | ForEach-Object { Write-Host "Forbidden tracked path: $_" }; throw 'Private/runtime artifacts must not be tracked.' }
$excludedDirectories = @('.git', '.gradle', 'build', '.idea', '.cxx', 'models')
$excludedExtensions = @('.apk', '.aab', '.jar', '.class', '.bin', '.pb', '.tflite', '.litertlm', '.onnx',
    '.jpg', '.jpeg', '.png', '.gif', '.webp')
$patterns = [ordered]@{
    'private key block' = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    'GitHub token' = 'gh[opusr]_[A-Za-z0-9]{16,}'
    'GitHub fine-grained token' = 'github_pat_[A-Za-z0-9_]{22,}'
    'OpenAI-style key' = 'sk-[A-Za-z0-9_-]{16,}'
    'Google API key' = 'AIza[0-9A-Za-z_-]{25,}'
    'Slack token' = 'xox[baprs]-[0-9A-Za-z-]{10,}'
    'JWT' = 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
    'literal bearer credential' = 'Bearer\s+[A-Za-z0-9._~-]{16,}'
    'AWS access key ID' = '(?:AKIA|ASIA)[A-Z0-9]{16}'
}

$files = Get-ChildItem -LiteralPath $repo -Recurse -Force -File | Where-Object {
    $relative = $_.FullName.Substring($repo.Length).TrimStart('\', '/')
    $segments = $relative -split '[\\/]'
    -not ($segments | Where-Object { $excludedDirectories -contains $_ }) -and
    -not ($excludedExtensions -contains $_.Extension.ToLowerInvariant())
}

$hits = [System.Collections.Generic.List[object]]::new()
function Test-SecretText([string]$Text, [string]$FileName, [string]$Surface) {
    foreach ($entry in $patterns.GetEnumerator()) {
        if ($Text -match $entry.Value) {
            # Never print the match: CI logs are another publication surface.
            $hits.Add([pscustomobject]@{ Rule = $entry.Key; File = $FileName; Surface = $Surface })
        }
    }
}

# Check working/untracked source as well as Git's index. Otherwise someone can
# stage a credential, remove it only from disk, and accidentally commit the
# older staged secret despite a passing working-tree scan.
foreach ($file in $files) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { continue }
    Test-SecretText $text $file.FullName.Substring($repo.Length + 1) 'working tree'
}
foreach ($relative in $tracked) {
    if ($excludedExtensions -contains [IO.Path]::GetExtension($relative).ToLowerInvariant()) { continue }
    $staged = & git -C $repo show ":$relative"
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect staged path: $relative" }
    Test-SecretText ($staged -join "`n") $relative 'Git index'
}

if ($hits.Count -gt 0) {
    $hits | Sort-Object File, Rule, Surface -Unique | Format-Table -AutoSize
    throw 'Possible credential material found. Review and remove it before committing.'
}

Write-Host "Secret check passed across $($files.Count) working files and $($tracked.Count) indexed paths. This pattern check does not replace a full-history scan."
