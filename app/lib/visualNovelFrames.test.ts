import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '#shared/types'
import { buildVisualNovelFrames, resolveVisualNovelFrameIndex } from './visualNovelFrames.ts'

const messages: Message[] = [
  {
    id: 'user-1',
    storyId: 'story-1',
    role: 'user',
    raw: 'Entra en el bosque.',
    segments: [],
    createdAt: 1
  },
  {
    id: 'assistant-1',
    storyId: 'story-1',
    role: 'assistant',
    raw: '',
    segments: [
      { type: 'background', characterId: null, backgroundId: 'forest', tag: 'bosque', text: '' },
      { type: 'narration', characterId: null, tag: null, text: 'Las ramas crujen.' },
      { type: 'dialogue', characterId: 'alicia', tag: 'feliz', tags: ['feliz', 'sonrisa'], imageId: 'alicia-feliz', text: 'Hola.' },
      { type: 'narration', characterId: null, tag: null, text: 'Se oye un ruido.' },
      { type: 'dialogue', characterId: 'bruno', tag: 'serio', imageId: 'bruno-serio', text: 'Cuidado.' },
      { type: 'protagonist-dialogue', characterId: null, tag: null, text: 'Te sigo.' }
    ],
    createdAt: 2
  }
]

describe('pasos de novela visual', () => {
  it('crea un paso por segmento visible y uno por mensaje del usuario', () => {
    const frames = buildVisualNovelFrames(messages, {
      initialBackgroundId: 'room',
      initialBackgroundTag: 'habitación'
    })

    assert.equal(frames.length, 6)
    assert.deepEqual(frames.map((frame) => frame.kind), [
      'user',
      'narration',
      'dialogue',
      'narration',
      'dialogue',
      'protagonist-dialogue'
    ])
    assert.equal(frames[0]?.backgroundId, 'room')
    assert.equal(frames[1]?.backgroundId, 'forest')
  })

  it('mantiene el texto actual cuando el avance manual está activo', () => {
    assert.equal(resolveVisualNovelFrameIndex(4, 5, 6, true), 4)
    assert.equal(resolveVisualNovelFrameIndex(4, 5, 6, false), 5)
  })

  it('ajusta el índice si desaparecen textos', () => {
    assert.equal(resolveVisualNovelFrameIndex(5, 6, 3, true), 2)
    assert.equal(resolveVisualNovelFrameIndex(0, 1, 0, true), 0)
  })

  it('cambia al hablante y lo mantiene durante narración o protagonista', () => {
    const frames = buildVisualNovelFrames(messages, {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.equal(frames[1]?.characterState, null)
    assert.equal(frames[2]?.characterState?.characterId, 'alicia')
    assert.deepEqual(frames[2]?.characterState?.tags, ['feliz', 'sonrisa'])
    assert.equal(frames[3]?.characterState?.characterId, 'alicia')
    assert.equal(frames[4]?.characterState?.characterId, 'bruno')
    assert.equal(frames[5]?.characterState?.characterId, 'bruno')
    assert.equal(frames[5]?.characterState?.imageId, 'bruno-serio')
  })

  it('resuelve fondos antiguos por etiqueta sin mostrar la directiva', () => {
    const legacy: Message[] = [
      {
        id: 'assistant-legacy',
        storyId: 'story-1',
        role: 'assistant',
        raw: '',
        segments: [
          { type: 'background', characterId: null, tag: 'playa', text: '' },
          { type: 'narration', characterId: null, tag: null, text: 'Sube la marea.' }
        ],
        createdAt: 3
      }
    ]

    const frames = buildVisualNovelFrames(legacy, {
      initialBackgroundId: null,
      initialBackgroundTag: null,
      resolveBackgroundId: (tag) => tag === 'playa' ? 'beach' : null
    })

    assert.equal(frames.length, 1)
    assert.equal(frames[0]?.backgroundId, 'beach')
    assert.equal(frames[0]?.backgroundTag, 'playa')
  })
})
