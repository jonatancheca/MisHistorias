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

  it('omite instrucciones IA de los pasos visibles', () => {
    const frames = buildVisualNovelFrames([
      messages[0]!,
      {
        id: 'instruction-1',
        storyId: 'story-1',
        role: 'user',
        raw: 'IA: Cambia el tono.',
        segments: [],
        createdAt: 1.5
      },
      messages[1]!
    ], {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.equal(frames.filter((frame) => frame.text.includes('Cambia el tono.')).length, 0)
    assert.equal(frames.filter((frame) => frame.kind === 'user').length, 1)
  })

  it('mantiene el texto actual cuando el avance manual está activo', () => {
    assert.equal(resolveVisualNovelFrameIndex(4, 5, 6, true), 4)
    assert.equal(resolveVisualNovelFrameIndex(4, 5, 6, false), 5)
  })

  it('ajusta el índice si desaparecen textos', () => {
    assert.equal(resolveVisualNovelFrameIndex(5, 6, 3, true), 2)
    assert.equal(resolveVisualNovelFrameIndex(0, 1, 0, true), 0)
  })

  it('mantiene hasta dos hablantes recientes durante narración o protagonista', () => {
    const frames = buildVisualNovelFrames(messages, {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.deepEqual(frames[1]?.characterStates, [])
    assert.deepEqual(frames[2]?.characterStates.map((state) => state.characterId), ['alicia'])
    assert.deepEqual(frames[2]?.characterStates[0]?.tags, ['feliz', 'sonrisa'])
    assert.deepEqual(frames[3]?.characterStates.map((state) => state.characterId), ['alicia'])
    assert.deepEqual(frames[4]?.characterStates.map((state) => state.characterId), [
      'alicia',
      'bruno'
    ])
    assert.deepEqual(frames[5]?.characterStates.map((state) => state.characterId), [
      'alicia',
      'bruno'
    ])
    assert.equal(frames[5]?.characterStates[1]?.imageId, 'bruno-serio')
  })

  it('reordena hablantes repetidos y conserva los dos últimos en mensajes del usuario', () => {
    const frames = buildVisualNovelFrames([
      {
        id: 'assistant-cast',
        storyId: 'story-1',
        role: 'assistant',
        raw: '',
        segments: [
          {
            type: 'dialogue',
            characterId: 'alicia',
            tag: 'feliz',
            imageId: 'alicia-feliz',
            text: 'A.'
          },
          {
            type: 'dialogue',
            characterId: 'bruno',
            tag: 'serio',
            imageId: 'bruno-serio',
            text: 'B.'
          },
          {
            type: 'dialogue',
            characterId: 'carla',
            tag: 'neutral',
            imageId: 'carla-neutral',
            text: 'C.'
          },
          {
            type: 'dialogue',
            characterId: 'bruno',
            tag: 'sorprendido',
            imageId: 'bruno-sorprendido',
            text: 'B otra vez.'
          },
          { type: 'narration', characterId: null, tag: null, text: 'Pausa.' }
        ],
        createdAt: 3
      },
      {
        id: 'user-after-cast',
        storyId: 'story-1',
        role: 'user',
        raw: 'Sigo escuchando.',
        segments: [],
        createdAt: 4
      }
    ], {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.deepEqual(frames[1]?.characterStates.map((state) => state.characterId), [
      'alicia',
      'bruno'
    ])
    assert.deepEqual(frames[2]?.characterStates.map((state) => state.characterId), [
      'bruno',
      'carla'
    ])
    assert.deepEqual(frames[3]?.characterStates.map((state) => state.characterId), [
      'carla',
      'bruno'
    ])
    assert.equal(frames[3]?.characterStates[1]?.tag, 'sorprendido')
    assert.deepEqual(frames[4]?.characterStates, frames[3]?.characterStates)
    assert.deepEqual(frames[5]?.characterStates, frames[4]?.characterStates)
  })

  it('crea el paso de diálogo al reconocer el prefijo aunque el texto esté vacío', () => {
    const frames = buildVisualNovelFrames([
      {
        id: 'assistant-prefix',
        storyId: 'story-1',
        role: 'assistant',
        raw: 'Alicia [feliz]:',
        segments: [
          {
            type: 'dialogue',
            characterId: 'alicia',
            tag: 'feliz',
            imageId: 'alicia-feliz',
            text: ''
          }
        ],
        createdAt: 5
      }
    ], {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.equal(frames.length, 1)
    assert.equal(frames[0]?.text, '')
    assert.deepEqual(frames[0]?.characterStates.map((state) => state.characterId), ['alicia'])
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
