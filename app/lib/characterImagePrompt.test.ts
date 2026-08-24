import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Character } from '../../shared/types/index.ts'
import {
  buildCharacterImagePromptMessages,
  cleanCharacterImagePrompt,
  generateCharacterImagePrompt
} from './characterImagePrompt.ts'

const character: Character = {
  id: 'character-1',
  name: 'Alicia',
  prompt: 'Una exploradora decidida.',
  tags: ['aventurera'],
  color: '#123456',
  imageGenerationPreset: '',
  archived: false,
  createdAt: 1,
  updatedAt: 1
}

describe('prompt manual de imagen', () => {
  it('pide inglés, postura, ropa y emoción sin sintaxis Swarm', () => {
    const messages = buildCharacterImagePromptMessages({
      character,
      tags: ['plano entero'],
      notes: 'Con una capa roja.'
    })
    assert.match(messages[0]!.content, /English/)
    assert.match(messages[0]!.content, /pose, clothing, and visible emotion/)
    assert.match(messages[0]!.content, /Never include LoRA or preset syntax/)
    assert.match(messages[1]!.content, /capa roja/)
  })

  it('limpia comandos LoRA y preset de una respuesta', () => {
    assert.equal(
      cleanCharacterImagePrompt('```text\n<lora:detail:1> Hero standing, preset: portrait\n```'),
      'Hero standing,'
    )
  })

  it('Chrome falla sin intentar LM Studio', async () => {
    let lmStudioCalls = 0
    await assert.rejects(
      generateCharacterImagePrompt(
        { character, tags: [], notes: '' },
        { useChromeLlm: true, model: 'fallback-prohibido', temperature: 0.8 },
        undefined,
        {
          chrome: async () => { throw new Error('Chrome incompatible') },
          lmStudio: async () => {
            lmStudioCalls += 1
            return { content: 'fallback', finishReason: null }
          }
        }
      ),
      /Chrome incompatible/
    )
    assert.equal(lmStudioCalls, 0)
  })
})
