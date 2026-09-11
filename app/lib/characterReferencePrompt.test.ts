import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCharacterReferencePromptMessages,
  cleanCharacterReferencePrompt,
  DEFAULT_CHARACTER_REFERENCE_PROMPT,
  generateCharacterReferencePrompt,
  isSupportedCharacterReferenceImage
} from './characterReferencePrompt.ts'

const image = new File([new Uint8Array([1, 2, 3])], 'reference.png', { type: 'image/png' })

describe('prompt visual desde foto', () => {
  it('construye mensajes multimodales para ComfyUI con instrucción configurable', () => {
    const messages = buildCharacterReferencePromptMessages(
      'Instrucción personalizada',
      'data:image/png;base64,AQID'
    )

    assert.equal(messages[0]?.content, 'Instrucción personalizada')
    assert.deepEqual(messages[1]?.content, [
      {
        type: 'text',
        text: 'Create the reusable character prompt for ComfyUI from this reference photo.'
      },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
    ])
    assert.match(DEFAULT_CHARACTER_REFERENCE_PROMPT, /stable visible identity/)
    assert.match(DEFAULT_CHARACTER_REFERENCE_PROMPT, /Do not describe pose/)
  })

  it('solo admite formatos visuales compatibles con el proxy', () => {
    assert.equal(isSupportedCharacterReferenceImage(image), true)
    assert.equal(
      isSupportedCharacterReferenceImage(new File(['gif'], 'reference.gif', { type: 'image/gif' })),
      false
    )
  })

  it('limpia razonamiento, etiquetas y Markdown', () => {
    assert.equal(
      cleanCharacterReferencePrompt(
        '<think>analysis</think>```text\nPrompt: <lora:detail:1> young woman, preset: portrait\nNegative prompt: blur\n```'
      ),
      'young woman,'
    )
  })

  it('usa LM Studio, ámbito y ajustes activos', async () => {
    let received: import('./llm.ts').LlmChatRequest | undefined
    const prompt = await generateCharacterReferencePrompt(
      image,
      {
        model: 'vision-model',
        temperature: 0.4,
        maxTokens: 321,
        systemPrompt: 'Sistema visual',
        scope: 'private'
      },
      {
        chat: async (value) => {
          received = value
          return { content: 'Red-haired woman in a blue coat', finishReason: 'stop' }
        }
      }
    )

    assert.equal(prompt, 'Red-haired woman in a blue coat')
    assert.equal(received?.model, 'vision-model')
    assert.equal(received?.temperature, 0.4)
    assert.equal(received?.maxTokens, 321)
    assert.equal(received?.scope, 'private')
    assert.deepEqual(received?.messages[1]?.content, [
      {
        type: 'text',
        text: 'Create the reusable character prompt for ComfyUI from this reference photo.'
      },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
    ])
  })

  it('rechaza respuestas truncadas o vacías', async () => {
    const options = {
      model: 'vision-model', temperature: 0.4, maxTokens: 321,
      systemPrompt: 'Sistema visual', scope: 'normal' as const
    }
    await assert.rejects(
      generateCharacterReferencePrompt(image, options, {
        chat: async () => ({ content: 'incompleto', finishReason: 'length' })
      }),
      /quedó truncada/
    )
    await assert.rejects(
      generateCharacterReferencePrompt(image, options, {
        chat: async () => ({ content: '<think>sin respuesta</think>', finishReason: 'stop' })
      }),
      /no devolvió un prompt visual/
    )
  })
})
