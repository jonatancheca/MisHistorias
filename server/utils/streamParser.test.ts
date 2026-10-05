import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import type { Character } from '../../shared/types/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jiti = createJiti(import.meta.url, {
  alias: {
    '~': resolve(root, 'app'),
    '#shared': resolve(root, 'shared')
  }
})
const { hideIncompleteVisualDirectivePrefix, parseSegments, serializeSegments } = await jiti.import<
  typeof import('../../app/lib/streamParser.ts')
>('../../app/lib/streamParser.ts')

const characters: Character[] = [
  {
    id: 'alicia',
    name: 'Alicia',
    prompt: '',
    tags: [],
    color: '#000000',
    imageGenerationPreset: '',
    imageGenerationLora: '',
    imageGenerationSeed: '',
    imageGenerationPromptPrefix: '',
    archived: false,
    visibleInDemo: false,
    createdAt: 1,
    updatedAt: 1
  }
]

const images = [
  {
    id: 'neutral',
    characterId: 'alicia',
    position: 0,
    tags: ['neutral'],
    isDefault: true,
    mimeType: 'image/png',
    createdAt: 1
  },
  {
    id: 'happy',
    characterId: 'alicia',
    position: 1,
    tags: ['feliz', 'sonrisa'],
    isDefault: false,
    mimeType: 'image/png',
    createdAt: 2
  }
]

describe('parser de etiquetas visuales', () => {
  it('oculta directivas visuales parciales sin ocultar narración', () => {
    assert.equal(
      hideIncompleteVisualDirectivePrefix(
        'Las hojas crujen.\nAlicia [feli',
        'Las hojas crujen.\nAlicia [feliz]: Hola.',
        characters
      ),
      'Las hojas crujen.\n'
    )
    assert.equal(
      hideIncompleteVisualDirectivePrefix('Fondo [bos', 'Fondo [bosque]:', characters),
      ''
    )
    assert.equal(
      hideIncompleteVisualDirectivePrefix('Sonido [cam', 'Sonido [campana]:', characters),
      ''
    )
    assert.equal(
      hideIncompleteVisualDirectivePrefix(
        'Alicia camina',
        'Alicia camina por el bosque.',
        characters
      ),
      'Alicia camina'
    )
    assert.equal(
      hideIncompleteVisualDirectivePrefix(
        'Alicia [feliz]:',
        'Alicia [feliz]: Hola.',
        characters
      ),
      'Alicia [feliz]:'
    )
  })

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

  it('usa coincidencia parcial y la imagen predeterminada sin coincidencias', () => {
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
    assert.equal(missing[0]?.imageId, 'neutral')
  })

  it('reconoce y conserva nombre personalizado de la historia', () => {
    const customized = [{ ...characters[0]!, name: 'Lia' }]
    const segments = parseSegments('Lia [feliz]: Hola.', customized, [], '', images, 'alias')

    assert.equal(segments[0]?.characterId, 'alicia')
    assert.equal(serializeSegments(segments, customized), 'Lia [feliz]: Hola.')
  })

  it('convierte cada línea narrativa en un cuadro independiente', () => {
    const raw = 'La puerta se abre.\nLa sala está a oscuras.\nAlicia [feliz]: Hola.'
    const segments = parseSegments(raw, characters, [], '', images, 'narration-frames')

    assert.deepEqual(segments.map((segment) => segment.type), [
      'narration', 'narration', 'dialogue'
    ])
    assert.deepEqual(segments.slice(0, 2).map((segment) => segment.text), [
      'La puerta se abre.', 'La sala está a oscuras.'
    ])
    assert.equal(serializeSegments(segments, characters), raw)
  })

  it('mantiene formato antiguo de una etiqueta y fondos sin cambios', () => {
    const segments = parseSegments(
      'Fondo [bosque]:\nAlicia [neutral]: Hola.',
      characters,
      [{ id: 'forest', tags: ['bosque'], description: '', mimeType: 'image/png', archived: false, visibleInDemo: false, createdAt: 1 }],
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
      { id: 'forest', tags: ['bosque'], description: '', mimeType: 'image/png', archived: false, visibleInDemo: false, createdAt: 1 }
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

describe('pensamientos explícitos del personaje', () => {
  it('conserva tipo, personaje, etiquetas e imagen al serializar y volver a leer', () => {
    const raw = 'Pensamiento Alicia [feliz][sonrisa]: No debo decirlo.\nPensamiento Vera: Debo esperar.'
    const segments = parseSegments(raw, characters, [], 'Vera', images, 'thought-1')
    assert.equal(segments[0]?.type, 'thought')
    assert.equal(segments[0]?.characterId, 'alicia')
    assert.deepEqual(segments[0]?.tags, ['feliz', 'sonrisa'])
    assert.equal(segments[0]?.imageId, 'happy')
    assert.equal(segments[1]?.type, 'protagonist-thought')
    assert.equal(segments[1]?.characterId, null)
    assert.equal(serializeSegments(segments, characters, 'Vera'), raw)
    assert.deepEqual(parseSegments(serializeSegments(segments, characters, 'Vera'), characters, [], 'Vera', images, 'thought-1'), segments)
  })

  it('no reinterpreta paréntesis ni pensamientos de nombres desconocidos', () => {
    const segments = parseSegments('(La puerta cruje.)\nAlicia: (Lo dije en voz alta.)\nPensamiento Extraño [feliz]: No reconocido.\npensamiento ALICIA: Sin etiqueta.', characters, [], '', images)
    assert.deepEqual(segments.map(segment => segment.type), ['narration', 'dialogue', 'narration', 'thought'])
    assert.equal(segments[2]?.text, 'Pensamiento Extraño [feliz]: No reconocido.')
    assert.equal(segments[3]?.imageId, 'neutral')
  })

  it('oculta todo el prefijo mientras se revela, también para el protagonista', () => {
    for (const raw of ['Pensamiento Alicia [feliz]: Secreto.', 'Pensamiento Vera: Espero.']) {
      for (let length = 1; length <= raw.indexOf(':'); length++) {
        assert.equal(hideIncompleteVisualDirectivePrefix(raw.slice(0, length), raw, characters, 'Vera'), '')
      }
      const body = raw.slice(0, raw.indexOf(':') + 2)
      assert.equal(hideIncompleteVisualDirectivePrefix(body, raw, characters, 'Vera'), body)
    }
  })
})

describe('nombres narrativos sin acentos', () => {
  it('reconoce diálogo, pensamientos y protagonista conservando nombre, etiquetas e imagen', () => {
    const cast = [{ ...characters[0]!, name: 'Júlia' }]
    const raw = ' JULIA [feliz]: Hola.\nPensamiento Julia [feliz]: Espero.\nAlex: Te sigo.\nPensamiento ALEX: Confío.'
    const segments = parseSegments(raw, cast, [], 'Álex', images)
    assert.deepEqual(segments.map(segment => segment.type), [
      'dialogue', 'thought', 'protagonist-dialogue', 'protagonist-thought'
    ])
    assert.equal(segments[0]?.characterId, 'alicia')
    assert.equal(segments[1]?.imageId, 'happy')
    assert.equal(serializeSegments(segments, cast, 'Álex'),
      'Júlia [feliz]: Hola.\nPensamiento Júlia [feliz]: Espero.\nÁlex: Te sigo.\nPensamiento Álex: Confío.')
    assert.equal(cast[0]?.name, 'Júlia')
  })

  it('ignora otros diacríticos y acepta Unicode descompuesto sin confundir ñ con n', () => {
    const cast = [
      { ...characters[0]!, name: 'Àçü' },
      { ...characters[0]!, id: 'nino', name: 'Niño' },
      { ...characters[0]!, id: 'julia', name: 'Júlia' }
    ]
    const segments = parseSegments('ACU: Hola.\nNino: Desconocido.\nNIÑO: Bien.\nNin\u0303o: También.\nJu\u0301lia: Aquí.', cast)
    assert.deepEqual(segments.map(segment => segment.characterId), ['alicia', null, 'nino', 'nino', 'julia'])
    assert.equal(segments[1]?.type, 'narration')
  })

  it('prioriza nombres exactos y mantiene narración ante alternativas ambiguas', () => {
    const cast = [
      { ...characters[0]!, id: 'julia', name: 'Julia' },
      { ...characters[0]!, id: 'accented-julia', name: 'Júlia' },
      { ...characters[0]!, id: 'jose-one', name: 'Jóse' },
      { ...characters[0]!, id: 'jose-two', name: 'José' }
    ]
    for (const ordered of [cast, [...cast].reverse()]) {
      const segments = parseSegments('JULIA: Una.\nJúlia: Otra.\nJose: Ambiguo.\nPensamiento Jose: Ambiguo también.', ordered)
      assert.deepEqual(segments.map(segment => segment.characterId), ['julia', 'accented-julia', null, null])
      assert.deepEqual(segments.slice(2).map(segment => segment.type), ['narration', 'narration'])
      assert.equal(segments[2]?.text, 'Jose: Ambiguo.')
    }
  })

  it('considera al protagonista en la prioridad exacta y en la ambigüedad', () => {
    const cast = [{ ...characters[0]!, name: 'Jóse' }]
    const segments = parseSegments('José: Protagonista.\nJóse: Elenco.\nJose: Ambiguo.', cast, [], 'José')
    assert.deepEqual(segments.map(segment => segment.type), ['protagonist-dialogue', 'dialogue', 'narration'])
    assert.equal(segments[1]?.characterId, 'alicia')
    assert.equal(parseSegments('Julia: Exacto.', [{ ...characters[0]!, name: 'Júlia' }], [], 'Julia')[0]?.type,
      'protagonist-dialogue')
    assert.equal(parseSegments('Júlia: Exacto.', [{ ...characters[0]!, name: 'Julia' }], [], 'Júlia')[0]?.type,
      'protagonist-dialogue')
    assert.equal(parseSegments('Alicia: Compartido.', characters, [], 'Alicia')[0]?.characterId, 'alicia')
  })

  it('oculta prefijos reconocidos durante el revelado y conserva los ambiguos', () => {
    const cast = [{ ...characters[0]!, name: 'Júlia' }]
    for (const raw of ['Julia [feliz]: Hola.', 'Pensamiento Julia: Espero.', 'Alex: Te sigo.', 'Pensamiento Alex: Confío.']) {
      for (let length = 1; length <= raw.indexOf(':'); length++) {
        assert.equal(hideIncompleteVisualDirectivePrefix(raw.slice(0, length), raw, cast, 'Álex'), '')
      }
    }
    const ambiguous = [{ ...characters[0]!, name: 'Jóse' }, { ...characters[0]!, id: 'other', name: 'José' }]
    assert.equal(hideIncompleteVisualDirectivePrefix('Jose', 'Jose: Hola.', ambiguous), 'Jose')
  })

  it('conserva distinción de espacios interiores y etiquetas de fondos, sonidos e imágenes', () => {
    const cast = [{ ...characters[0]!, name: 'María Sol' }]
    assert.equal(parseSegments('Maria  Sol: Desconocido.', cast)[0]?.type, 'narration')
    assert.equal(parseSegments(' maria sol : Bien.', cast)[0]?.characterId, 'alicia')
    const backgrounds = [{ id: 'cafe', tags: ['café'], description: '', mimeType: 'image/png',
      archived: false, visibleInDemo: false, createdAt: 1 }]
    const sounds = [{ id: 'bell', tags: ['música'], characterId: null, backgroundId: null,
      mimeType: 'audio/ogg', createdAt: 1 }]
    const taggedImages = [images[0]!, { ...images[1]!, tags: ['felíz'] }]
    const segments = parseSegments('Fondo [cafe]:\nFondo [café]:\nSonido [musica]:\nSonido [música]:\nMaria Sol [feliz]: Hola.',
      cast, backgrounds, '', taggedImages, '', sounds)
    assert.equal(segments[0]?.backgroundId, null)
    assert.equal(segments[1]?.backgroundId, 'cafe')
    assert.equal(segments[2]?.soundId, null)
    assert.equal(segments[3]?.soundId, 'bell')
    assert.equal(segments[4]?.imageId, 'neutral')
  })
})
