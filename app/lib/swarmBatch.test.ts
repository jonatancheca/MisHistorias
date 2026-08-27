import assert from 'node:assert/strict'
import test from 'node:test'
import { createSwarmBatch, joinSwarmPrompts, runSwarmBatch } from './swarmBatch.ts'
import { readImageGeneration } from '../../shared/utils/imageGeneration.ts'

const input = { count: 3, seed: '42', prefix: 'quality', prompt: 'portrait, ', tags: ['Feliz'],
  prompts: [{ prompt: ', sitting', tags: ['feliz', 'sentada'] }, { prompt: 'standing', tags: ['de pie'] }] }

test('combina prompts y etiquetas y reutiliza variantes sin incrementar semilla base', () => {
  assert.equal(joinSwarmPrompts('a', 'b'), 'a, b')
  assert.equal(joinSwarmPrompts('a, ', ', b'), 'a, b')
  const batch = createSwarmBatch(input, () => 9)
  const jobs = [...batch.jobs]
  assert.equal(batch.total, 6)
  assert.equal(jobs[0]!.prompt, 'quality\nportrait, sitting')
  assert.deepEqual(jobs[0]!.tags, ['Feliz', 'sentada'])
  assert.deepEqual(jobs.slice(0, 3).map((job) => job.generation), [
    { seed: 42 }, { seed: 42, variationSeed: 9, variationSeedStrength: 0.5 },
    { seed: 42, variationSeed: 10, variationSeedStrength: 0.5 }
  ])
  assert.deepEqual(jobs.slice(3).map((job) => job.generation), jobs.slice(0, 3).map((job) => job.generation))
})

test('resuelve semilla vacía una vez, admite generación normal y valida entradas', () => {
  let random = 100
  const jobs = [...createSwarmBatch({ ...input, seed: '' }, () => random++).jobs]
  assert.equal(new Set(jobs.map((job) => job.generation.seed)).size, 1)
  assert.equal(jobs[0]!.generation.seed, 100)
  assert.equal([...createSwarmBatch({ ...input, count: 1, prompts: undefined }).jobs].length, 1)
  for (const count of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createSwarmBatch({ ...input, count }))
  assert.throws(() => createSwarmBatch({ ...input, prompts: [] }))
  assert.throws(() => createSwarmBatch({ ...input, seed: '-1' }))
  assert.equal(readImageGeneration(undefined), undefined)
  for (const value of [{ seed: -1 }, { seed: 1, variationSeed: -1 }, { seed: 1, variationSeed: 2 }, { seed: 1, variationSeedStrength: 0.5 }]) {
    assert.throws(() => readImageGeneration(value))
  }
})

test('ejecuta secuencialmente, conserva éxitos y para ante fallo', async () => {
  const events: string[] = []
  await assert.rejects(runSwarmBatch({
    jobs: createSwarmBatch(input).jobs, signal: new AbortController().signal,
    generate: async () => { events.push('generate'); if (events.length > 2) throw new Error('fallo'); return 'image' },
    save: async () => { events.push('save') }, progress: (count) => assert.equal(count, 1)
  }), /fallo/)
  assert.deepEqual(events, ['generate', 'save', 'generate'])
})

test('cancelación descarta respuesta en vuelo y no inicia pendientes', async () => {
  const controller = new AbortController()
  let generated = 0
  await assert.rejects(runSwarmBatch({
    jobs: createSwarmBatch(input).jobs, signal: controller.signal,
    generate: async () => { generated++; controller.abort(); return 'image' },
    save: async () => assert.fail('No debe guardar después de cancelar'), progress: () => assert.fail()
  }), { name: 'AbortError' })
  assert.equal(generated, 1)
})
