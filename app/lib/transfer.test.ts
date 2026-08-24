import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  exportCharacterTransferFields,
  importImageGenerationPreset
} from './characterTransfer.ts'

test('transferencia conserva el preset SwarmUI y acepta personajes anteriores', () => {
  const exported = exportCharacterTransferFields({
    id: 'character-1',
    name: 'Alicia',
    prompt: 'Prompt',
    tags: ['aventurera'],
    color: '#123456',
    imageGenerationPreset: 'Retrato',
    archived: true,
    createdAt: 1,
    updatedAt: 2
  })
  assert.equal(exported.imageGenerationPreset, 'Retrato')
  assert.equal(exported.archived, true)
  assert.equal(importImageGenerationPreset(exported.imageGenerationPreset), 'Retrato')
  assert.equal(importImageGenerationPreset(undefined), '')
})
