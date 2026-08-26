import { buildMockEnvelope } from './promptBundle.ts'
import { runMockQualityPipeline } from './qualityPipeline.ts'
import { skillVersionMap, resolveSkillsForFormat } from './skills.ts'
import type { NsfwStorySession, PlayerInput } from '../../../shared/types/nsfw/session.ts'
import assert from 'node:assert/strict'
import test from 'node:test'

const session: NsfwStorySession = {
  id: 's1',
  ownerUserId: 'u1',
  format: 'story',
  title: 'Prueba',
  premise: 'Una noche',
  duration: 'corta',
  tone: 'íntimo',
  perspective: 'segunda',
  interactionPolicy: 'pause',
  generationProfile: 'quality',
  modelAlias: 'style-v2',
  headBeatId: null,
  revision: 0,
  plan: { version: 1, summary: 'abrir', nextBeats: [{ id: 'beat-open', intent: 'abrir', status: 'pending' }] },
  bible: { version: 1, facts: [] },
  worldState: {
    version: 1,
    location: 'Umbral',
    presentActorIds: ['protagonist', 'other'],
    mood: 'tensa',
    relationshipNotes: [],
    flags: {}
  },
  sceneState: {
    location: 'Umbral',
    presentActorIds: ['protagonist', 'other'],
    intention: 'conocer',
    pacing: 'medio'
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
      actorId: 'other',
      name: 'Nora',
      role: 'character',
      personality: 'directa',
      isSelfInsert: false
    }
  ],
  interests: [],
  exclusions: [],
  archived: false,
  privacyNoticeSeen: true,
  parentSessionId: null,
  forkBeatId: null,
  sequelOfSessionId: null,
  branchLabel: null,
  finalizedAt: null,
  experienceId: null,
  assetPins: { placeId: null, placeBackgroundId: null, characterSprites: {} },
  escalationHeart: false,
  createdAt: 1,
  updatedAt: 1
}

test('skills versionadas por formato incluyen contratos', () => {
  const story = resolveSkillsForFormat('story')
  assert.ok(story.some((skill) => skill.id === 'contrato-story'))
  assert.ok(!story.some((skill) => skill.id === 'contrato-chat'))
  assert.equal(skillVersionMap('vn')['contrato-vn'], '1.0.0')
})

test('quality pipeline mock ejecuta planner-writer-critic-validator', () => {
  const input: PlayerInput = { kind: 'act', text: 'dar un paso' }
  const result = runMockQualityPipeline(session, input, buildMockEnvelope)
  assert.ok(result.passes.some((pass) => pass.name === 'planner'))
  assert.ok(result.passes.some((pass) => pass.name === 'writer'))
  assert.ok(result.passes.some((pass) => pass.name === 'critic'))
  assert.ok(result.passes.some((pass) => pass.name === 'validator'))
  assert.equal(result.envelope.format, 'story')
  assert.ok(result.envelope.visibleUnits.length >= 1)
})

test('critic penaliza léxico prohibido y narración que acaba en pregunta', () => {
  const input: PlayerInput = { kind: 'act', text: 'dar un paso' }
  const result = runMockQualityPipeline(session, input, () => ({
    schemaVersion: 1,
    language: 'es-ES',
    format: 'story',
    visibleUnits: [
      { type: 'narration', text: 'Su belleza era devastadora bajo la luz.' },
      { type: 'narration', text: '¿Qué harás ahora?' }
    ],
    visualCues: [],
    soundCues: [],
    choices: [],
    stateDelta: [],
    planPatch: [],
    stopReason: 'awaiting_player'
  }))
  const critic = result.passes.find((pass) => pass.name === 'critic')
  assert.ok(critic)
  assert.ok((critic.score ?? 100) < 72)
  assert.equal(result.revised, true)
})
