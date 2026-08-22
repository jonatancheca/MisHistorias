import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from '../utils/storage.ts'
import { hashPassword } from '../utils/nsfwAuth.ts'
import {
  addComment,
  addSprite,
  addToCollection,
  addToLibrary,
  createCharacter,
  createCollection,
  createExperience,
  createPlace,
  createPrivateTerm,
  deletePrivateTerm,
  getPublicationRatingSummary,
  listComments,
  listDedupedPrivateTermsMissingPublic,
  listHub,
  listInterestCatalog,
  listPrivateTerms,
  promotePrivateLabelToPublic,
  publishResource,
  ratePublication
} from '../utils/nsfwStudio.ts'

function withDb(run: (ownerId: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-m4-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  const storage = getStorage(path)
  const ownerId = 'owner-m4'
  const now = Date.now()
  storage.database
    .prepare(`
      INSERT INTO nsfw_users(
        id, username, password_hash, role, active, avatar_asset_id, created_at, updated_at, last_login_at
      ) VALUES (?, 'creator', ?, 'admin', 1, NULL, ?, ?, NULL)
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

test('studio publish y hub add conservan snapshot inmutable', () => {
  withDb((ownerId) => {
    const character = createCharacter(ownerId, { name: 'Nora', tags: ['directa'] })
    addSprite(ownerId, {
      characterId: character.id,
      label: 'Base',
      facets: ['neutral', 'standing', 'clothed']
    })
    createPlace(ownerId, { name: 'Terraza', setting: 'Exterior', era: 'Contemporánea' })
    createExperience(ownerId, { title: 'Noche', premise: 'Una cita' })

    const publication = publishResource(ownerId, {
      resourceType: 'character',
      resourceId: character.id
    })
    assert.equal(publication.status, 'published')
    assert.equal(listHub().length, 1)

    const entry = addToLibrary(ownerId, publication.id)
    assert.equal(entry.publicationId, publication.id)
    assert.equal(entry.title, 'Nora')

    const collection = createCollection(ownerId, { title: 'Noche' })
    addToCollection(ownerId, collection.id, publication.id)
    ratePublication(ownerId, publication.id, 5, { overall: 5 })
    addComment(ownerId, publication.id, 'Buena ficha')
    assert.equal(getPublicationRatingSummary(publication.id).count, 1)
    assert.equal(listComments(publication.id).length, 1)
  })
})

test('términos privados por usuario, sin duplicar públicos, y promoción admin', () => {
  withDb((ownerId) => {
    const storage = getStorage()
    storage.database
      .prepare(`
        INSERT INTO nsfw_taxonomy_terms(id, label, kind, status, proposed_by, created_at)
        VALUES ('pub-1', 'Romance', 'interest', 'approved', NULL, ?)
      `)
      .run(Date.now())

    assert.throws(() => createPrivateTerm(ownerId, { label: 'romance' }), /público/i)

    const privateTerm = createPrivateTerm(ownerId, { label: 'Teasing lento' })
    assert.equal(privateTerm.private, true)
    assert.equal(listPrivateTerms(ownerId).length, 1)

    const again = createPrivateTerm(ownerId, { label: 'teasing lento' })
    assert.equal(again.id, privateTerm.id)

    const catalog = listInterestCatalog(ownerId)
    assert.ok(catalog.some((term) => term.label === 'Romance' && !term.private))
    assert.ok(catalog.some((term) => term.label === 'Teasing lento' && term.private))

    const otherId = 'other-m4'
    storage.database
      .prepare(`
        INSERT INTO nsfw_users(
          id, username, password_hash, role, active, avatar_asset_id, created_at, updated_at, last_login_at
        ) VALUES (?, 'other', ?, 'user', 1, NULL, ?, ?, NULL)
      `)
      .run(otherId, hashPassword('password-12345'), Date.now(), Date.now())
    createPrivateTerm(otherId, { label: 'Teasing lento' })

    const candidates = listDedupedPrivateTermsMissingPublic()
    const teasing = candidates.find((item) => item.label.toLowerCase() === 'teasing lento')
    assert.ok(teasing)
    assert.equal(teasing!.userCount, 2)

    const promoted = promotePrivateLabelToPublic('Teasing lento')
    assert.equal(promoted.created, true)
    assert.equal(promoted.removedPrivate, 2)
    assert.equal(listPrivateTerms(ownerId).length, 0)
    assert.equal(listDedupedPrivateTermsMissingPublic().length, 0)
    assert.ok(listInterestCatalog(ownerId).some((term) => term.label === 'Teasing lento' && !term.private))

    const leftover = createPrivateTerm(ownerId, { label: 'Solo mío' })
    deletePrivateTerm(ownerId, leftover.id)
    assert.equal(listPrivateTerms(ownerId).length, 0)
  })
})
