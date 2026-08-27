import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Message } from '#shared/types'
import {
  buildVisualNovelFrames,
  resolveVisualNovelFrameIndex,
  visualNovelCharacterCapacity,
  withPendingAssistantMessage
} from './visualNovelFrames.ts'

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

  it('omite instrucciones IA y Narrador de los pasos visibles', () => {
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
      {
        id: 'instruction-2',
        storyId: 'story-1',
        role: 'user',
        raw: 'Narrador: Usa frases breves.',
        segments: [],
        createdAt: 1.6
      },
      messages[1]!
    ], {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.equal(frames.filter((frame) => frame.text.includes('Cambia el tono.')).length, 0)
    assert.equal(frames.filter((frame) => frame.text.includes('Usa frases breves.')).length, 0)
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

  it('mantiene los hablantes recientes durante narración o protagonista', () => {
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
    assert.equal(frames[5]?.characterStates[0]?.sourceMessageId, 'assistant-1')
    assert.equal(frames[5]?.characterStates[0]?.sourceSegmentIndex, 2)
  })

  it('sustituye solo el borrador por la respuesta completa pendiente', () => {
    const draft = { ...messages[1]!, raw: 'Las ramas', segments: messages[1]!.segments.slice(0, 2) }
    const visible = [messages[0]!, draft]

    const combined = withPendingAssistantMessage(visible, messages[1]!)

    assert.equal(combined.length, visible.length)
    assert.equal(combined[0], messages[0])
    assert.equal(combined[1], messages[1])
    assert.equal(withPendingAssistantMessage(visible, null), visible)
  })

  it('reordena hablantes repetidos y conserva el reparto en mensajes del usuario', () => {
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
      'alicia',
      'bruno',
      'carla'
    ])
    assert.deepEqual(frames[3]?.characterStates.map((state) => state.characterId), [
      'alicia',
      'carla',
      'bruno'
    ])
    assert.equal(frames[3]?.characterStates[2]?.tag, 'sorprendido')
    assert.deepEqual(frames[4]?.characterStates, frames[3]?.characterStates)
    assert.deepEqual(frames[5]?.characterStates, frames[4]?.characterStates)
  })

  it('calcula cuántos personajes caben según el ancho', () => {
    assert.equal(visualNovelCharacterCapacity(0), 2)
    assert.equal(visualNovelCharacterCapacity(320), 2)
    assert.equal(visualNovelCharacterCapacity(719), 2)
    assert.equal(visualNovelCharacterCapacity(720), 3)
    assert.equal(visualNovelCharacterCapacity(1200), 5)
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

  it('crea el paso del protagonista antes de empezar a pintar su texto', () => {
    const frames = buildVisualNovelFrames([
      {
        id: 'assistant-protagonist-prefix',
        storyId: 'story-1',
        role: 'assistant',
        raw: 'Vera:',
        segments: [
          {
            type: 'protagonist-dialogue',
            characterId: null,
            tag: null,
            text: ''
          }
        ],
        createdAt: 6
      }
    ], {
      initialBackgroundId: null,
      initialBackgroundTag: null
    })

    assert.equal(frames.length, 1)
    assert.equal(frames[0]?.kind, 'protagonist-dialogue')
    assert.equal(frames[0]?.text, '')
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

  it('crea pasos propios para sonidos actuales y antiguos', () => {
    const frames = buildVisualNovelFrames([{
      id: 'assistant-sounds',
      storyId: 'story-1',
      role: 'assistant',
      raw: '',
      segments: [
        { type: 'narration', characterId: null, tag: null, text: 'Antes.' },
        {
          type: 'sound',
          characterId: null,
          soundId: 'sound-current',
          tag: 'campana',
          text: ''
        },
        { type: 'sound', characterId: null, tag: 'lluvia', text: '' },
        { type: 'narration', characterId: null, tag: null, text: 'Después.' }
      ],
      createdAt: 7
    }], {
      initialBackgroundId: null,
      initialBackgroundTag: null,
      resolveSoundId: (tag) => tag === 'lluvia' ? 'sound-legacy' : null
    })

    assert.deepEqual(frames.map((frame) => frame.kind), [
      'narration',
      'sound',
      'sound',
      'narration'
    ])
    assert.equal(frames[1]?.soundId, 'sound-current')
    assert.equal(frames[1]?.soundTag, 'campana')
    assert.equal(frames[2]?.soundId, 'sound-legacy')
    assert.equal(frames[2]?.soundTag, 'lluvia')
  })
})
