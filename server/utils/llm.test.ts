import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import test from 'node:test'
import {
  fetchProxyChat,
  loadConfiguredModel,
  stripThinkingBlocks,
  unloadAllModels
} from './llm.ts'

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
  const received: Record<string, unknown>[] = []
  let authorization = ''
  const server = createServer(async (request, response) => {
    authorization = String(request.headers.authorization ?? '')
    received.push(await readJson(request))
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
    assert.equal(received.length, 1)
    assert.equal(received[0]?.stream, false)
    assert.equal(authorization, 'Bearer token')
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('proxy conserva bloques multimodales de imagen', async () => {
  let received: Record<string, unknown> | null = null
  const server = createServer(async (request, response) => {
    received = await readJson(request)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'caption' }, finish_reason: 'stop' }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  try {
    await fetchProxyChat(
      { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: '' },
      {
        model: 'vision',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'caption this' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
          ]
        }]
      }
    )
    const messages = received?.messages as Array<{ content: unknown }>
    assert.deepEqual(messages[0]?.content, [
      { type: 'text', text: 'caption this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
    ])
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
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

test('precarga solo el modelo configurado y evita duplicar una instancia cargada', async () => {
  let loaded = false
  const posts: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer token')
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET') {
      response.end(JSON.stringify({ models: [
        { key: 'modelo', type: 'llm', loaded_instances: loaded ? [{ id: 'modelo' }] : [] }
      ] }))
      return
    }
    assert.equal(request.url, '/api/v1/models/load')
    posts.push(await readJson(request))
    loaded = true
    response.end(JSON.stringify({ status: 'loaded', instance_id: 'modelo' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  const settings = { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'token' }
  try {
    await assert.rejects(
      loadConfiguredModel(settings, 'modelo-ausente'),
      /no está disponible/
    )
    assert.deepEqual(await loadConfiguredModel(settings, 'modelo'), {
      status: 'loaded', instanceId: 'modelo'
    })
    assert.deepEqual(await loadConfiguredModel(settings, 'modelo'), {
      status: 'already-loaded', instanceId: 'modelo'
    })
    assert.deepEqual(posts, [{ model: 'modelo' }])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())))
  }
})

test('descarga todas las instancias y continúa si una falla', async () => {
  const attempted: string[] = []
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET') {
      response.end(JSON.stringify({ models: [
        { key: 'llm', type: 'llm', loaded_instances: [{ id: 'uno' }, { id: 'dos' }] },
        { key: 'embedding', type: 'embedding', loaded_instances: [{ id: 'tres' }] }
      ] }))
      return
    }
    const body = await readJson(request)
    const instanceId = String(body.instance_id)
    attempted.push(instanceId)
    if (instanceId === 'dos') {
      response.statusCode = 500
      response.end(JSON.stringify({ error: 'fallo' }))
      return
    }
    response.end(JSON.stringify({ instance_id: instanceId }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  try {
    const result = await unloadAllModels({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: '' })
    assert.deepEqual(attempted, ['uno', 'dos', 'tres'])
    assert.deepEqual(result, {
      total: 3,
      unloaded: 2,
      failed: [{ instanceId: 'dos', message: 'El servidor del modelo respondió 500' }]
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())))
  }
})
