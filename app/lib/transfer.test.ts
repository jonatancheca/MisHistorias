import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  exportCharacterTransferFields,
  importImageGenerationLora,
  importImageGenerationModel,
  importImageGenerationPromptPrefix,
  importImageGenerationPreset,
  importImageGenerationSeed
} from './characterTransfer.ts'

test('transferencia conserva preset y LoRA SwarmUI y acepta personajes anteriores', () => {
  const exported = exportCharacterTransferFields({
    id: 'character-1',
    name: 'Alicia',
    prompt: 'Prompt',
    tags: ['aventurera'],
    color: '#123456',
    imageGenerationPreset: 'Retrato',
    imageGenerationLora: 'Detalle',
    imageGenerationSeed: '9243353',
    imageGenerationPromptPrefix: 'masterpiece',
    imageGenerationModel: 'model-a',
    archived: true,
    createdAt: 1,
    updatedAt: 2
  })
  assert.equal(exported.imageGenerationPreset, 'Retrato')
  assert.equal(exported.imageGenerationLora, 'Detalle')
  assert.equal(exported.imageGenerationSeed, '9243353')
  assert.equal(exported.imageGenerationPromptPrefix, 'masterpiece')
  assert.equal(exported.imageGenerationModel, 'model-a')
  assert.equal(exported.archived, true)
  assert.equal(importImageGenerationPreset(exported.imageGenerationPreset), 'Retrato')
  assert.equal(importImageGenerationPreset(undefined), '')
  assert.equal(importImageGenerationLora(exported.imageGenerationLora), 'Detalle')
  assert.equal(importImageGenerationLora(undefined), '')
  assert.equal(importImageGenerationSeed(exported.imageGenerationSeed), '9243353')
  assert.equal(importImageGenerationSeed(undefined), '')
  assert.equal(importImageGenerationPromptPrefix(exported.imageGenerationPromptPrefix), 'masterpiece')
  assert.equal(importImageGenerationPromptPrefix(undefined), '')
  assert.equal(importImageGenerationModel(exported.imageGenerationModel), 'model-a')
  assert.equal(importImageGenerationModel(undefined), '')
})
