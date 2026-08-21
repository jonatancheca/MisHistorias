import assert from 'node:assert/strict'
import test from 'node:test'
import { selectSpriteByQuery } from '../../../shared/types/nsfw/studio.ts'

test('selectSpriteByQuery exige required, excluye incompatibles y puntúa preferred', () => {
  const sprites = [
    { id: 'a', facets: ['angry', 'nude'] },
    { id: 'b', facets: ['neutral', 'standing', 'clothed'] },
    { id: 'c', facets: ['neutral', 'sitting', 'clothed', 'smile'] }
  ]
  const selected = selectSpriteByQuery(sprites, {
    required: ['neutral', 'clothed'],
    preferred: [
      { tag: 'smile', weight: 3 },
      { tag: 'standing', weight: 1 }
    ],
    excluded: ['nude']
  })
  assert.equal(selected?.id, 'c')
})

test('selectSpriteByQuery cae a candidatos sin excluded si falta required', () => {
  const sprites = [
    { id: 'a', facets: ['angry'] },
    { id: 'b', facets: ['neutral'] }
  ]
  const selected = selectSpriteByQuery(sprites, {
    required: ['impossible'],
    preferred: [{ tag: 'neutral', weight: 2 }],
    excluded: []
  })
  assert.equal(selected?.id, 'b')
})
