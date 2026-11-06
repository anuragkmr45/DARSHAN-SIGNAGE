$ErrorActionPreference = 'Stop'

$playerRoot = 'C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE\darshan-player'
$node20Root = 'C:\Users\KIIT0001\AppData\Local\Temp\darshan-node20-qa\node-v20.20.2-win-x64'
$resultPath = 'C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE\qa-artifacts\evidence\windows-player-admin-symlink-tests-2026-11-06.log'
$exitPath = 'C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE\qa-artifacts\evidence\windows-player-admin-symlink-tests-2026-11-06.exit.txt'
$testPattern = @(
  'rejects a marker symlink, an unknown marker and identity/cache paths outside the owned profile',
  'reclaims a marked dead-process stage on restart and preserves uncertain paths',
  'rejects unsafe paths, wrong canonical hashes and unprepared HLS without touching user files',
  'rejects an on-disk symlink even when its target has the approved checksum',
  'rejects a linked credential path without changing the target file'
) -join '|'

$env:NO_COLOR = '1'
$env:Path = "$node20Root;C:\Program Files\Git\usr\bin;$env:Path"
Set-Location -LiteralPath $playerRoot

& npm.cmd exec -- mocha --config .mocharc.json `
  --spec 'test/unit/main/live-development-profile.test.ts' `
  --spec 'test/unit/services/approved-cache-asset.test.ts' `
  --spec 'test/unit/services/cache-manager.test.ts' `
  --spec 'test/unit/services/pairing-service.test.ts' `
  --grep $testPattern 2>&1 | Tee-Object -FilePath $resultPath

$testExitCode = $LASTEXITCODE
Set-Content -LiteralPath $exitPath -Value $testExitCode -NoNewline
exit $testExitCode
