import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasTag, nextAvailableTag, primaryTag, sanitizeTags, tagKey } from './tags.ts'

describe('etiquetas', () => {
  it('recorta, elimina vacías y deduplica sin distinguir mayúsculas', () => {
    assert.deepEqual(sanitizeTags([' Feliz ', '', 'feliz', 'ARMADURA']), ['Feliz', 'ARMADURA'])
    assert.equal(tagKey('  MiXeD  '), 'mixed')
  })

  it('admite formato antiguo y usa fallback solo cuando no hay valores', () => {
    assert.deepEqual(sanitizeTags(undefined, ' seria '), ['seria'])
    assert.deepEqual(sanitizeTags([], undefined, 'neutral'), ['neutral'])
    assert.deepEqual(sanitizeTags(['feliz'], 'seria', 'neutral'), ['feliz'])
  })

  it('consulta etiqueta principal y calcula siguiente valor libre', () => {
    const item = { tags: ['Bosque', 'exterior'] }
    assert.equal(primaryTag(item), 'Bosque')
    assert.equal(hasTag(item, ' bosque '), true)
    assert.equal(nextAvailableTag('bosque', new Set(['bosque', 'bosque-2'])), 'bosque-3')
  })
})
