import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import test from 'node:test'
import { fetchSwarmCatalog, generateSwarmImage, normalizeSwarmBaseUrl } from './swarm.ts'

async function readJson(request: IncomingMessage) {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

test('cliente Swarm acepta servidores públicos HTTP y HTTPS', () => {
  assert.equal(
    normalizeSwarmBaseUrl('https://swarmui2.jonatancheca.com/'),
    'https://swarmui2.jonatancheca.com'
  )
  assert.equal(
    normalizeSwarmBaseUrl('http://swarm.example.test/api///'),
    'http://swarm.example.test/api'
  )
  assert.equal(normalizeSwarmBaseUrl('http://localhost:7801'), 'http://localhost:7801')
})

test('cliente Swarm rechaza URLs vacías, inválidas o con otro protocolo', () => {
  assert.throws(() => normalizeSwarmBaseUrl(''), /Falta la URL de SwarmUI/)
  assert.throws(() => normalizeSwarmBaseUrl('no es una URL'), /URL de SwarmUI no válida/)
  assert.throws(() => normalizeSwarmBaseUrl('ftp://swarm.example.test'), /http o https/)
})

test('cliente Swarm renueva sesión, lista catálogo, autentica y descarga imagen', async () => {
  let sessions = 0
  let paramsCalls = 0
  let generationBody: Record<string, unknown> | null = null
  const cookies: string[] = []
  const server = createServer(async (request, response) => {
    cookies.push(String(request.headers.cookie ?? ''))
    if (request.url === '/generated.png') {
      response.setHeader('content-type', 'image/png')
      response.end(Buffer.from([137, 80, 78, 71]))
      return
    }
    const body = await readJson(request)
    response.setHeader('content-type', 'application/json')
    if (request.url === '/API/GetNewSession') {
      sessions += 1
      response.end(JSON.stringify({ session_id: `session-${sessions}`, version: '1.2.3' }))
    } else if (request.url === '/API/ListT2IParams') {
      paramsCalls += 1
      response.end(paramsCalls === 1
        ? JSON.stringify({ error_id: 'invalid_session_id' })
        : JSON.stringify({
            models: {
              'Stable-Diffusion': [['z-model', 'arch'], 'a-model'],
              LoRA: [['detail', 'lora-arch']]
            }
          }))
    } else if (request.url === '/API/GetMyUserData') {
      response.end(JSON.stringify({ presets: [{ title: 'Retrato' }] }))
    } else if (request.url === '/API/GenerateText2Image') {
      generationBody = body
      response.end(JSON.stringify({ images: ['/generated.png'] }))
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  const settings = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    authToken: 'token privado'
  }

  try {
    const catalog = await fetchSwarmCatalog(settings)
    assert.deepEqual(catalog, {
      version: '1.2.3',
      models: ['a-model', 'z-model'],
      loras: ['detail'],
      presets: ['Retrato']
    })
    assert.equal(sessions, 2)

    const image = await generateSwarmImage(settings, {
      prompt: 'portrait',
      model: 'a-model'
    })
    assert.equal(image.mimeType, 'image/png')
    assert.deepEqual(Array.from(image.bytes), [137, 80, 78, 71])
    assert.equal(generationBody?.images, 1)
    assert.equal(generationBody?.donotsave, true)
    assert.equal(generationBody?.model, 'a-model')
    assert.equal(cookies.every((cookie) => cookie === 'swarm_token=token%20privado'), true)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  }
})

test('cliente Swarm combina modelo, preset y LoRA sin contaminar el prompt editable', async () => {
  let generatedPrompt = ''
  let generatedModel = ''
  let generatedSeed: unknown
  const server = createServer(async (request, response) => {
    const body = await readJson(request)
    response.setHeader('content-type', 'application/json')
    if (request.url === '/API/GetNewSession') {
      response.end(JSON.stringify({ session_id: 'session', version: '1' }))
    } else {
      generatedPrompt = String(body.prompt ?? '')
      generatedModel = String(body.model ?? '')
      generatedSeed = body.seed
      response.end(JSON.stringify({ images: ['data:image/png;base64,iVBORw=='] }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  try {
    await generateSwarmImage(
      { baseUrl: `http://127.0.0.1:${address.port}`, authToken: '' },
      {
        prompt: 'editable prompt',
        preset: 'Retrato',
        model: 'modelo',
        lora: 'detalle',
        seed: 9243353
      }
    )
    assert.equal(generatedPrompt, '<preset:Retrato>\n<lora:detalle>\neditable prompt')
    assert.equal(generatedModel, 'modelo')
    assert.equal(generatedSeed, 9243353)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  }
})

test('cliente Swarm rechaza semillas no válidas', async () => {
  await assert.rejects(
    generateSwarmImage(
      { baseUrl: 'http://localhost:7801', authToken: '' },
      { prompt: 'portrait', model: 'model', seed: -1 }
    ),
    /Semilla no válida/
  )
})

test('cliente Swarm propaga cancelación', async () => {
  const server = createServer(async (request, response) => {
    await readJson(request)
    setTimeout(() => response.end(JSON.stringify({ session_id: 'late' })), 250)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Puerto de prueba no disponible')
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 20)
  try {
    await assert.rejects(
      generateSwarmImage(
        { baseUrl: `http://127.0.0.1:${address.port}`, authToken: '' },
        { prompt: 'portrait', model: 'model', signal: controller.signal }
      ),
      (error: Error) => error.name === 'AbortError'
    )
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  }
})
