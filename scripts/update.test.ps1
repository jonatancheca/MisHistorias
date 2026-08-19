Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $temporaryBase "mishistorias-updater-test-$([guid]::NewGuid().ToString('N'))"
$installRoot = Join-Path $testRoot 'installation'
$installDirectory = Join-Path $installRoot 'install1'
$fixtureRoot = Join-Path $testRoot 'fixture'
$archiveRoot = Join-Path $testRoot 'archive'
$updater = Join-Path $PSScriptRoot 'update.ps1'

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) {
    throw "$Message Esperado: $Expected. Actual: $Actual."
  }
}

try {
  New-Item -ItemType Directory -Path $installDirectory, $fixtureRoot, $archiveRoot | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $installDirectory 'server') | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $installDirectory '.data') | Out-Null
  Set-Content -LiteralPath (Join-Path $installDirectory 'start-server.mjs') -Value '// old server'
  Set-Content -LiteralPath (Join-Path $installDirectory 'server\index.mjs') -Value '// old entry'
  Set-Content -LiteralPath (Join-Path $installDirectory 'old.txt') -Value 'old'
  Set-Content -LiteralPath (Join-Path $installDirectory '.data\keep.txt') -Value 'private data'
  Set-Content -LiteralPath (Join-Path $installRoot 'go.bat') -Value '@echo off'

  New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'server') | Out-Null
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'start-server.mjs') -Value '// new server'
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'server\index.mjs') -Value '// new entry'
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'new.txt') -Value 'new'

  $archivePath = Join-Path $archiveRoot 'app.zip'
  Compress-Archive -Path (Join-Path $fixtureRoot '*') -DestinationPath $archivePath
  $checksumPath = Join-Path $archiveRoot 'app.zip.sha256'
  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $checksumPath -Value "$hash  app.zip"

  $releasePath = Join-Path $archiveRoot 'release.json'
  @{
    tag_name = 'main-test123'
    assets = @(
      @{ name = 'app.zip'; browser_download_url = $archivePath }
      @{ name = 'app.zip.sha256'; browser_download_url = $checksumPath }
    )
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $releasePath

  & $updater -InstallRoot $installRoot -Port 49123 -NoRestart -ReleaseApi $releasePath

  Assert-Equal (Get-Content -LiteralPath (Join-Path $installDirectory 'new.txt') -Raw).Trim() 'new' 'No instaló archivo nuevo.'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $installDirectory 'old.txt')) $false 'No eliminó archivo antiguo.'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $installDirectory '.data\keep.txt') -Raw).Trim() 'private data' 'No conservó .data.'

  Set-Content -LiteralPath $checksumPath -Value "$('0' * 64)  app.zip"
  $failedAsExpected = $false
  try {
    & $updater -InstallRoot $installRoot -Port 49123 -NoRestart -ReleaseApi $releasePath
  } catch {
    $failedAsExpected = $_.Exception.Message -match 'Checksum de app.zip no coincide'
  }
  Assert-Equal $failedAsExpected $true 'Checksum inválido no canceló actualización.'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $installDirectory 'new.txt') -Raw).Trim() 'new' 'Fallo alteró instalación vigente.'

  Write-Host 'Updater tests passed.'
} finally {
  $resolved = [System.IO.Path]::GetFullPath($testRoot)
  $expectedPrefix = "$temporaryBase\mishistorias-updater-test-"
  if (
    $resolved.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and
    (Test-Path -LiteralPath $resolved)
  ) {
    $reparsePoint = Get-ChildItem -LiteralPath $resolved -Force -Recurse -ErrorAction Stop |
      Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
      Select-Object -First 1
    if ($reparsePoint) { throw "Test creó enlace inesperado: $($reparsePoint.FullName)" }
    Remove-Item -LiteralPath $resolved -Force -Recurse -ErrorAction Stop
  }
}
