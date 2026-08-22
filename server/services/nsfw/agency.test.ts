import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from '../../utils/storage.ts'
import {
  acceptAttempt,
  createAttempt,
  createSequel,
  createStorySession,
  finalizeSession,
  forkFromBeat,
  getAttempt,
  getPlayState,
  prepareRerollSource,
  setSessionArchived,
  updateAttempt
} from '../../utils/nsfwStorage.ts'
import { hashPassword } from '../../utils/nsfwAuth.ts'
import { buildMockEnvelope } from './promptBundle.ts'

function withDb(run: (ownerId: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-m2-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  const storage = getStorage(path)
  const ownerId = 'owner-1'
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

test('re-roll crea sibling y fork conserva ancestros; archivo/secuela funcionan', () => {
  withDb((ownerId) => {
    let session = createStorySession(ownerId, {
      title: 'Base',
      premise: 'Premisa',
      format: 'story',
      duration: 'medium',
      tone: 'sensual',
      perspective: 'second',
      interactionPolicy: 'pause',
      generationProfile: 'quick',
      modelAlias: 'G4-Dark-Soul-26B-A4B',
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
          isSelfInsert: false
        }
      ],
      interests: ['tensión'],
      exclusions: []
    })

    const first = createAttempt({
      session,
      input: { kind: 'continue', text: '' },
      modelAlias: session.modelAlias,
      modelId: 'mock:g4',
      generationProfile: 'quick'
    })
    const envelope = buildMockEnvelope(session, first.input)
    updateAttempt(first.id, { state: 'ready', envelope, provisionalText: 'uno' })
    const readyFirst = getAttempt(first.id, ownerId)!
    const afterAccept = acceptAttempt(session, readyFirst)
    assert.equal(afterAccept.beats.length, 1)
    session = afterAccept.session

    const second = createAttempt({
      session,
      input: { kind: 'act', text: 'te acercas' },
      modelAlias: session.modelAlias,
      modelId: 'mock:g4',
      generationProfile: 'quick'
    })
    updateAttempt(second.id, {
      state: 'ready',
      envelope: buildMockEnvelope(session, second.input),
      provisionalText: 'dos'
    })

    const source = prepareRerollSource(ownerId, second.id)
    assert.equal(source.siblingGroupId, second.siblingGroupId)
    session = getPlayState(session.id, ownerId)!.session
    const sibling = createAttempt({
      session,
      input: source.input,
      modelAlias: session.modelAlias,
      modelId: 'mock:g4-b',
      generationProfile: 'quick',
      siblingGroupId: source.siblingGroupId
    })
    updateAttempt(sibling.id, {
      state: 'ready',
      envelope: buildMockEnvelope(session, source.input),
      provisionalText: 'alt'
    })
    const withSiblings = getPlayState(session.id, ownerId)!
    assert.ok(withSiblings.siblingAttempts.length >= 2)

    const forked = forkFromBeat(ownerId, afterAccept.beats[0]!.id, 'Prueba')
    assert.equal(forked.parentSessionId, session.id)
    assert.equal(forked.forkBeatId, afterAccept.beats[0]!.id)
    const forkedPlay = getPlayState(forked.id, ownerId)!
    assert.equal(forkedPlay.beats.length, 1)
    assert.notEqual(forkedPlay.beats[0]!.id, afterAccept.beats[0]!.id)

    finalizeSession(session.id, ownerId)
    const sequel = createSequel(session.id, ownerId)
    assert.equal(sequel.sequelOfSessionId, session.id)
    assert.match(sequel.title, /Secuela/)

    setSessionArchived(session.id, ownerId, true)
    assert.equal(getPlayState(session.id, ownerId)!.session.archived, true)
  })
})
