import assert from 'node:assert/strict'
import test from 'node:test'
import type { Character } from '../../shared/types/index.ts'
import {
  createStoryImageJobs,
  parseStoryImageRequests
} from './storyImageGeneration.ts'

const character = (id: string, name: string): Character => ({
  id,
  name,
  prompt: '',
  tags: [],
  color: '#123456',
  imageGenerationPreset: 'Retrato',
  imageGenerationLora: 'Detalle',
  imageGenerationSeed: '42',
  imageGenerationPromptPrefix: 'quality',
  imageGenerationModel: 'model-a',
  archived: false,
  createdAt: 1,
  updatedAt: 1
})

test('extrae directivas de imagen, resuelve alias y descarta duplicados', () => {
  const characters = [character('a', 'Alicia'), character('b', 'Bruno')]
  const result = parseStoryImageRequests([
    'Narración visible.',
    'Imagen ALICIA [nueva]: standing in a forest',
    'Alicia [nueva]: Hola.',
    'Imagen Alicia [otra]: duplicate request',
    'Imagen Nadie [x]: invalid',
    'Imagen Bruno [serio]: '
  ].join('\n'), characters, true)

  assert.equal(result.visibleRaw, 'Narración visible.\nAlicia [nueva]: Hola.')
  assert.deepEqual(result.requests, [{
    characterId: 'a',
    characterName: 'Alicia',
    tags: ['nueva'],
    prompt: 'standing in a forest'
  }])
  assert.equal(result.warnings.length, 3)
})

test('desactivado conserva el texto y no solicita imágenes', () => {
  const raw = 'Imagen Alicia [nueva]: standing in a forest'
  assert.deepEqual(parseStoryImageRequests(raw, [character('a', 'Alicia')], false), {
    visibleRaw: raw,
    requests: [],
    warnings: []
  })
})

test('ordena primeras imágenes de todos los personajes antes de variantes', () => {
  const characters = [character('a', 'Alicia'), character('b', 'Bruno')]
  const result = createStoryImageJobs([
    { characterId: 'a', characterName: 'Alicia', tags: ['nueva'], prompt: 'standing' },
    { characterId: 'b', characterName: 'Bruno', tags: ['nueva'], prompt: 'sitting' }
  ], characters, () => 100)

  assert.equal(result.total, 6)
  assert.deepEqual(result.jobs.map((job) => [job.characterId, job.generation.variationSeed]), [
    ['a', undefined],
    ['b', undefined],
    ['a', 100],
    ['b', 100],
    ['a', 101],
    ['b', 101]
  ])
  assert.equal(result.jobs[0]?.generation.seed, 42)
  assert.equal(result.jobs[2]?.generation.variationSeedStrength, 0.5)
})
