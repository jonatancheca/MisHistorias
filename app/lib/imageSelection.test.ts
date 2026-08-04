import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { selectCharacterImage, stableIndex } from './imageSelection.ts'

const images = [
  { id: 'a', characterId: 'c1', tags: ['feliz'], isDefault: true },
  { id: 'b', characterId: 'c1', tags: ['feliz'], isDefault: false },
  { id: 'c', characterId: 'c2', tags: ['feliz'], isDefault: true }
]

describe('selección estable de imágenes', () => {
  it('mantiene la misma coincidencia para la misma semilla', () => {
    const first = selectCharacterImage(images, 'c1', 'FELIZ', 'message-1:0')
    const second = selectCharacterImage(images, 'c1', 'feliz', 'message-1:0')
    assert.equal(first?.id, second?.id)
    assert.ok(first?.id === 'a' || first?.id === 'b')
  })

  it('limita el índice y usa imagen por defecto sin coincidencias', () => {
    assert.ok(stableIndex('seed', 2) >= 0 && stableIndex('seed', 2) < 2)
    assert.equal(selectCharacterImage(images, 'c1', 'serio', 'message-1:1')?.id, 'a')
    assert.equal(selectCharacterImage(images, 'missing', 'feliz', 'message-1:2'), null)
  })
})
