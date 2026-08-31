import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSwarmImage, type SwarmCallError } from './swarm.ts'

test('cliente conserva diagnóstico estructurado aunque el proxy solo muestre 502', async (t) => {
  const diagnostic = {
    target: 'swarm', operation: '/API/GenerateText2Image',
    request: { model: 'model-a', prompt: 'portrait' }, requestSent: true,
    response: { status: 200, body: { error: 'No model input given' } }, message: 'No model input given'
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    statusMessage: 'Bad Gateway', message: 'SwarmUI respondió 502', data: { diagnostic }
  }, { status: 502 }))
  await assert.rejects(fetchSwarmImage({ prompt: 'portrait', model: 'model-a' }), (error: SwarmCallError) => {
    assert.equal(error.message, diagnostic.message)
    assert.deepEqual(error.diagnostic, diagnostic)
    return true
  })
})

test('cliente conserva un 502 de texto del proxy y no inventa respuesta de SwarmUI', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('gateway unavailable', { status: 502 }))
  await assert.rejects(fetchSwarmImage({ prompt: 'portrait', model: 'model-a' }), (error: SwarmCallError) => {
    assert.equal(error.diagnostic.target, 'proxy')
    assert.deepEqual(error.diagnostic.response, { status: 502, body: 'gateway unavailable' })
    assert.equal(error.diagnostic.request?.model, 'model-a')
    return true
  })
})

test('cliente propaga cancelaciones sin diagnosticarlas como error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Canceled', 'AbortError') })
  await assert.rejects(fetchSwarmImage({ prompt: 'portrait', model: 'model-a' }),
    (error: Partial<SwarmCallError>) => error.name === 'AbortError' && !error.diagnostic)
})
