[CmdletBinding()]
param(
  [Parameter()]
  [string]$InstallRoot = 'C:\local\MisHistoriasInstall',

  [Parameter()]
  [ValidateRange(1, 65535)]
  [int]$Port = 3010,

  [Parameter()]
  [switch]$NoRestart,

  [Parameter()]
  [string]$ReleaseApi = 'https://api.github.com/repos/jonatancheca/MisHistorias/releases/latest'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requestHeaders = @{
  Accept = 'application/vnd.github+json'
  'User-Agent' = 'MisHistorias-updater'
  'X-GitHub-Api-Version' = '2026-03-10'
}

function Get-LatestRelease([string]$Source) {
  if (Test-Path -LiteralPath $Source -PathType Leaf) {
    return Get-Content -LiteralPath $Source -Raw | ConvertFrom-Json
  }
  return Invoke-RestMethod -Uri $Source -Headers $requestHeaders -TimeoutSec 30
}

function Receive-Asset([string]$Source, [string]$Destination, [int]$TimeoutSec) {
  if (Test-Path -LiteralPath $Source -PathType Leaf) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
    return
  }
  Invoke-WebRequest -Uri $Source -OutFile $Destination -Headers $requestHeaders -TimeoutSec $TimeoutSec
}

function Get-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Assert-SafeChildPath([string]$Path, [string]$Parent) {
  $fullPath = Get-FullPath $Path
  $fullParent = Get-FullPath $Parent
  $prefix = "$fullParent\"
  if (!$fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Ruta fuera de la instalación: $fullPath"
  }
  return $fullPath
}

function Assert-NoReparsePoints([string]$Path) {
  if (!(Test-Path -LiteralPath $Path)) { return }
  $root = Get-Item -LiteralPath $Path -Force
  if (($root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "No se admite un enlace o junction: $Path"
  }
  $link = Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction Stop |
    Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
    Select-Object -First 1
  if ($link) { throw "No se admite un enlace o junction: $($link.FullName)" }
}

function Remove-SafeTree([string]$Path, [string]$Parent) {
  $safePath = Assert-SafeChildPath $Path $Parent
  if (!(Test-Path -LiteralPath $safePath)) { return }
  Assert-NoReparsePoints $safePath
  Remove-Item -LiteralPath $safePath -Force -Recurse -ErrorAction Stop
}

function Get-ListeningProcessIds([int]$LocalPort) {
  return @(
    Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  )
}

function Test-IsExpectedServerProcess($Process, [string]$StartScript, [string]$RelativeScript) {
  if (!$Process -or $Process.Name -notin @('node', 'node.exe')) { return $false }
  $commandLine = [string]$Process.CommandLine
  if (!$commandLine) { return $false }
  $normalized = $commandLine.Replace('/', '\')
  $prefix = '(?i)(?:^|[\s"])'
  $suffix = '(?:$|[\s"])'
  return $normalized -match ($prefix + [regex]::Escape($StartScript) + $suffix) -or
    $normalized -match ($prefix + [regex]::Escape($RelativeScript) + $suffix)
}

function Stop-AppServer([string]$StartScript, [string]$RelativeScript, [int]$LocalPort) {
  $listenerIds = @(Get-ListeningProcessIds $LocalPort)
  if ($listenerIds.Count -eq 0) { return $false }
  if ($listenerIds.Count -ne 1) {
    throw "Puerto $LocalPort tiene varios procesos. Actualización cancelada."
  }

  $listenerPid = [int]$listenerIds[0]
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerPid" -ErrorAction Stop
  if (!(Test-IsExpectedServerProcess $process $StartScript $RelativeScript)) {
    throw "Puerto $LocalPort pertenece a otro proceso. Actualización cancelada."
  }

  Stop-Process -Id $listenerPid -ErrorAction Stop
  $deadline = (Get-Date).AddSeconds(15)
  while (@(Get-ListeningProcessIds $LocalPort).Count -gt 0) {
    if ((Get-Date) -ge $deadline) {
      throw "Servidor no liberó puerto $LocalPort."
    }
    Start-Sleep -Milliseconds 250
  }
  return $true
}

function Start-AppServer([string]$GoBat, [string]$WorkingDirectory, [int]$LocalPort) {
  Start-Process -FilePath $GoBat -WorkingDirectory $WorkingDirectory -WindowStyle Hidden | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  do {
    try {
      $health = Invoke-RestMethod -Uri "http://localhost:$LocalPort/api/health" -TimeoutSec 3
      if ($health.ok -eq $true) { return }
    } catch {
      # Servidor aún arrancando.
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Servidor actualizado no respondió correctamente en puerto $LocalPort."
}

function Get-ReleaseAssetUrl($Release, [string]$Name) {
  $asset = @($Release.assets | Where-Object { $_.name -eq $Name })
  if ($asset.Count -ne 1 -or ![string]$asset[0].browser_download_url) {
    throw "Release no contiene exactamente un asset $Name."
  }
  return [string]$asset[0].browser_download_url
}

$installRootPath = Get-FullPath $InstallRoot
$driveRoot = [System.IO.Path]::GetPathRoot($installRootPath).TrimEnd('\')
if (!$installRootPath -or $installRootPath -eq $driveRoot) {
  throw 'InstallRoot debe ser una carpeta concreta, nunca la raíz de una unidad.'
}
if (!(Test-Path -LiteralPath $installRootPath -PathType Container)) {
  throw "No existe InstallRoot: $installRootPath"
}

$installDirectory = Assert-SafeChildPath (Join-Path $installRootPath 'install1') $installRootPath
$goBat = Assert-SafeChildPath (Join-Path $installRootPath 'go.bat') $installRootPath
$startScript = Assert-SafeChildPath (Join-Path $installDirectory 'start-server.mjs') $installRootPath
$relativeScript = 'install1\start-server.mjs'

if (!(Test-Path -LiteralPath $installDirectory -PathType Container)) {
  throw "No existe instalación: $installDirectory"
}
if (!(Test-Path -LiteralPath $goBat -PathType Leaf)) { throw "No existe $goBat" }
if (!(Test-Path -LiteralPath $startScript -PathType Leaf)) { throw "No existe $startScript" }
Assert-NoReparsePoints $installDirectory

$operationId = [guid]::NewGuid().ToString('N')
$downloadDirectory = Assert-SafeChildPath (Join-Path $installRootPath ".update-download-$operationId") $installRootPath
$stagingDirectory = Assert-SafeChildPath (Join-Path $installRootPath ".update-staging-$operationId") $installRootPath
$previousDirectory = Assert-SafeChildPath (Join-Path $installRootPath ".update-previous-$operationId") $installRootPath
$failedDirectory = Assert-SafeChildPath (Join-Path $installRootPath ".update-failed-$operationId") $installRootPath
$oldMoved = $false
$serverWasStopped = $false

try {
  New-Item -ItemType Directory -Path $downloadDirectory -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $stagingDirectory -ErrorAction Stop | Out-Null

  Write-Host 'Consultando última release...'
  $release = Get-LatestRelease $ReleaseApi
  $archiveUrl = Get-ReleaseAssetUrl $release 'app.zip'
  $checksumUrl = Get-ReleaseAssetUrl $release 'app.zip.sha256'
  $archivePath = Join-Path $downloadDirectory 'app.zip'
  $checksumPath = Join-Path $downloadDirectory 'app.zip.sha256'

  Receive-Asset $archiveUrl $archivePath 300
  Receive-Asset $checksumUrl $checksumPath 30

  $expectedHash = ((Get-Content -LiteralPath $checksumPath -Raw).Trim() -split '\s+')[0].ToUpperInvariant()
  if ($expectedHash -notmatch '^[A-F0-9]{64}$') { throw 'Checksum publicado no válido.' }
  $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) { throw 'Checksum de app.zip no coincide.' }

  Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingDirectory -Force
  if (!(Test-Path -LiteralPath (Join-Path $stagingDirectory 'server\index.mjs') -PathType Leaf)) {
    throw 'app.zip no contiene server/index.mjs.'
  }
  if (!(Test-Path -LiteralPath (Join-Path $stagingDirectory 'start-server.mjs') -PathType Leaf)) {
    throw 'app.zip no contiene start-server.mjs.'
  }
  Assert-NoReparsePoints $stagingDirectory

  $nestedData = Join-Path $installDirectory '.data'
  if (Test-Path -LiteralPath $nestedData) {
    Copy-Item -LiteralPath $nestedData -Destination (Join-Path $stagingDirectory '.data') -Recurse -Force -ErrorAction Stop
  }

  $serverWasStopped = Stop-AppServer $startScript $relativeScript $Port
  Move-Item -LiteralPath $installDirectory -Destination $previousDirectory -ErrorAction Stop
  $oldMoved = $true
  Move-Item -LiteralPath $stagingDirectory -Destination $installDirectory -ErrorAction Stop

  if (!$NoRestart) { Start-AppServer $goBat $installRootPath $Port }
} catch {
  $originalError = $_
  if ($oldMoved) {
    try {
      if (Test-Path -LiteralPath $installDirectory) {
        [void](Stop-AppServer $startScript $relativeScript $Port)
        Move-Item -LiteralPath $installDirectory -Destination $failedDirectory -ErrorAction Stop
      }
      Move-Item -LiteralPath $previousDirectory -Destination $installDirectory -ErrorAction Stop
      if (!$NoRestart) { Start-AppServer $goBat $installRootPath $Port }
    } catch {
      throw "Actualización falló: $($originalError.Exception.Message) Rollback falló: $($_.Exception.Message)"
    }
  } elseif ($serverWasStopped -and !$NoRestart) {
    try {
      Start-AppServer $goBat $installRootPath $Port
    } catch {
      throw "Actualización falló: $($originalError.Exception.Message) Reinicio falló: $($_.Exception.Message)"
    }
  }
  throw $originalError
} finally {
  Remove-SafeTree $downloadDirectory $installRootPath
  Remove-SafeTree $stagingDirectory $installRootPath
  Remove-SafeTree $failedDirectory $installRootPath
}

Remove-SafeTree $previousDirectory $installRootPath
Write-Host "Actualización completada: $($release.tag_name)"
