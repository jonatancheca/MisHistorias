import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LlmDebugTrace, Message } from '../../shared/types/index.ts'
import { latestStoryGenerationFeedback } from './storyGenerationFeedback.ts'

const user: Message = { id: 'user', storyId: 'story', role: 'user', raw: 'Hola', segments: [], createdAt: 1 }
const failed: LlmDebugTrace = {
  id: 'failed', storyId: 'story', requestMessageId: user.id, status: 'error', createdAt: 2,
  request: {
    model: 'test', messages: [], temperature: 0.7, max_tokens: 100, stream: false,
    generation: { mode: 'auto', consumePendingImageInstructions: true, historyMessageIds: [user.id] }
  },
  response: { error: 'Servidor no disponible', status: 502 }
}

describe('avisos y reintentos de respuestas narrativas', () => {
  it('recupera fallo HTTP y operación Auto sin confundirlo con reenvío', () => {
    const feedback = latestStoryGenerationFeedback([failed], [user])!
    assert.equal(feedback.message, 'HTTP 502 · Servidor no disponible')
    assert.equal(feedback.retry?.mode, 'auto')
    assert.equal(feedback.retry?.consumePendingImageInstructions, true)
  })

  it('invalida reintento cuando cambia el historial narrativo', () => {
    assert.equal(latestStoryGenerationFeedback([failed], []), null)
    assert.equal(latestStoryGenerationFeedback([failed], [user, { ...user, id: 'new-user' }]), null)
  })

  it('errores de imágenes y compactación no sustituyen fallo narrativo', () => {
    const imageError: Message = {
      ...user, id: 'swarm', role: 'assistant', createdAt: 3,
      swarmError: {
        characterId: 'character', characterName: 'Vera', tags: [],
        call: { target: 'swarm', operation: 'generate', request: null, requestSent: false, response: null, message: 'Falló' }
      }
    }
    const compaction: LlmDebugTrace = {
      ...failed, id: 'compaction', createdAt: 4,
      request: { ...failed.request, purpose: 'compaction' }
    }
    assert.equal(latestStoryGenerationFeedback([failed, compaction], [user, imageError])?.traceId, failed.id)
  })

  it('no recupera aviso sustituido aunque nuevo intento se haya cancelado', () => {
    const dismissed = {
      ...failed, request: { ...failed.request, generation: { ...failed.request.generation!, dismissed: true } }
    }
    assert.equal(latestStoryGenerationFeedback([dismissed], [user]), null)
  })

  it('respuesta vacía permite reintento e historia resuelta oculta error anterior', () => {
    const empty: LlmDebugTrace = {
      ...failed, status: 'success', response: { content: '', finishReason: 'stop' }
    }
    assert.equal(latestStoryGenerationFeedback([empty], [user])?.message, 'El modelo no devolvió contenido visible.')
    assert.equal(latestStoryGenerationFeedback([empty], [user])?.retry?.mode, 'auto')
    const assistant: Message = { ...user, id: 'assistant', role: 'assistant', createdAt: 3 }
    const success: LlmDebugTrace = {
      ...empty, id: 'success', createdAt: 4, responseMessageId: assistant.id,
      response: { content: 'Hola', finishReason: 'stop' }
    }
    assert.equal(latestStoryGenerationFeedback([failed, success], [user, assistant]), null)
  })

  it('conserva aviso de texto truncado sin ofrecer duplicarlo', () => {
    const assistant: Message = { ...user, id: 'assistant', role: 'assistant', createdAt: 2 }
    const partial: LlmDebugTrace = {
      ...failed, status: 'success', responseMessageId: assistant.id,
      response: { content: 'Texto parcial.', finishReason: 'length' }
    }
    const feedback = latestStoryGenerationFeedback([partial], [user, assistant])!
    assert.equal(feedback.warning, true)
    assert.equal(feedback.retry, undefined)
    assert.match(feedback.message, /contenido parcial/)
  })
})
