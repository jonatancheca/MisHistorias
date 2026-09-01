import assert from 'node:assert/strict'
import test from 'node:test'
import { appUpdateFromRelease, emptyAppUpdate, fetchAppUpdate } from './appUpdate.ts'

const release = {
  tag_name: 'main-abc123',
  html_url: 'https://github.com/jonatancheca/MisHistorias/releases/tag/main-abc123',
  published_at: '2026-08-19T10:00:00Z',
  assets: [
    { name: 'app.zip', browser_download_url: 'https://example.test/app.zip' },
    { name: 'app.zip.sha256', browser_download_url: 'https://example.test/app.zip.sha256' },
    { name: 'update.ps1', browser_download_url: 'https://example.test/update.ps1' },
    { name: 'app-linux-x64.tar.gz', browser_download_url: 'https://example.test/app-linux-x64.tar.gz' },
    { name: 'app-linux-x64.tar.gz.sha256', browser_download_url: 'https://example.test/app-linux-x64.tar.gz.sha256' },
    { name: 'update.sh', browser_download_url: 'https://example.test/update.sh' }
  ]
}

test('detecta release nueva y expone los assets de Windows', () => {
  assert.deepEqual(appUpdateFromRelease(release, 'main-old123', 'old123', 'win32'), {
    currentVersion: 'main-old123',
    currentCommit: 'old123',
    latestVersion: 'main-abc123',
    publishedAt: '2026-08-19T10:00:00Z',
    releaseUrl: release.html_url,
    downloadUrl: 'https://example.test/app.zip',
    checksumUrl: 'https://example.test/app.zip.sha256',
    updaterUrl: 'https://example.test/update.ps1',
    updateAvailable: true
  })
})

test('expone los assets de Linux cuando el servidor ejecuta Linux', () => {
  assert.deepEqual(appUpdateFromRelease(release, 'main-old123', 'old123', 'linux'), {
    currentVersion: 'main-old123',
    currentCommit: 'old123',
    latestVersion: 'main-abc123',
    publishedAt: '2026-08-19T10:00:00Z',
    releaseUrl: release.html_url,
    downloadUrl: 'https://example.test/app-linux-x64.tar.gz',
    checksumUrl: 'https://example.test/app-linux-x64.tar.gz.sha256',
    updaterUrl: 'https://example.test/update.sh',
    updateAvailable: true
  })
})

test('no marca actualización para misma release ni desarrollo', () => {
  assert.equal(appUpdateFromRelease(release, 'main-abc123', 'abc123', 'win32').updateAvailable, false)
  assert.equal(appUpdateFromRelease(release, 'dev', '', 'linux').updateAvailable, false)
})

test('rechaza releases incompletas para la plataforma actual', () => {
  assert.throws(
    () => appUpdateFromRelease({ ...release, assets: release.assets.slice(0, 1) }, 'main-old', 'old', 'win32'),
    /no contiene todos los archivos/
  )
  assert.throws(
    () => appUpdateFromRelease({ ...release, assets: release.assets.slice(0, 3) }, 'main-old', 'old', 'linux'),
    /no contiene todos los archivos/
  )
})

test('rechaza plataformas sin artefacto portable', () => {
  assert.throws(
    () => appUpdateFromRelease(release, 'main-old', 'old', 'darwin'),
    /Sistema operativo no compatible/
  )
})

test('convierte ausencia de releases en estado vacío', async () => {
  const result = await fetchAppUpdate({
    currentVersion: 'main-old',
    currentCommit: 'old',
    platform: 'win32',
    fetchImpl: async () => new Response(null, { status: 404 })
  })
  assert.deepEqual(result, emptyAppUpdate('main-old', 'old'))
})

test('expone errores HTTP de GitHub', async () => {
  await assert.rejects(
    fetchAppUpdate({
      currentVersion: 'main-old',
      currentCommit: 'old',
      platform: 'win32',
      fetchImpl: async () => new Response(null, { status: 503 })
    }),
    /GitHub respondió 503/
  )
})
