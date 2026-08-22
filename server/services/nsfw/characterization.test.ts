import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from '../../utils/storage.ts'
import { hashPassword } from '../../utils/nsfwAuth.ts'
import { createStorySession, getStorySession, updateCastMember } from '../../utils/nsfwStorage.ts'
import { cloneCharacterFromCast, listCharacters } from '../../utils/nsfwStudio.ts'

function withDb(run: (ownerId: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-char-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  const storage = getStorage(path)
  const ownerId = 'owner-char'
  const now = Date.now()
  storage.database
    .prepare(`
      INSERT INTO nsfw_users(
        id, username, password_hash, role, active, avatar_asset_id, created_at, updated_at, last_login_at
      ) VALUES (?, 'owner', ?, 'admin', 1, NULL, ?, ?, NULL)
    `)
    .run(ownerId, hashPassword('password-12345'), now, now)
  storage.database
    .prepare(`
      INSERT INTO nsfw_self_insert_profiles(
        user_id, display_name, pronouns, appearance, boundaries_json, updated_at
      ) VALUES (?, 'River', 'elle/elle', 'cabello corto', ?, ?)
    `)
    .run(ownerId, JSON.stringify(['sin sangre']), now)
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

test('caracterización por sesión + self-insert + clone privado', () => {
  withDb((ownerId) => {
    const before = listCharacters(ownerId).length
    const session = createStorySession(ownerId, {
      title: 'Char test',
      premise: 'Una noche',
      format: 'story',
      duration: 'short',
      tone: 'sensual',
      perspective: 'second',
      interactionPolicy: 'pause',
      generationProfile: 'quick',
      modelAlias: 'mock',
      cast: [
        {
          actorId: 'protagonist',
          name: 'Tú',
          role: 'protagonist',
          personality: '',
          isSelfInsert: true
        },
        {
          actorId: 'companion',
          name: 'Alex',
          role: 'character',
          personality: 'Directo',
          isSelfInsert: false,
          sourceCharacterId: 'src-1'
        }
      ],
      interests: [],
      exclusions: []
    })

    const protagonist = session.cast.find((item) => item.actorId === 'protagonist')!
    assert.equal(protagonist.name, 'River')
    assert.match(protagonist.characterization || '', /Límites: sin sangre/)

    const companion = session.cast.find((item) => item.actorId === 'companion')!
    assert.ok(companion.characterization)
    assert.equal(companion.sourceCharacterId, 'src-1')

    const updated = updateCastMember(session.id, ownerId, 'companion', {
      overrideName: 'Alexandra',
      characterization: 'Más suave en esta historia',
      personality: 'Suave'
    })
    const patched = updated.cast.find((item) => item.actorId === 'companion')!
    assert.equal(patched.overrideName, 'Alexandra')
    assert.equal(patched.characterization, 'Más suave en esta historia')

    const clone = cloneCharacterFromCast(ownerId, {
      name: patched.overrideName || patched.name,
      personality: patched.personality,
      characterization: patched.characterization,
      sourceCharacterId: patched.sourceCharacterId
    })
    assert.ok(clone.id)
    assert.equal(clone.name, 'Alexandra')
    assert.ok(clone.tags.includes('clone'))
    assert.equal(listCharacters(ownerId).length, before + 1)

    const sourceStillIntact = getStorySession(session.id, ownerId)!
    assert.equal(
      sourceStillIntact.cast.find((item) => item.actorId === 'companion')?.sourceCharacterId,
      'src-1'
    )
  })
})
