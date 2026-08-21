import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractJsonObject,
  parseAndValidateEnvelope
} from './envelopeValidator.ts'
import { buildMockEnvelope } from './promptBundle.ts'
import type { NsfwStorySession } from '../../../shared/types/nsfw/session.ts'

const session = {
  id: 's1',
  ownerUserId: 'u1',
  format: 'story',
  title: 'Prueba',
  premise: 'Una noche',
  duration: 'medium',
  tone: 'sensual',
  perspective: 'second',
  interactionPolicy: 'pause',
  generationProfile: 'quick',
  modelAlias: 'G4-Dark-Soul-26B-A4B',
  headBeatId: null,
  revision: 0,
  plan: { version: 1, summary: 'Abrir', nextBeats: [] },
  bible: { version: 1, facts: [] },
  worldState: {
    version: 1,
    location: 'Por definir',
    presentActorIds: ['protagonist', 'companion'],
    mood: 'expectante',
    relationshipNotes: [],
    flags: {}
  },
  sceneState: {
    location: 'Por definir',
    presentActorIds: ['protagonist', 'companion'],
    intention: 'Abrir',
    pacing: 'moderado'
  },
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
  exclusions: ['violencia extrema'],
  archived: false,
  privacyNoticeSeen: true,
  parentSessionId: null,
  forkBeatId: null,
  sequelOfSessionId: null,
  branchLabel: null,
  finalizedAt: null,
  createdAt: 1,
  updatedAt: 1
} as NsfwStorySession

test('mock envelope valida contra el schema Story', () => {
  const envelope = buildMockEnvelope(session, { kind: 'act', text: 'te acercas' })
  const result = parseAndValidateEnvelope(envelope, {
    format: 'story',
    cast: session.cast,
    exclusions: session.exclusions
  })
  assert.equal(result.ok, true)
  assert.equal(result.envelope?.visibleUnits.length, 2)
})

test('rechaza actorId desconocido y exclusiones', () => {
  const bad = buildMockEnvelope(session, { kind: 'speak', text: 'hola' })
  bad.visibleUnits.push({ type: 'dialogue', actorId: 'fantasma', text: 'no existo' })
  const result = parseAndValidateEnvelope(bad, {
    format: 'story',
    cast: session.cast,
    exclusions: session.exclusions
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes('actorId')))
})

test('extractJsonObject recupera JSON embebido', () => {
  const payload = extractJsonObject('basura {"schemaVersion":1,"language":"es-ES"} cola')
  assert.deepEqual(payload, { schemaVersion: 1, language: 'es-ES' })
})
