import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { LMStudioClient } from '@lmstudio/sdk'
import { measureLoadedContext, measureLmStudioContext, resolveLmStudioSdkUrl } from './contextTokens.ts'
import { startFakeLmStudio } from '../../tests/helpers/fakeLmStudio.ts'

test('paquete portátil con solo ESM resuelve el SDK sin requerir index.cjs', () => {
  const root = resolve('.data')
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'context-sdk-'))
  try {
    const sdk = join(directory, 'node_modules', '@lmstudio', 'sdk')
    mkdirSync(join(sdk, 'dist'), { recursive: true })
    writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@lmstudio/sdk', exports: {
      '.': { require: './dist/index.cjs', import: './dist/index.mjs' }
    } }))
    writeFileSync(join(sdk, 'dist', 'index.mjs'), 'export class LMStudioClient {}')
    const base = pathToFileURL(join(directory, 'index.mjs')).href
    assert.throws(() => createRequire(base).resolve('@lmstudio/sdk'), { code: 'MODULE_NOT_FOUND' })
    assert.equal(resolveLmStudioSdkUrl(base), pathToFileURL(join(sdk, 'dist', 'index.mjs')).href)
  } finally {
    assert.ok(resolve(directory).startsWith(root + sep))
    rmSync(directory, { recursive: true, force: true })
  }
})

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

test('token inválido devuelve diagnóstico de ajustes sin exponer la credencial', async () => {
  await assert.rejects(measureLmStudioContext({ baseUrl: 'http://localhost:1234', apiKey: 'credencial-de-pruebas' },
    'modelo', undefined), error => {
    assert.equal((error as { code: string }).code, 'api_token')
    assert.match((error as Error).message, /token API válido de LM Studio/)
    assert.equal((error as Error).message.includes('credencial-de-pruebas'), false)
    return true
  })
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
    await assert.rejects(measureLmStudioContext({ baseUrl: server.baseUrl, apiKey: '' }, 'modelo-ausente', [
      { role: 'user', content: 'Hola' }
    ]), { code: 'model_not_loaded' })
  } finally { await server.close() }
})

test('consulta capacidad cargada sin plantilla, tokenizer ni carga implícita', async () => {
  const server = await startFakeLmStudio()
  try {
    assert.deepEqual(await measureLmStudioContext({ baseUrl: server.baseUrl, apiKey: '' }, 'configured-key', undefined),
      { tokens: 0, capacity: 8192, model: 'loaded-instance' })
    assert.deepEqual(server.calls.map(call => call.endpoint), ['listLoaded', 'getLoadConfig'])
    server.setMeasurement(7, 0)
    await assert.rejects(measureLmStudioContext({ baseUrl: server.baseUrl, apiKey: '' }, 'configured-key', undefined), { code: 'capacity' })
  } finally { await server.close() }
})

for (const messages of [
  [{ role: 'system' as const, content: 'Instrucciones y resumen anterior.' }],
  [{ role: 'assistant' as const, content: 'Historia anterior.' }],
  [{ role: 'system' as const, content: 'Instrucciones.' },
    { role: 'assistant' as const, content: 'Primera escena.' },
    { role: 'assistant' as const, content: 'Segunda escena.' }]
]) {
  test('mide contexto sin usuario sin alterar el historial: ' + messages.map(message => message.role).join(', '), async () => {
    const original = structuredClone(messages)
    let disposed = false
    class Client {
      llm = { listLoaded: async () => [{ identifier: 'modelo',
        applyPromptTemplate: async (input: unknown) => {
          assert.deepEqual(input, [...original, { role: 'user', content: '' }])
          return '<plantilla-del-modelo>'
        },
        countTokens: async (text: string) => { assert.equal(text, '<plantilla-del-modelo>'); return 42 },
        getContextLength: async () => 15104
      }] }
      async [Symbol.asyncDispose]() { disposed = true }
    }
    assert.deepEqual(await measureLoadedContext(Client as unknown as typeof LMStudioClient, {
      baseUrl: 'ws://localhost:1234', apiToken: '', model: 'modelo', messages
    }), { tokens: 42, capacity: 15104, model: 'modelo' })
    assert.deepEqual(messages, original)
    assert.equal(disposed, true)
  })
}
