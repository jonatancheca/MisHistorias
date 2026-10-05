import assert from 'node:assert/strict'
import test from 'node:test'
import type { LlmDebugTrace, Message } from '../../shared/types/index.ts'
import { storyOriginalText } from './storyOriginalText.ts'

const message: Message = { id: 'response', storyId: 'story', role: 'assistant', raw: 'Texto editado.', segments: [], createdAt: 1 }
const trace: LlmDebugTrace = {
  id: 'trace', storyId: 'story', responseMessageId: 'response', status: 'success', createdAt: 2,
  request: { model: 'test', messages: [], temperature: 0.7, max_tokens: 100, stream: false },
  response: { content: 'Imagen Alicia [neutral]: portrait.\nRespuesta completa.', finishReason: 'stop' }
}

test('original antiguo usa su respuesta exitosa y excluye compactaciones, otros mensajes e historias', () => {
  const invalid: LlmDebugTrace[] = [
    { ...trace, id: 'other-story', storyId: 'other' },
    { ...trace, id: 'other-response', responseMessageId: 'other' },
    { ...trace, id: 'compaction', request: { ...trace.request, purpose: 'compaction' } },
    { ...trace, id: 'failure', status: 'error', response: { error: 'Error' } }
  ]
  assert.equal(storyOriginalText(message, invalid), message.raw)
  assert.equal(storyOriginalText(message, [trace, ...invalid]), 'content' in trace.response ? trace.response.content : '')
})

test('original conservado tiene prioridad tras editar y no cambia las intervenciones del usuario', () => {
  assert.equal(storyOriginalText({ ...message, originalRaw: 'Respuesta recibida.' }, [trace]), 'Respuesta recibida.')
  assert.equal(storyOriginalText({ ...message, role: 'user', originalRaw: 'Respuesta recibida.' }, [trace]), message.raw)
  assert.equal(storyOriginalText(message), message.raw)
})
