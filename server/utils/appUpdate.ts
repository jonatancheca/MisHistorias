import type { AppUpdateInfo } from '#shared/types'

const RELEASES_API = 'https://api.github.com/repos/jonatancheca/MisHistorias/releases/latest'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

interface LatestRelease {
  tag_name: string
  html_url: string
  published_at: string | null
  assets: ReleaseAsset[]
}

interface AppUpdateOptions {
  currentVersion: string
  currentCommit: string
  fetchImpl?: typeof fetch
}

function releaseAsset(release: LatestRelease, name: string) {
  return release.assets.find((asset) => asset.name === name)?.browser_download_url ?? null
}

function parseRelease(value: unknown): LatestRelease {
  if (!value || typeof value !== 'object') throw new Error('Respuesta de release no válida.')

  const release = value as Partial<LatestRelease>
  if (
    typeof release.tag_name !== 'string' ||
    typeof release.html_url !== 'string' ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('Respuesta de release no válida.')
  }

  const assets = release.assets.filter((asset): asset is ReleaseAsset =>
    Boolean(
      asset &&
      typeof asset === 'object' &&
      typeof asset.name === 'string' &&
      typeof asset.browser_download_url === 'string'
    )
  )

  return {
    tag_name: release.tag_name,
    html_url: release.html_url,
    published_at: typeof release.published_at === 'string' ? release.published_at : null,
    assets
  }
}

export function appUpdateFromRelease(
  releaseValue: unknown,
  currentVersion: string,
  currentCommit: string
): AppUpdateInfo {
  const release = parseRelease(releaseValue)
  const downloadUrl = releaseAsset(release, 'app.zip')
  const checksumUrl = releaseAsset(release, 'app.zip.sha256')
  const updaterUrl = releaseAsset(release, 'update.ps1')

  if (!downloadUrl || !checksumUrl || !updaterUrl) {
    throw new Error('La última release no contiene todos los archivos de actualización.')
  }

  return {
    currentVersion,
    currentCommit,
    latestVersion: release.tag_name,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    downloadUrl,
    checksumUrl,
    updaterUrl,
    updateAvailable: currentVersion !== 'dev' && currentVersion !== release.tag_name
  }
}

export function emptyAppUpdate(currentVersion: string, currentCommit: string): AppUpdateInfo {
  return {
    currentVersion,
    currentCommit,
    latestVersion: null,
    publishedAt: null,
    releaseUrl: null,
    downloadUrl: null,
    checksumUrl: null,
    updaterUrl: null,
    updateAvailable: false
  }
}

export async function fetchAppUpdate(options: AppUpdateOptions): Promise<AppUpdateInfo> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(RELEASES_API, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'MisHistorias-update-check',
      'x-github-api-version': '2026-03-10'
    }
  })

  if (response.status === 404) {
    return emptyAppUpdate(options.currentVersion, options.currentCommit)
  }
  if (!response.ok) {
    throw new Error(`GitHub respondió ${response.status}.`)
  }

  return appUpdateFromRelease(
    await response.json(),
    options.currentVersion,
    options.currentCommit
  )
}
