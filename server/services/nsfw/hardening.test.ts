import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { getStorage } from '../../utils/storage.ts'
import { hashPassword } from '../../utils/nsfwAuth.ts'
import {
  acceptAttempt,
  createAttempt,
  createStorySession,
  forkFromBeat,
  getAttempt,
  getPlayState,
  getStorySession,
  updateAttempt
} from '../../utils/nsfwStorage.ts'
import { upsertVnSave, listVnSaves, markUnitsRead, listReadUnits } from '../../utils/nsfwVn.ts'
import { buildMockEnvelope } from './promptBundle.ts'

function withDb(run: (ownerId: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'mishistorias-hard-'))
  const path = join(directory, 'test.sqlite')
  process.env.NUXT_SQLITE_PATH = path
  const storage = getStorage(path)
  const ownerId = 'owner-hard'
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

function baseSession(ownerId: string, format: 'story' | 'vn' = 'story') {
  return createStorySession(ownerId, {
    title: 'Hardening',
    premise: 'Premisa larga',
    format,
    duration: 'long',
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
    interests: [],
    exclusions: []
  })
}

function readyAttempt(
  session: ReturnType<typeof createStorySession>,
  ownerId: string,
  text: string
) {
  const attempt = createAttempt({
    session,
    input: { kind: 'speak', text },
    modelAlias: session.modelAlias,
    modelId: 'mock:test',
    generationProfile: 'quick',
    skillVersions: {}
  })
  updateAttempt(attempt.id, {
    state: 'ready',
    envelope: buildMockEnvelope(session, { kind: 'speak', text }),
    provisionalText: text
  })
  return getAttempt(attempt.id, ownerId)!
}

test('stale: accept rechaza fingerprint viejo tras avanzar revisión', () => {
  withDb((ownerId) => {
    const session = baseSession(ownerId)
    const attempt = readyAttempt(session, ownerId, 'hola')
    getStorage().database
      .prepare('UPDATE nsfw_story_sessions SET revision = revision + 1 WHERE id = ?')
      .run(session.id)
    const current = getStorySession(session.id, ownerId)!
    assert.throws(() => acceptAttempt(current, attempt), /obsoleto/)
    assert.equal(getAttempt(attempt.id, ownerId)!.state, 'stale')
  })
})

test('ramas profundas: fork encadenado mantiene ancestros y original intacto', () => {
  withDb((ownerId) => {
    let session = baseSession(ownerId)
    const beatIds: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const attempt = readyAttempt(session, ownerId, `paso ${i}`)
      const after = acceptAttempt(session, attempt)
      session = after.session
      beatIds.push(session.headBeatId!)
    }
    const mid = beatIds[1]!
    const branch = forkFromBeat(ownerId, mid, 'profunda')
    assert.notEqual(branch.id, session.id)
    assert.equal(branch.forkBeatId, mid)
    const original = getPlayState(session.id, ownerId)!
    assert.equal(original.beats.length, 4)
    const forked = getPlayState(branch.id, ownerId)!
    assert.ok(forked.beats.length >= 2)
  })
})

test('VN saves + read units', () => {
  withDb((ownerId) => {
    let session = baseSession(ownerId, 'vn')
    const attempt = readyAttempt(session, ownerId, 'vn open')
    const after = acceptAttempt(session, attempt)
    session = after.session
    const save = upsertVnSave({
      sessionId: session.id,
      ownerUserId: ownerId,
      label: 'Manual',
      headBeatId: session.headBeatId,
      isAutosave: false,
      payload: { unitIndex: 0 }
    })
    assert.ok(save.id)
    upsertVnSave({
      sessionId: session.id,
      ownerUserId: ownerId,
      label: 'Autosave',
      headBeatId: session.headBeatId,
      isAutosave: true,
      payload: { unitIndex: 1 }
    })
    upsertVnSave({
      sessionId: session.id,
      ownerUserId: ownerId,
      label: 'Autosave',
      headBeatId: session.headBeatId,
      isAutosave: true,
      payload: { unitIndex: 2 }
    })
    const saves = listVnSaves(session.id, ownerId)
    assert.equal(saves.filter((item) => item.isAutosave).length, 1)
    assert.ok(saves.some((item) => item.id === save.id))

    markUnitsRead(session.id, ownerId, session.headBeatId!, [0, 1])
    const read = listReadUnits(session.id)
    assert.ok(read.length >= 2)
  })
})
