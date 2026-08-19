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
    { name: 'update.ps1', browser_download_url: 'https://example.test/update.ps1' }
  ]
}

test('detecta release nueva y expone sus tres assets', () => {
  assert.deepEqual(appUpdateFromRelease(release, 'main-old123', 'old123'), {
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

test('no marca actualización para misma release ni desarrollo', () => {
  assert.equal(appUpdateFromRelease(release, 'main-abc123', 'abc123').updateAvailable, false)
  assert.equal(appUpdateFromRelease(release, 'dev', '').updateAvailable, false)
})

test('rechaza releases incompletas', () => {
  assert.throws(
    () => appUpdateFromRelease({ ...release, assets: release.assets.slice(0, 1) }, 'main-old', 'old'),
    /no contiene todos los archivos/
  )
})

test('convierte ausencia de releases en estado vacío', async () => {
  const result = await fetchAppUpdate({
    currentVersion: 'main-old',
    currentCommit: 'old',
    fetchImpl: async () => new Response(null, { status: 404 })
  })
  assert.deepEqual(result, emptyAppUpdate('main-old', 'old'))
})

test('expone errores HTTP de GitHub', async () => {
  await assert.rejects(
    fetchAppUpdate({
      currentVersion: 'main-old',
      currentCommit: 'old',
      fetchImpl: async () => new Response(null, { status: 503 })
    }),
    /GitHub respondió 503/
  )
})
