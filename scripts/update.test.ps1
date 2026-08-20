Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$temporaryBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $temporaryBase "mishistorias-updater-test-$([guid]::NewGuid().ToString('N'))"
$updater = Join-Path $PSScriptRoot 'update.ps1'
$portableStart = Join-Path $PSScriptRoot 'start.bat'
$portableReadme = Join-Path $PSScriptRoot 'release-readme.md'

function Assert-Equal($Actual, $Expected, [string]$Message) {
  if ($Actual -ne $Expected) {
    throw "$Message Esperado: $Expected. Actual: $Actual."
  }
}

function New-InstallFixture([string]$Name, [ValidateSet('portable', 'legacy')][string]$Kind) {
  $installRoot = Join-Path (Join-Path $testRoot $Name) 'installation'
  $installDirectory = Join-Path $installRoot 'install1'
  New-Item -ItemType Directory -Path (Join-Path $installDirectory 'server') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $installDirectory '.data') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $installDirectory 'start-server.mjs') -Value '// old server'
  Set-Content -LiteralPath (Join-Path $installDirectory 'server\index.mjs') -Value '// old entry'
  Set-Content -LiteralPath (Join-Path $installDirectory 'old.txt') -Value 'old'
  Set-Content -LiteralPath (Join-Path $installDirectory '.data\keep.txt') -Value 'private data'

  if ($Kind -eq 'portable') {
    Set-Content -LiteralPath (Join-Path $installRoot 'start.bat') -Value '@echo off'
    Set-Content -LiteralPath (Join-Path $installRoot 'node.exe') -Value 'installed node'
  } else {
    Set-Content -LiteralPath (Join-Path $installRoot 'go.bat') -Value '@echo off'
  }

  return $installRoot
}

function New-PortableRelease([string]$Name, [switch]$WithoutLicense) {
  $releaseRoot = Join-Path (Join-Path $testRoot $Name) 'release'
  $fixtureRoot = Join-Path $releaseRoot 'fixture'
  $fixtureInstall = Join-Path $fixtureRoot 'install1'
  New-Item -ItemType Directory -Path (Join-Path $fixtureInstall 'server') -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $fixtureInstall 'start-server.mjs') -Value '// new server'
  Set-Content -LiteralPath (Join-Path $fixtureInstall 'server\index.mjs') -Value '// new entry'
  Set-Content -LiteralPath (Join-Path $fixtureInstall 'new.txt') -Value 'new'
  Set-Content -LiteralPath (Join-Path $fixtureRoot 'node.exe') -Value 'release node'
  Copy-Item -LiteralPath $portableStart -Destination (Join-Path $fixtureRoot 'start.bat')
  Copy-Item -LiteralPath $updater -Destination (Join-Path $fixtureRoot 'update.ps1')
  Copy-Item -LiteralPath $portableReadme -Destination (Join-Path $fixtureRoot 'README.md')
  if (!$WithoutLicense) {
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'NODE-LICENSE.txt') -Value 'Node.js license fixture'
  }

  $archivePath = Join-Path $releaseRoot 'app.zip'
  Compress-Archive -Path (Join-Path $fixtureRoot '*') -DestinationPath $archivePath
  $checksumPath = Join-Path $releaseRoot 'app.zip.sha256'
  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $checksumPath -Value "$hash  app.zip"

  $releasePath = Join-Path $releaseRoot 'release.json'
  @{
    tag_name = 'main-test123'
    assets = @(
      @{ name = 'app.zip'; browser_download_url = $archivePath }
      @{ name = 'app.zip.sha256'; browser_download_url = $checksumPath }
    )
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $releasePath

  return [pscustomobject]@{
    ArchivePath = $archivePath
    ChecksumPath = $checksumPath
    ReleasePath = $releasePath
  }
}

function Assert-AppUpdated([string]$InstallRoot) {
  $installDirectory = Join-Path $InstallRoot 'install1'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $installDirectory 'new.txt') -Raw).Trim() 'new' 'No instaló archivo nuevo.'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $installDirectory 'old.txt')) $false 'No eliminó archivo antiguo.'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $installDirectory '.data\keep.txt') -Raw).Trim() 'private data' 'No conservó .data.'
}

try {
  $startContent = Get-Content -LiteralPath $portableStart -Raw
  Assert-Equal ($startContent.Contains('set "ROOT=%~dp0"')) $true 'start.bat no obtiene su carpeta.'
  Assert-Equal ($startContent.Contains('%ROOT%node.exe')) $true 'start.bat no usa node.exe relativo.'
  Assert-Equal ($startContent.Contains('%ROOT%install1\start-server.mjs')) $true 'start.bat no usa servidor relativo.'

  $portableRoot = New-InstallFixture 'portable-success' 'portable'
  $portableRelease = New-PortableRelease 'portable-success'
  & $updater -InstallRoot $portableRoot -Port 49123 -NoRestart -ReleaseApi $portableRelease.ReleasePath
  Assert-AppUpdated $portableRoot
  Assert-Equal (Get-Content -LiteralPath (Join-Path $portableRoot 'node.exe') -Raw).Trim() 'installed node' 'Actualización reemplazó Node portable.'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $portableRoot 'go.bat')) $false 'Actualización creó go.bat en instalación portable.'

  $legacyRoot = New-InstallFixture 'legacy-success' 'legacy'
  $legacyRelease = New-PortableRelease 'legacy-success'
  & $updater -InstallRoot $legacyRoot -Port 49124 -NoRestart -ReleaseApi $legacyRelease.ReleasePath
  Assert-AppUpdated $legacyRoot
  Assert-Equal (Test-Path -LiteralPath (Join-Path $legacyRoot 'go.bat') -PathType Leaf) $true 'Actualización eliminó go.bat antiguo.'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $legacyRoot 'start.bat')) $false 'Actualización migró lanzador antiguo.'
  Assert-Equal (Test-Path -LiteralPath (Join-Path $legacyRoot 'node.exe')) $false 'Actualización migró Node antiguo.'

  $defaultRoot = New-InstallFixture 'default-root' 'portable'
  $defaultRelease = New-PortableRelease 'default-root'
  $installedUpdater = Join-Path $defaultRoot 'update.ps1'
  Copy-Item -LiteralPath $updater -Destination $installedUpdater
  & $installedUpdater -Port 49126 -NoRestart -ReleaseApi $defaultRelease.ReleasePath
  Assert-AppUpdated $defaultRoot

  Set-Content -LiteralPath $portableRelease.ChecksumPath -Value "$('0' * 64)  app.zip"
  $checksumFailed = $false
  try {
    & $updater -InstallRoot $portableRoot -Port 49123 -NoRestart -ReleaseApi $portableRelease.ReleasePath
  } catch {
    $checksumFailed = $_.Exception.Message -match 'Checksum de app.zip no coincide'
  }
  Assert-Equal $checksumFailed $true 'Checksum inválido no canceló actualización.'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $portableRoot 'install1\new.txt') -Raw).Trim() 'new' 'Checksum inválido alteró instalación vigente.'

  $incompleteRoot = New-InstallFixture 'incomplete-release' 'legacy'
  $incompleteRelease = New-PortableRelease 'incomplete-release' -WithoutLicense
  $structureFailed = $false
  try {
    & $updater -InstallRoot $incompleteRoot -Port 49125 -NoRestart -ReleaseApi $incompleteRelease.ReleasePath
  } catch {
    $structureFailed = $_.Exception.Message -match 'app.zip no contiene NODE-LICENSE.txt'
  }
  Assert-Equal $structureFailed $true 'ZIP incompleto no canceló actualización.'
  Assert-Equal (Get-Content -LiteralPath (Join-Path $incompleteRoot 'install1\old.txt') -Raw).Trim() 'old' 'ZIP incompleto alteró instalación vigente.'

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
