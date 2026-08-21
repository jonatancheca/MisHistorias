import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RAG_VERSION,
  selectNarrativeRags,
  resolveEffectivePerspective,
  normalizeTone
} from './narrativeRag.ts'
import { buildStoryPromptBundle } from './promptBundle.ts'
import { skillVersionMap } from './skills.ts'
import type { NsfwNarrativeBeat, NsfwStorySession, PlayerInput } from '../../../shared/types/nsfw/session.ts'

const base: NsfwStorySession = {
  id: 's1',
  ownerUserId: 'u1',
  format: 'story',
  title: 'Prueba',
  premise: 'Una terraza',
  duration: 'medium',
  tone: 'sensual',
  perspective: 'second',
  interactionPolicy: 'pause',
  generationProfile: 'quality',
  modelAlias: 'style-v2',
  headBeatId: 'b1',
  revision: 1,
  plan: { version: 1, summary: 'abrir', nextBeats: [{ id: 'beat-open', intent: 'abrir', status: 'pending' }] },
  bible: {
    version: 1,
    facts: [
      { id: 'f1', entity: 'lugar', text: 'Terraza visible', secret: false, knownByProtagonist: true, source: 'plan' },
      { id: 'f2', entity: 'secreto', text: 'Ella es una espía', secret: true, knownByProtagonist: false, source: 'hidden' }
    ]
  },
  worldState: {
    version: 1,
    location: 'Terraza',
    presentActorIds: ['protagonist', 'other'],
    mood: 'tensa',
    relationshipNotes: [],
    flags: {}
  },
  sceneState: {
    location: 'Terraza',
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
  interests: ['tensión'],
  exclusions: ['sangre'],
  archived: false,
  privacyNoticeSeen: true,
  parentSessionId: null,
  forkBeatId: null,
  sequelOfSessionId: null,
  branchLabel: null,
  finalizedAt: null,
  experienceId: null,
  assetPins: { placeId: 'place-1', placeBackgroundId: 'bg-1', characterSprites: { other: 'spr-1' } },
  escalationHeart: false,
  createdAt: 1,
  updatedAt: 1
}

test('chat fuerza self-insert y story non_interactive usa narrativa autónoma', () => {
  const chat = selectNarrativeRags({
    format: 'chat',
    perspective: 'third',
    tone: 'sensual',
    interactionPolicy: 'pause'
  })
  assert.ok(chat.some((rag) => rag.id === 'format-chat-rp-self-insert-es'))
  assert.ok(chat.some((rag) => rag.id === 'perspective-self-insert-es'))
  assert.ok(chat.some((rag) => rag.id === 'tone-neutral-es'))

  const autonomous = selectNarrativeRags({
    format: 'story',
    perspective: 'first',
    tone: 'explicit',
    interactionPolicy: 'non_interactive'
  })
  assert.ok(autonomous.some((rag) => rag.id === 'perspective-third-person-autonomous-es'))
  assert.ok(autonomous.some((rag) => rag.id === 'tone-hardcore-explicit-es'))

  assert.equal(resolveEffectivePerspective({ format: 'vn', perspective: 'first', interactionPolicy: 'pause' }), 'first_person')
  assert.equal(normalizeTone('oscuro'), 'dark')
  assert.equal(normalizeTone('íntimo'), 'romantic')
})

test('prompt incluye RAGs, contratos y oculta secretos de bible', () => {
  const input: PlayerInput = { kind: 'speak', text: 'Te miro.' }
  const beat: NsfwNarrativeBeat = {
    id: 'b1',
    sessionId: 's1',
    parentBeatId: null,
    acceptedAttemptId: 'a1',
    envelope: {
      schemaVersion: 1,
      language: 'es-ES',
      format: 'story',
      visibleUnits: [{ type: 'narration', text: 'El viento mueve el mantel.' }],
      visualCues: [],
      soundCues: [],
      choices: [],
      stateDelta: [],
      planPatch: [],
      stopReason: 'awaiting_player'
    },
    sequence: 1,
    createdAt: 1
  }
  const bundle = buildStoryPromptBundle(base, input, { recentBeats: [beat] })
  const system = bundle.messages[0]!.content
  const user = bundle.messages[1]!.content
  assert.equal(bundle.ragVersion, RAG_VERSION)
  assert.ok(system.includes('[literary-quality-es]'))
  assert.ok(system.includes('[format-story-es]'))
  assert.ok(system.includes('[tone-neutral-es]'))
  assert.ok(system.includes('Generation Envelope'))
  assert.ok(system.includes('anclar lugar'))
  assert.ok(user.includes('El viento mueve el mantel.'))
  assert.ok(user.includes('Terraza visible'))
  assert.ok(!user.includes('espía'))
  assert.ok(user.includes('sangre'))
  assert.deepEqual(bundle.ragIds.length, 6)
})

test('VN y tono dark seleccionan packs correctos; skill map registra RAGs', () => {
  const vn = { ...base, format: 'vn' as const, tone: 'dark', perspective: 'first' }
  const bundle = buildStoryPromptBundle(vn, { kind: 'continue', text: '' })
  assert.ok(bundle.ragIds.includes('format-visual-novel-es'))
  assert.ok(bundle.ragIds.includes('tone-dark-es'))
  assert.ok(bundle.ragIds.includes('perspective-first-person-interactive-es'))
  const versions = skillVersionMap('vn', vn)
  assert.equal(versions['narrative-rag'], RAG_VERSION)
  assert.equal(versions['format-visual-novel-es'], RAG_VERSION)
  assert.equal(versions['contrato-vn'], '1.0.0')
})
