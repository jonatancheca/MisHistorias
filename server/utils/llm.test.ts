import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import test from 'node:test'
import { fetchProxyChat, stripThinkingBlocks } from './llm.ts'

async function readJson(request: IncomingMessage) {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

test('elimina razonamiento cerrado, mayúsculo y sin cierre', () => {
  assert.equal(stripThinkingBlocks('<think>secreto</think>Visible'), 'Visible')
  assert.equal(stripThinkingBlocks('<THINK>secreto</THINK>Visible'), 'Visible')
  assert.equal(stripThinkingBlocks('Visible<think>secreto'), 'Visible')
})

test('proxy envía JSON no streaming y conserva finishReason', async () => {
  let received: Record<string, unknown> | null = null
  let authorization = ''
  const server = createServer(async (request, response) => {
    authorization = String(request.headers.authorization ?? '')
    received = await readJson(request)
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            message: { reasoning_content: 'oculto', content: '<think>oculto</think>Respuesta' },
            finish_reason: 'stop'
          }
        ]
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')

  try {
    const result = await fetchProxyChat(
      { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'token' },
      {
        model: 'modelo',
        messages: [{ role: 'user', content: 'Hola' }],
        temperature: 0.8,
        maxTokens: 100
      }
    )
    assert.equal(result.content, 'Respuesta')
    assert.equal(result.finishReason, 'stop')
    assert.equal(received?.stream, false)
    assert.equal(received?.reasoning_effort, 'none')
    assert.equal(authorization, 'Bearer token')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('proxy usa reasoning_content si content llega vacío', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '',
              reasoning_content: '{"schemaVersion":1,"visibleUnits":[]}'
            },
            finish_reason: 'length'
          }
        ]
      })
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')

  try {
    const result = await fetchProxyChat(
      { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: '' },
      {
        model: 'modelo',
        messages: [{ role: 'user', content: 'Hola' }],
        temperature: 0.8,
        maxTokens: 100
      }
    )
    assert.equal(result.content, '{"schemaVersion":1,"visibleUnits":[]}')
    assert.equal(result.finishReason, 'length')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('proxy propaga cancelación', async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => response.end('{"choices":[]}'), 250)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 20)

  try {
    await assert.rejects(
      fetchProxyChat(
        { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: '' },
        {
          model: 'modelo',
          messages: [{ role: 'user', content: 'Hola' }],
          temperature: 0.8,
          maxTokens: 100,
          signal: controller.signal
        }
      ),
      (error: Error) => error.name === 'AbortError'
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
