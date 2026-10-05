import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MessageSegment } from '#shared/types'
import { replaceFollowingMatchingDialogueImages } from './messageImages.ts'

describe('reemplazo manual de imágenes en mensajes', () => {
  it('actualiza el origen y diálogos siguientes del mismo personaje y etiquetas', () => {
    const segments: MessageSegment[] = [
      {
        type: 'dialogue',
        characterId: 'a',
        tag: 'feliz',
        tags: ['feliz', 'capa'],
        imageId: 'old',
        text: 'Antes.'
      },
      { type: 'narration', characterId: null, tag: null, text: 'Pausa.' },
      {
        type: 'dialogue',
        characterId: 'a',
        tag: 'capa',
        tags: ['CAPA', 'FELIZ'],
        imageId: 'old-2',
        text: 'Origen.'
      },
      {
        type: 'dialogue',
        characterId: 'a',
        tag: 'feliz',
        tags: ['feliz', 'capa'],
        imageId: 'old-3',
        text: 'Después.'
      },
      {
        type: 'dialogue',
        characterId: 'a',
        tag: 'seria',
        tags: ['seria'],
        imageId: 'serious',
        text: 'Distintas etiquetas.'
      },
      {
        type: 'dialogue',
        characterId: 'b',
        tag: 'feliz',
        tags: ['feliz', 'capa'],
        imageId: 'other',
        text: 'Otro personaje.'
      }
    ]

    const result = replaceFollowingMatchingDialogueImages(segments, 2, 'selected')

    assert.equal(result[0]?.imageId, 'old')
    assert.deepEqual(result.slice(2, 4).map((segment) => segment.imageId), ['selected', 'selected'])
    assert.deepEqual(result.slice(2, 4).map((segment) => segment.imageIdOverride), [true, true])
    assert.equal(result[4]?.imageId, 'serious')
    assert.equal(result[5]?.imageId, 'other')
    assert.equal(result[3]?.text, 'Después.')
    assert.deepEqual(result[3]?.tags, ['feliz', 'capa'])
  })

  it('usa tag legado cuando no existen tags', () => {
    const segments: MessageSegment[] = [
      { type: 'dialogue', characterId: 'a', tag: 'feliz', imageId: 'old', text: 'Uno.' },
      { type: 'dialogue', characterId: 'a', tag: 'FELIZ', imageId: 'old-2', text: 'Dos.' }
    ]

    const result = replaceFollowingMatchingDialogueImages(segments, 0, 'selected')

    assert.deepEqual(result.map((segment) => segment.imageId), ['selected', 'selected'])
  })
})

it('reemplaza imágenes entre pensamientos y diálogos con las mismas etiquetas', () => {
  const segments: MessageSegment[] = [
    { type: 'dialogue', characterId: 'a', tag: 'feliz', imageId: 'before', text: 'Antes.' },
    { type: 'thought', characterId: 'a', tag: 'feliz', imageId: 'old', text: 'Pienso.' },
    { type: 'dialogue', characterId: 'a', tag: 'FELIZ', imageId: 'old', text: 'Hablo.' },
    { type: 'thought', characterId: 'a', tag: 'seria', imageId: 'other', text: 'Cambio.' }
  ]
  const result = replaceFollowingMatchingDialogueImages(segments, 1, 'selected')
  assert.deepEqual(result.map(segment => segment.imageId), ['before', 'selected', 'selected', 'other'])
  assert.equal(result[1]?.imageIdOverride, true)
  assert.equal(result[2]?.imageIdOverride, true)
  assert.equal(result[1]?.type, 'thought')
})
