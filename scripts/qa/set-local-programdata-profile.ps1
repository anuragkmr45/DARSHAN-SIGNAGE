$ErrorActionPreference = 'Stop'

$source = 'C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE\out\WIN-QA-20261105-local-docker\player-site-config.json'
$destinationDirectory = 'C:\ProgramData\DARSHAN'
$destination = Join-Path $destinationDirectory 'config.json'
$backup = Join-Path $destinationDirectory 'config.pre-local-20261107.json'
$result = 'C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE\out\WIN-QA-20261105-local-docker\programdata-profile-update.json'

if (-not (Test-Path -LiteralPath $source)) {
    throw "Approved local site profile is missing: $source"
}

$sourceProfile = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
if ($sourceProfile.player.backend.baseUrl -ne 'http://localhost:18444') {
    throw 'The source profile does not target the approved local CMS.'
}
if ($sourceProfile.player.backend.socketIoUrl -ne 'ws://localhost:18444/socket.io') {
    throw 'The source profile does not target the approved local socket endpoint.'
}

New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
if ((Test-Path -LiteralPath $destination) -and -not (Test-Path -LiteralPath $backup)) {
    Copy-Item -LiteralPath $destination -Destination $backup
}
Copy-Item -LiteralPath $source -Destination $destination -Force

$installedProfile = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
if ($installedProfile.player.backend.baseUrl -ne 'http://localhost:18444') {
    throw 'ProgramData profile verification failed.'
}

[ordered]@{
    updatedAt = (Get-Date).ToString('o')
    destination = $destination
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    baseUrl = $installedProfile.player.backend.baseUrl
    socketIoUrl = $installedProfile.player.backend.socketIoUrl
    backup = if (Test-Path -LiteralPath $backup) { $backup } else { $null }
} | ConvertTo-Json | Set-Content -LiteralPath $result -Encoding utf8
