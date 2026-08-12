import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jiti = createJiti(import.meta.url, {
  alias: {
    '~': resolve(root, 'app'),
    '#shared': resolve(root, 'shared')
  }
})
const { parseSegments, serializeSegments } = await jiti.import<
  typeof import('../../app/lib/streamParser.ts')
>('../../app/lib/streamParser.ts')

const characters = [
  {
    id: 'alicia',
    name: 'Alicia',
    prompt: '',
    tags: [],
    color: '#000000',
    createdAt: 1,
    updatedAt: 1
  }
]

const images = [
  {
    id: 'neutral',
    characterId: 'alicia',
    tags: ['neutral'],
    description: '',
    isDefault: true,
    mimeType: 'image/png',
    createdAt: 1
  },
  {
    id: 'happy',
    characterId: 'alicia',
    tags: ['feliz', 'sonrisa'],
    description: '',
    isDefault: false,
    mimeType: 'image/png',
    createdAt: 2
  }
]

describe('parser de etiquetas visuales', () => {
  it('extrae etiquetas repetidas, normaliza duplicados y resuelve coincidencia total', () => {
    const segments = parseSegments(
      'Alicia [ feliz ][SONRISA][feliz]: Hola.',
      characters,
      [],
      '',
      images,
      'message-1'
    )

    assert.deepEqual(segments[0]?.tags, ['feliz', 'SONRISA'])
    assert.equal(segments[0]?.tag, 'feliz')
    assert.equal(segments[0]?.imageId, 'happy')
    assert.equal(serializeSegments(segments, characters), 'Alicia [feliz][SONRISA]: Hola.')
  })

  it('usa coincidencia parcial pero no imagen sin ninguna coincidencia', () => {
    const partial = parseSegments(
      'Alicia [feliz][armadura]: Parcial.',
      characters,
      [],
      '',
      images,
      'message-2'
    )
    const missing = parseSegments(
      'Alicia [armadura]: Ninguna.',
      characters,
      [],
      '',
      images,
      'message-3'
    )

    assert.equal(partial[0]?.imageId, 'happy')
    assert.equal(missing[0]?.imageId, null)
  })

  it('mantiene formato antiguo de una etiqueta y fondos sin cambios', () => {
    const segments = parseSegments(
      'Fondo [bosque]:\nAlicia [neutral]: Hola.',
      characters,
      [{ id: 'forest', tags: ['bosque'], description: '', mimeType: 'image/png', createdAt: 1 }],
      '',
      images,
      'message-4'
    )

    assert.equal(segments[0]?.type, 'background')
    assert.equal(segments[0]?.tag, 'bosque')
    assert.deepEqual(segments[1]?.tags, ['neutral'])
  })

  it('serializa y vuelve a parsear todos los tipos visibles', () => {
    const backgrounds = [
      { id: 'forest', tags: ['bosque'], description: '', mimeType: 'image/png', createdAt: 1 }
    ]
    const raw = [
      'Fondo [bosque]:',
      'Las hojas crujen.',
      'Alicia [feliz][sonrisa]: Hola.',
      'Vera: Avanzo.'
    ].join('\n')
    const parsed = parseSegments(raw, characters, backgrounds, 'Vera', images, 'round-trip')
    const serialized = serializeSegments(parsed, characters, 'Vera')

    assert.equal(serialized, raw)
    assert.deepEqual(
      parseSegments(serialized, characters, backgrounds, 'Vera', images, 'round-trip').map(
        ({ type, characterId, backgroundId, tag, tags, text }) => ({
          type,
          characterId,
          backgroundId,
          tag,
          tags,
          text
        })
      ),
      parsed.map(({ type, characterId, backgroundId, tag, tags, text }) => ({
        type,
        characterId,
        backgroundId,
        tag,
        tags,
        text
      }))
    )
  })

  it('resuelve y serializa directivas de sonido', () => {
    const sounds = [
      {
        id: 'bell',
        tags: ['campana', 'metal'],
        characterId: null,
        backgroundId: null,
        mimeType: 'audio/ogg',
        createdAt: 1
      }
    ]
    const parsed = parseSegments('Sonido [campana]:', characters, [], '', images, 'sound', sounds)

    assert.equal(parsed[0]?.type, 'sound')
    assert.equal(parsed[0]?.soundId, 'bell')
    assert.equal(serializeSegments(parsed, characters), 'Sonido [campana]:')
  })
})
