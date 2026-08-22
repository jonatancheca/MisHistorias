import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from '../../utils/storage.ts'
import { hashPassword } from '../../utils/nsfwAuth.ts'
import {
  addSprite,
  createCharacter,
  createPlace,
  getPlaceBackgroundMedia,
  getSpriteMedia,
  setPlaceBackground
} from '../../utils/nsfwStudio.ts'

function withDb(run: (ownerId: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-media-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  const storage = getStorage(path)
  const ownerId = 'owner-media'
  const now = Date.now()
  storage.database
    .prepare(`
      INSERT INTO nsfw_users(
        id, username, password_hash, role, active, avatar_asset_id, created_at, updated_at, last_login_at
      ) VALUES (?, 'owner', ?, 'admin', 1, NULL, ?, ?, NULL)
    `)
    .run(ownerId, hashPassword('password-12345'), now, now)
  try {
    run(ownerId)
  } finally {
    storage.close()
    const globalState = globalThis as typeof globalThis & {
      __misHistoriasStorage?: Map<string, unknown>
    }
    globalState.__misHistoriasStorage?.delete(path)
    rmSync(directory, { recursive: true, force: true })
    delete process.env.NUXT_SQLITE_PATH
  }
}

// Minimal 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('upload PNG sprite y fondo de lugar', () => {
  withDb((ownerId) => {
    const character = createCharacter(ownerId, { name: 'Nova' })
    const sprite = addSprite(ownerId, {
      characterId: character.id,
      label: 'Real',
      facets: ['neutral'],
      mimeType: 'image/png',
      dataBase64: PNG_B64
    })
    const media = getSpriteMedia(sprite.id, ownerId)
    assert.ok(media)
    assert.equal(media.mimeType, 'image/png')
    assert.ok(media.data.length > 20)

    const place = createPlace(ownerId, { name: 'Ático' })
    const bg = setPlaceBackground(ownerId, place.id, {
      dataBase64: `data:image/png;base64,${PNG_B64}`
    })
    const bgMedia = getPlaceBackgroundMedia(bg.id, ownerId)
    assert.ok(bgMedia)
    assert.equal(bgMedia.mimeType, 'image/png')
  })
})
