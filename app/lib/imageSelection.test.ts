import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { selectCharacterImage, stableIndex } from './imageSelection.ts'

const images = [
  { id: 'default', characterId: 'c1', tags: ['neutral'], isDefault: true },
  { id: 'happy', characterId: 'c1', tags: ['feliz', 'sonrisa'], isDefault: false },
  { id: 'armored', characterId: 'c1', tags: ['feliz', 'armadura'], isDefault: false },
  { id: 'other', characterId: 'c2', tags: ['feliz', 'armadura'], isDefault: true }
]

describe('selección estable de imágenes', () => {
  it('mantiene la misma coincidencia para la misma semilla', () => {
    const first = selectCharacterImage(images, 'c1', ['FELIZ'], 'message-1:0')
    const second = selectCharacterImage(images, 'c1', 'feliz', 'message-1:0')
    assert.equal(first?.id, second?.id)
    assert.ok(first?.id === 'happy' || first?.id === 'armored')
  })

  it('prioriza la imagen que contiene todas las etiquetas', () => {
    assert.equal(
      selectCharacterImage(images, 'c1', [' feliz ', 'ARMADURA', 'feliz'], 'message-1:1')?.id,
      'armored'
    )
  })

  it('usa la mayor coincidencia parcial y nunca otro personaje', () => {
    assert.equal(
      selectCharacterImage(images, 'c1', ['feliz', 'armadura', 'capa'], 'message-1:2')?.id,
      'armored'
    )
  })

  it('usa la imagen por defecto cuando ninguna etiqueta coincide', () => {
    assert.equal(selectCharacterImage(images, 'c1', ['serio'], 'message-1:3')?.id, 'default')
    assert.equal(selectCharacterImage(images, 'missing', ['feliz'], 'message-1:4'), null)
  })

  it('prioriza el conjunto exacto aunque la imagen con etiquetas extra aparezca antes', () => {
    const disguiseImages = [
      { id: 'hidden', characterId: 'c1', tags: ['disfrazada', 'escondida'], isDefault: false },
      { id: 'disguised', characterId: 'c1', tags: ['disfrazada'], isDefault: false }
    ]

    assert.equal(
      selectCharacterImage(disguiseImages, 'c1', ['DISFRAZADA'], 'message-exact')?.id,
      'disguised'
    )
  })

  it('prefiere menos etiquetas extra cuando no existe conjunto exacto', () => {
    const partialImages = [
      { id: 'many-extra', characterId: 'c1', tags: ['feliz', 'sonrisa', 'escondida'], isDefault: false },
      { id: 'one-extra', characterId: 'c1', tags: ['feliz', 'sonrisa'], isDefault: false }
    ]

    assert.equal(
      selectCharacterImage(partialImages, 'c1', ['feliz', 'capa'], 'message-specific')?.id,
      'one-extra'
    )
  })

  it('conserva la imagen por defecto cuando no se piden etiquetas', () => {
    assert.ok(stableIndex('seed', 2) >= 0 && stableIndex('seed', 2) < 2)
    assert.equal(selectCharacterImage(images, 'c1', [], 'message-1:5')?.id, 'default')
  })

  it('solo conserva la imagen preferida si pertenece al mejor grupo', () => {
    const disguiseImages = [
      { id: 'hidden', characterId: 'c1', tags: ['disfrazada', 'escondida'], isDefault: false },
      { id: 'disguised-a', characterId: 'c1', tags: ['disfrazada'], isDefault: false },
      { id: 'disguised-b', characterId: 'c1', tags: ['disfrazada'], isDefault: false }
    ]

    assert.notEqual(
      selectCharacterImage(disguiseImages, 'c1', ['disfrazada'], 'message-preferred', 'hidden')?.id,
      'hidden'
    )
    assert.equal(
      selectCharacterImage(
        disguiseImages,
        'c1',
        ['disfrazada'],
        'message-preferred',
        'disguised-b'
      )?.id,
      'disguised-b'
    )
  })
})
