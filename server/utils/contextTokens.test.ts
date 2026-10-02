import assert from 'node:assert/strict'
import test from 'node:test'
import type { LMStudioClient } from '@lmstudio/sdk'
import { measureLoadedContext, measureLmStudioContext } from './contextTokens.ts'
import { startFakeLmStudio } from '../../tests/helpers/fakeLmStudio.ts'

test('mide plantilla e instancia configuradas sin cargar cualquier otro modelo', async () => {
  let disposed = false
  let tokenized = ''
  const messages = [{ role: 'user' as const, content: 'Hola' }]
  class Client {
    llm = { listLoaded: async () => [
      { identifier: 'otro', path: 'otro', applyPromptTemplate: () => { throw new Error('Modelo incorrecto') } },
      { identifier: 'instancia', path: 'configurado', modelKey: 'model-key',
        applyPromptTemplate: async (input: unknown) => { assert.deepEqual(input, messages); return '<bos><user>Hola<assistant>' },
        countTokens: async (text: string) => { tokenized = text; return 7 }, getContextLength: async () => 8192 }
    ] }
    async [Symbol.asyncDispose]() { disposed = true }
  }
  assert.deepEqual(await measureLoadedContext(Client as unknown as typeof LMStudioClient, {
    baseUrl: 'ws://localhost:1234', apiToken: '', model: 'model-key', messages
  }), { tokens: 7, capacity: 8192, model: 'instancia' })
  assert.equal(tokenized, '<bos><user>Hola<assistant>')
  assert.equal(disposed, true)
  disposed = false
  await assert.rejects(measureLoadedContext(Client as unknown as typeof LMStudioClient, {
    baseUrl: 'ws://localhost:1234', apiToken: '', model: 'ausente', messages
  }), /no está cargado/)
  assert.equal(disposed, true)
})

test('worker se termina con timeout o cancelación y no expone la credencial', async () => {
  await assert.rejects(measureLmStudioContext({ baseUrl: 'http://127.0.0.1:1', apiKey: 'secreto-inválido' }, 'modelo', [
    { role: 'user', content: 'Hola' }
  ], undefined, 20), error => error instanceof Error && !error.message.includes('secreto-inválido'))
  const controller = new AbortController()
  const pending = measureLmStudioContext({ baseUrl: 'http://127.0.0.1:1', apiKey: '' }, 'modelo', [
    { role: 'user', content: 'Hola' }
  ], controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('SDK real en worker usa misma instancia, plantilla y capacidad cargada por WebSocket', async () => {
  const server = await startFakeLmStudio()
  try {
    assert.deepEqual(await measureLmStudioContext({ baseUrl: server.baseUrl, apiKey: '' }, 'configured-key', [
      { role: 'user', content: 'Hola' }
    ]), { tokens: 7, capacity: 8192, model: 'loaded-instance' })
    assert.deepEqual(server.calls.map(call => call.endpoint), ['listLoaded', 'applyPromptTemplate', 'countTokens', 'getLoadConfig'])
    assert.equal(server.calls[2]?.parameter.inputString, '<BOS><user>Hola<assistant>')
    for (const call of server.calls.slice(1)) assert.deepEqual(call.parameter.specifier, { type: 'instanceReference', instanceReference: 'instance-reference' })
  } finally { await server.close() }
})
