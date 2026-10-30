import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import type { Character, Message, Story } from '../../shared/types/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jiti = createJiti(import.meta.url, {
  alias: {
    '~': resolve(root, 'app'),
    '#shared': resolve(root, 'shared')
  }
})
const {
  buildChatContext,
  buildChatMessages,
  buildCompactionMessages,
  buildCompactionHistory,
  chatContextSize,
  buildHistory,
  buildSystemPrompt,
  resolveProtagonistPreferences
} = await jiti.import<
  typeof import('../../app/lib/promptBuilder.ts')
>('../../app/lib/promptBuilder.ts')

const character: Character = {
  id: 'character-1',
  name: 'Alicia',
  prompt: 'Prompt global',
  tags: ['global'],
  color: '#123456',
  imageGenerationPreset: '',
  imageGenerationLora: '',
  imageGenerationSeed: '',
  imageGenerationPromptPrefix: '',
  archived: false,
  visibleInDemo: false,
  createdAt: 1,
  updatedAt: 1
}

const story: Story = {
  id: 'story-1',
  title: 'Historia',
  premise: 'Premisa',
  visualMode: false,
  archived: false,
  visibleInDemo: false,
  protagonistPreferences: '',
  protagonistPreferencesMode: 'append',
  characterIds: [character.id],
  characterCustomizations: [
    {
      characterId: character.id,
      name: 'Lia',
      prompt: 'Prompt exclusivo de la historia',
      tags: ['misteriosa']
    }
  ],
  initialBackgroundId: null,
  presetId: null,
  createdAt: 1,
  updatedAt: 1
}

test('opciones de recursos filtran catálogos, formato, historial y caracteres en las cuatro combinaciones', async () => {
  const { DEFAULT_PRESET_CONTENT } = await jiti.import<typeof import('../../app/lib/defaultPreset.ts')>('../../app/lib/defaultPreset.ts')
  for (const useBackgrounds of [false, true]) {
    for (const useSounds of [false, true]) {
      const options: Parameters<typeof buildChatContext>[0] = {
        presetContent: DEFAULT_PRESET_CONTENT,
        story: { ...story, useBackgrounds, useSounds },
        characters: [character], images: [],
        backgrounds: [{ id: 'bg', tags: ['bosque-unico'], description: '', mimeType: 'image/png', archived: false, visibleInDemo: false, createdAt: 1 }],
        sounds: [
          { id: 'audio-bg', tags: ['ambiente-unico'], backgroundId: 'bg', characterId: null, mimeType: 'audio/ogg', createdAt: 1 },
          { id: 'audio-character', tags: ['pasos-unicos'], backgroundId: null, characterId: character.id, mimeType: 'audio/ogg', createdAt: 1 },
          { id: 'audio-free', tags: ['trueno-unico'], backgroundId: null, characterId: null, mimeType: 'audio/ogg', createdAt: 1 }
        ],
        messages: [{ id: 'old', storyId: story.id, role: 'assistant',
          raw: 'Fondo [bosque-unico]:\nSonido [ambiente-unico]:\nSonido [pasos-unicos]:\nSonido [trueno-unico]:\nLa noche sigue.',
          segments: [], createdAt: 1 }],
        historyBudget: 0, userName: 'Vera', protagonistPreferences: '', generationMode: 'normal'
      }
      const context = buildChatContext(options)
      const sent = context.messages.map(message => message.content).join('\n')
      assert.equal(context.breakdown.backgrounds > 0, useBackgrounds)
      assert.equal(context.breakdown.sounds > 0, useSounds)
      assert.equal(sent.includes('## FONDOS'), useBackgrounds)
      assert.equal(sent.includes('## SONIDOS'), useSounds)
      assert.equal(sent.includes('Fondo [etiqueta]:'), useBackgrounds)
      assert.equal(sent.includes('Sonido [etiqueta]:'), useSounds)
      assert.equal(sent.includes('Sonido [puerta]:'), useSounds)
      assert.equal(sent.includes('bosque-unico'), useBackgrounds)
      assert.equal(sent.includes('ambiente-unico'), useBackgrounds && useSounds)
      assert.equal(sent.includes('pasos-unicos'), useSounds)
      assert.equal(sent.includes('trueno-unico'), useSounds)
      assert.ok(sent.includes('La noche sigue.'))
      assert.equal(Object.values(context.breakdown).reduce((sum, count) => sum + count, 0), chatContextSize(context.messages))
      const expectedHistory = options.messages[0]!.raw.split('\n').filter(line =>
        (!line.startsWith('Fondo') || useBackgrounds) &&
        (!line.startsWith('Sonido') || (useSounds && (useBackgrounds || !line.includes('ambiente-unico'))))
      ).join('\n')
      assert.equal(context.breakdown.history, expectedHistory.length)
      assert.match(options.messages[0]!.raw, /Fondo \[bosque-unico\]/)

      const summarized = buildChatContext({ ...options, story: { ...options.story, contextSummary: 'Resumen narrativo sin directivas.', contextSummaryThroughMessageId: 'old' } })
      assert.equal(summarized.breakdown.backgrounds, context.breakdown.backgrounds)
      assert.equal(summarized.breakdown.sounds, context.breakdown.sounds)
      assert.equal(Object.values(summarized.breakdown).reduce((sum, count) => sum + count, 0), chatContextSize(summarized.messages))
    }
  }
})

test('compactación y serialización omiten directivas desactivadas sin reescribir originales, resumen ni texto libre', () => {
  const raw = 'Fondo [bosque]:\nSonido [lluvia]:\nLa lluvia suena en el bosque.'
  const message: Message = { id: 'old', storyId: story.id, role: 'assistant', raw, originalRaw: raw, segments: [
    { type: 'background', backgroundId: 'bg', characterId: null, tag: 'bosque', text: '' },
    { type: 'sound', soundId: 'audio', characterId: null, tag: 'lluvia', text: '' },
    { type: 'narration', characterId: null, tag: null, text: 'La lluvia suena en el bosque.' }
  ], createdAt: 1 }
  const resources = { ...story, useBackgrounds: false, useSounds: false }
  const history = buildHistory([message], [], 0, 'Vera', undefined, resources)
  assert.deepEqual(history, [{ role: 'assistant', content: 'La lluvia suena en el bosque.' }])
  const compact = buildCompactionMessages({ story: resources, messages: [message], characters: [], userName: 'Vera',
    previousSummary: 'Resumen con sonidos y fondos.', prompt: 'Prompt personalizado: Sonido [campana]:' })
  assert.ok(compact[0]!.content.startsWith('Prompt personalizado: Sonido [campana]:'))
  assert.equal(JSON.parse(compact[1]!.content).previousSummary, 'Resumen con sonidos y fondos.')
  assert.deepEqual(JSON.parse(compact[1]!.content).history, history)
  const context = buildChatMessages({ story: resources, presetContent: 'Personalizado: Sonido [campana]:',
    characters: [], images: [], backgrounds: [], sounds: [], messages: [message], historyBudget: 0,
    userName: 'Vera', protagonistPreferences: '', generationMode: 'normal' })
  assert.match(context[0]!.content, /Personalizado: Sonido \[campana\]:/)
  assert.equal(message.raw, raw)
  assert.equal(message.originalRaw, raw)
  assert.equal(message.segments.length, 3)
})

test('desglosa exactamente el contexto enviado, incluidos encabezados, instrucciones y separadores', () => {
  const options: Parameters<typeof buildChatContext>[0] = {
    presetContent: '  Narra sin cambiar el formato.  ',
    story: { ...story, premise: 'Inicio.\n## SONIDOS\nTexto del planteamiento.', characterCustomizations: [] },
    characters: [{ ...character, prompt: 'Descripción.\n## FONDOS\nTexto del personaje.' }],
    images: [{ id: 'image-1', characterId: character.id, position: 0, tags: ['neutral', 'abrigo'],
      isDefault: true, mimeType: 'image/png', createdAt: 1 }],
    backgrounds: [{ id: 'background-1', tags: ['bosque'], description: 'No se envía la imagen.',
      mimeType: 'image/png', archived: false, visibleInDemo: false, createdAt: 1 }],
    sounds: [{ id: 'sound-1', tags: ['lluvia'], characterId: character.id, backgroundId: null,
      mimeType: 'audio/ogg', createdAt: 1 }],
    messages: [
      { id: 'old-instruction', storyId: story.id, role: 'user', raw: 'IA: Instrucción consumida.', segments: [], createdAt: 1 },
      { id: 'old', storyId: story.id, role: 'assistant', raw: 'Historia anterior. 🌳', segments: [], createdAt: 2 },
      { id: 'pending', storyId: story.id, role: 'user', raw: '  Intervención pendiente.  ', segments: [], createdAt: 3 },
      { id: 'instruction', storyId: story.id, role: 'user', raw: 'IA: Cambia el tono.', segments: [], createdAt: 4 }
    ],
    historyBudget: 0, userName: 'Vera', protagonistPreferences: '  Curiosa.  ', generationMode: 'normal'
  }
  const initial = buildChatContext(options)
  assert.deepEqual(initial.messages, buildChatMessages(options))
  assert.deepEqual(Object.keys(initial.breakdown).sort(),
    ['instructions', 'protagonist', 'characters', 'backgrounds', 'sounds', 'premise', 'summary', 'history'].sort())
  assert.equal(initial.breakdown.premise, `## PLANTEAMIENTO DE LA HISTORIA\n${options.story.premise}`.length)
  assert.equal(initial.breakdown.summary, 0)
  assert.equal(initial.breakdown.history, [
    'Historia anterior. 🌳', 'Vera:   Intervención pendiente.  ', 'Instrucción del usuario para la IA:\nCambia el tono.'
  ].reduce((total, text) => total + text.length, 0))
  assert.doesNotMatch(JSON.stringify(initial.messages), /Instrucción consumida/)

  for (const generationMode of ['normal', 'continue', 'auto'] as const) {
    for (const summarized of [false, true]) {
      for (const absent of [false, true]) {
        const context = buildChatContext({
          ...options, generationMode, presetContent: '',
          story: { ...options.story, autoGenerateImages: true, dialogueStyle: 'few', narrationStyle: 'many',
            absentCharacterIds: absent ? [character.id] : [],
            contextSummary: summarized ? '  Resumen.\n## PERSONAJES\nContenido narrativo.  ' : undefined,
            contextSummaryThroughMessageId: summarized ? 'old' : undefined },
          imageCatalogChange: '  Nuevas etiquetas disponibles.  ',
          pendingImageInstructions: [{ characterId: character.id, imageId: 'image-1', tags: ['abrigo'] }]
        })
        assert.equal(Object.values(context.breakdown).reduce((total, count) => total + count, 0), chatContextSize(context.messages))
        assert.ok(Object.values(context.breakdown).every(count => Number.isInteger(count) && count >= 0))
        assert.equal(context.breakdown.premise === 0, summarized)
        assert.equal(context.breakdown.summary, summarized
          ? 'Resumen del historial anterior:\nResumen.\n## PERSONAJES\nContenido narrativo.'.length : 0)
        assert.equal(context.breakdown.history, initial.breakdown.history - (summarized ? 'Historia anterior. 🌳'.length : 0))
      }
    }
  }

  const changed = buildChatContext({ ...options, characters: [{ ...options.characters[0]!, prompt: `${options.characters[0]!.prompt} Detalle extra.` }] })
  assert.equal(changed.breakdown.characters - initial.breakdown.characters, ' Detalle extra.'.length)
  assert.equal(chatContextSize(changed.messages) - chatContextSize(initial.messages), ' Detalle extra.'.length)
  for (const section of ['instructions', 'protagonist', 'backgrounds', 'sounds', 'premise', 'summary', 'history'] as const) {
    assert.equal(changed.breakdown[section], initial.breakdown[section])
  }
})

test('desglosa apertura sin historial y no añade metadatos al payload del narrador', () => {
  const context = buildChatContext({
    presetContent: '', story, characters: [], images: [], backgrounds: [], sounds: [],
    messages: [], historyBudget: 0, userName: 'Vera', protagonistPreferences: '', generationMode: 'normal'
  })
  assert.equal(context.breakdown.history, 0)
  assert.equal(context.breakdown.summary, 0)
  assert.equal(Object.values(context.breakdown).reduce((total, count) => total + count, 0), chatContextSize(context.messages))
  assert.ok(context.messages.some(message => message.content.startsWith('Comienza la historia')))
  for (const message of context.messages) assert.deepEqual(Object.keys(message).sort(), ['content', 'role'])
})

test('estilo de respuesta orienta cuadros por tipo y omite opciones sin indicar', () => {
  const options = {
    presetContent: 'Narra.',
    characters: [character],
    images: [],
    backgrounds: [],
    sounds: [],
    userName: 'Usuario',
    protagonistPreferences: '',
    generationMode: 'normal' as const
  }
  const defaultPrompt = buildSystemPrompt({ ...options, story })
  assert.doesNotMatch(defaultPrompt, /ESTILO DE RESPUESTA DE ESTA HISTORIA/)

  const shortPrompt = buildSystemPrompt({
    ...options,
    story: { ...story, dialogueStyle: 'few', narrationStyle: 'few' }
  })
  assert.match(shortPrompt, /1 o 2 intervenciones de diálogo en total/)
  assert.match(shortPrompt, /1 o 2 líneas independientes de narración en total/)
  assert.match(shortPrompt, /Puedes omitir el diálogo o la narración/)

  const longPrompt = buildSystemPrompt({
    ...options,
    story: { ...story, dialogueStyle: 'many', narrationStyle: 'many' }
  })
  assert.match(longPrompt, /3 o más intervenciones de diálogo en total/)
  assert.match(longPrompt, /mucha narración repartida en varias líneas independientes/)
  assert.doesNotMatch(longPrompt, /3 o más.*narración/)

  const instruction = buildChatMessages({
    ...options,
    story: { ...story, dialogueStyle: 'few' },
    messages: [{ id: 'instruction', storyId: story.id, role: 'user',
      raw: 'IA: Extiende este diálogo.', segments: [], createdAt: 1 }],
    historyBudget: 0
  })[0]!.content
  assert.ok(instruction.indexOf('1 o 2 intervenciones') < instruction.indexOf('Extiende este diálogo.'))
})

test('excluye diagnósticos de historial y compactación sin consumir instrucciones pendientes', () => {
  const instruction: Message = { id: 'instruction', storyId: story.id, role: 'user',
    raw: 'IA: Cambia el tono.', segments: [], createdAt: 1 }
  const failure: Message = { id: 'failure', storyId: story.id, role: 'assistant',
    raw: 'DIAGNOSTICO_SECRETO_PARA_EL_LLM', segments: [], createdAt: 2,
    swarmError: { characterId: character.id, characterName: 'Lia', tags: [], call: {
      target: 'swarm', operation: '/API/GenerateText2Image', request: { model: 'model-a' },
      requestSent: true, response: { status: 502, body: 'Backend failed' }, message: 'Backend failed'
    } } }
  const messages = [instruction, failure]
  assert.deepEqual(buildHistory(messages, [character], 0, 'Protagonista'), buildHistory([instruction], [character], 0, 'Protagonista'))
  assert.deepEqual(buildCompactionMessages({ messages, characters: [character], userName: 'Protagonista' }),
    buildCompactionMessages({ messages: [instruction], characters: [character], userName: 'Protagonista' }))
})

test('usa prompt y etiquetas descriptivas de la historia sin cambiar etiquetas visuales', () => {
  const legacyImage = {
    id: 'image-1',
    characterId: 'character-1',
    position: 0,
    tags: ['feliz', 'armadura'],
    description: 'DESCRIPCIÓN LEGACY NO ENVIADA',
    isDefault: true,
    mimeType: 'image/png',
    createdAt: 1,
    blob: new Blob()
  }
  const prompt = buildSystemPrompt({
    presetContent: 'Narra.',
    story,
    characters: [{ ...character, prompt: 'Prompt global que no debe aparecer' }],
    images: [legacyImage],
    backgrounds: [],
    sounds: [
      {
        id: 'sound-1',
        tags: ['campana'],
        characterId: character.id,
        backgroundId: null,
        mimeType: 'audio/ogg',
        createdAt: 1
      },
      {
        id: 'sound-2',
        tags: ['lluvia'],
        isBackground: true,
        characterId: null,
        backgroundId: null,
        mimeType: 'audio/ogg',
        createdAt: 2
      }
    ],
    userName: 'Usuario',
    protagonistPreferences: '',
    generationMode: 'normal'
  })

  assert.match(prompt, /Prompt exclusivo de la historia/)
  assert.match(prompt, /### Lia/)
  assert.doesNotMatch(prompt, /Prompt global que no debe aparecer/)
  assert.match(prompt, /Etiquetas descriptivas[^\n]*misteriosa/)
  assert.doesNotMatch(prompt, /Etiquetas descriptivas[^\n]*global/)
  assert.match(prompt, /\[feliz\]/)
  assert.match(prompt, /\[feliz\] \[armadura\]/)
  assert.doesNotMatch(prompt, /\[feliz\] \/ \[armadura\]/)
  assert.doesNotMatch(prompt, /DESCRIPCIÓN LEGACY NO ENVIADA/)
  assert.match(prompt, /Sonido \[etiqueta\]:/)
  assert.match(prompt, /\[campana\] \(personaje Alicia; efecto de sonido\)/)
  assert.match(prompt, /\[lluvia\] \(suelto; sonido de fondo\)/)
})

test('envía combinaciones de etiquetas únicas por personaje y fondo, sin descripciones de imágenes', () => {
  const image = {
    id: 'image', characterId: character.id, position: 0, tags: ['criada'], isDefault: true,
    description: 'DESCRIPCIÓN DE IMAGEN LEGACY', mimeType: 'image/png', createdAt: 1, blob: new Blob()
  }
  const background = {
    id: 'background', tags: ['bosque', 'noche'], description: 'DESCRIPCIÓN DEL FONDO',
    mimeType: 'image/png', archived: false, visibleInDemo: false, createdAt: 1, blob: new Blob()
  }
  const payload = buildChatMessages({
    presetContent: 'Narra.', story: { ...story, initialBackgroundId: background.id },
    characters: [character, { ...character, id: 'second', name: 'Segunda' }],
    images: [
      image,
      { ...image, id: 'duplicate', isDefault: false },
      { ...image, id: 'working', tags: ['criada', 'trabajando'], isDefault: false },
      { ...image, id: 'reordered', tags: ['TRABAJANDO', 'criada'], isDefault: false },
      { ...image, id: 'crying', tags: ['llorando'], isDefault: false },
      { ...image, id: 'other-character', characterId: 'second' }
    ],
    backgrounds: [background, { ...background, id: 'duplicate-background', tags: ['noche', 'bosque'] }],
    sounds: [], messages: [], historyBudget: 0, userName: 'Usuario',
    protagonistPreferences: '', generationMode: 'normal'
  })
  const prompt = payload[0]!.content
  assert.match(prompt, /Etiquetas de imagen disponibles:\n {2}- \[criada\]\n {2}- \[criada\] \[trabajando\]\n {2}- \[llorando\]\nEtiqueta por defecto: \[criada\]/)
  assert.equal(prompt.match(/^ {2}- \[criada\]$/gm)?.length, 2)
  assert.equal(prompt.match(/^- \[bosque\] \[noche\]$/gm)?.length, 1)
  assert.match(prompt, /Fondo inicial: \[bosque\]/)
  assert.match(prompt, /Prompt exclusivo de la historia/)
  assert.doesNotMatch(prompt, /DESCRIPCIÓN DE IMAGEN LEGACY|DESCRIPCIÓN DEL FONDO|sin descripción|por defecto\)/)
})

test('activa directivas de imágenes y conserva el prefijo inmutable', () => {
  const prompt = buildSystemPrompt({
    presetContent: 'No inventes etiquetas de imagen.',
    story: { ...story, autoGenerateImages: true },
    characters: [{ ...character, imageGenerationPromptPrefix: 'quality, red hair' }],
    images: [],
    backgrounds: [],
    sounds: [],
    userName: 'Vera',
    protagonistPreferences: '',
    generationMode: 'normal'
  })

  assert.match(prompt, /Imagen Nombre \[etiqueta\]: prompt en inglés/)
  assert.match(prompt, /solo puede describir postura, ropa, expresión y escena/)
  assert.match(prompt, /quality, red hair/)
  assert.match(prompt, /como máximo una línea independiente/)
  assert.match(prompt, /para las líneas normales; para una imagen nueva utiliza la directiva Imagen indicada/)
})

test('combina o reemplaza preferencias del protagonista', () => {
  assert.equal(resolveProtagonistPreferences(' Global ', ' Historia ', 'append'), 'Global\nHistoria')
  assert.equal(resolveProtagonistPreferences('Global', 'Historia', 'replace'), 'Historia')
  assert.equal(resolveProtagonistPreferences('', 'Historia', 'append'), 'Historia')
})

test('recorta historial conservando mensajes recientes y serializa segmentos', () => {
  const messages: Message[] = [
    {
      id: 'user-old',
      storyId: story.id,
      role: 'user',
      raw: 'Mensaje antiguo que no cabe',
      segments: [],
      createdAt: 1
    },
    {
      id: 'assistant',
      storyId: story.id,
      role: 'assistant',
      raw: '',
      segments: [
        {
          type: 'dialogue',
          characterId: character.id,
          tag: 'feliz',
          tags: ['feliz', 'armadura'],
          text: 'Respuesta reciente.'
        }
      ],
      createdAt: 2
    },
    {
      id: 'user-new',
      storyId: story.id,
      role: 'user',
      raw: 'Sigo adelante.',
      segments: [],
      createdAt: 3
    }
  ]

  const history = buildHistory(messages, [character], 80, 'Vera')
  assert.deepEqual(history, [
    { role: 'assistant', content: 'Alicia [feliz][armadura]: Respuesta reciente.' },
    { role: 'user', content: 'Vera: Sigo adelante.' }
  ])

  assert.equal(buildHistory(messages, [character], 0, 'Vera').length, messages.length)
})

test('envía último resumen y solo mensajes posteriores', () => {
  const messages: Message[] = [
    {
      id: 'user-old',
      storyId: story.id,
      role: 'user',
      raw: 'Mensaje ya resumido.',
      segments: [],
      createdAt: 1
    },
    {
      id: 'assistant-old',
      storyId: story.id,
      role: 'assistant',
      raw: 'Respuesta ya resumida.',
      segments: [],
      createdAt: 2
    },
    {
      id: 'user-new',
      storyId: story.id,
      role: 'user',
      raw: 'Mensaje posterior.',
      segments: [],
      createdAt: 3
    }
  ]
  const payload = buildChatMessages({
    presetContent: 'Narra.',
    story: {
      ...story,
      contextSummary: 'Alicia abrió la puerta.',
      contextSummaryThroughMessageId: 'assistant-old'
    },
    characters: [character],
    images: [],
    backgrounds: [],
    sounds: [],
    messages,
    historyBudget: 1000,
    userName: 'Vera',
    protagonistPreferences: '',
    generationMode: 'normal'
  })

  assert.match(payload[0]?.content ?? '', /Resumen del historial anterior:\nAlicia abrió/)
  assert.doesNotMatch(JSON.stringify(payload), /PLANTEAMIENTO DE LA HISTORIA|Premisa/)
  assert.doesNotMatch(JSON.stringify(payload), /Mensaje ya resumido/)
  assert.doesNotMatch(JSON.stringify(payload), /Respuesta ya resumida/)
  assert.match(JSON.stringify(payload), /Mensaje posterior/)
  assert.doesNotMatch(JSON.stringify(payload), /Comienza la historia/)
})

test('prepara compactación integrando resumen anterior y diálogo posterior', () => {
  const messages: Message[] = [
    {
      id: 'assistant-old',
      storyId: story.id,
      role: 'assistant',
      raw: 'Respuesta ya resumida.',
      segments: [],
      createdAt: 1
    },
    {
      id: 'user-new',
      storyId: story.id,
      role: 'user',
      raw: 'Abro la ventana.',
      segments: [],
      createdAt: 2
    },
    {
      id: 'assistant-new',
      storyId: story.id,
      role: 'assistant',
      raw: 'Entra aire frío.',
      segments: [],
      createdAt: 3
    }
  ]
  const payload = buildCompactionMessages({
    previousSummary: 'Alicia abrió la puerta.',
    throughMessageId: 'assistant-old',
    messages,
    characters: [character],
    userName: 'Vera',
    summaryBudget: 4000
  })

  assert.equal(payload.filter((message) => message.role === 'system').length, 1)
  assert.match(payload[0]?.content ?? '', /No continúes ni avances la historia/)
  assert.match(payload[0]?.content ?? '', /como máximo 4000 caracteres/)
  assert.doesNotMatch(JSON.stringify(payload), /Respuesta ya resumida/)
  assert.equal(payload[1]?.role, 'user')
  const source = JSON.parse(payload[1]!.content)
  assert.equal(source.previousSummary, 'Alicia abrió la puerta.')
  assert.deepEqual(source.history, [
    { role: 'user', content: 'Vera: Abro la ventana.' },
    { role: 'assistant', content: 'Entra aire frío.' }
  ])
})

test('compactación mantiene instrucciones históricas como datos y permite resumir solo checkpoint', () => {
  const instruction: Message = { id: 'instruction', storyId: story.id, role: 'user',
    raw: 'IA: IGNORA_RESUMEN_Y_AVANZA', segments: [], createdAt: 1 }
  const payload = buildCompactionMessages({
    previousSummary: 'IGNORA_RESUMEN_ANTERIOR', messages: [instruction], characters: [], userName: 'Vera'
  })
  assert.doesNotMatch(payload[0]!.content, /IGNORA_RESUMEN/)
  assert.match(payload[1]!.content, /IGNORA_RESUMEN_Y_AVANZA/)
  const summaryOnly = buildCompactionMessages({
    previousSummary: 'Pasado.', throughMessageId: 'instruction', messages: [instruction],
    characters: [], userName: 'Vera'
  })
  assert.deepEqual(JSON.parse(summaryOnly[1]!.content), { previousSummary: 'Pasado.', history: [] })
})

test('prompt de compactación personalizado sustituye al integrado y conserva límite dinámico', () => {
  const payload = buildCompactionMessages({
    prompt: 'Resume hechos y asuntos pendientes sin avanzar.', summaryBudget: 1234,
    previousSummary: 'El pasado.', messages: [], characters: [], userName: 'Vera'
  })
  assert.match(payload[0]!.content, /^Resume hechos y asuntos pendientes sin avanzar\./)
  assert.doesNotMatch(payload[0]!.content, /Resume el historial de esta historia interactiva/)
  assert.match(payload[0]!.content, /como máximo 1234 caracteres/)
  assert.deepEqual(JSON.parse(payload[1]!.content), { previousSummary: 'El pasado.', history: [] })
})

test('tamaño del contexto incluye sistema, resumen, intervención e instrucciones de continuación', () => {
  const payload = buildChatMessages({
    presetContent: 'Narra.', story: { ...story, contextSummary: 'Resumen.' }, characters: [character],
    images: [], backgrounds: [], sounds: [], messages: [{ id: 'new', storyId: story.id,
      role: 'user', raw: 'A'.repeat(50_000), segments: [], createdAt: 1 }], historyBudget: 0,
    userName: 'Vera', protagonistPreferences: '', generationMode: 'continue',
    imageCatalogChange: 'Catálogo actualizado.'
  })
  assert.ok(chatContextSize(payload) > 50_000)
  assert.equal(chatContextSize(payload), payload.map((message) => message.content).join('').length)
  assert.ok(payload.some((message) => message.content === `Vera: ${'A'.repeat(50_000)}`))
})

test('añade apertura, actualización de catálogo y reglas distintas para Sigue y Auto', () => {
  const common = {
    presetContent: 'Narra.',
    story,
    characters: [character],
    images: [],
    backgrounds: [],
    sounds: [],
    messages: [],
    historyBudget: 1000,
    userName: 'Vera',
    protagonistPreferences: '',
    imageCatalogChange: 'Catálogo actualizado.'
  }
  const continued = buildChatMessages({ ...common, generationMode: 'continue' })
  const automatic = buildChatMessages({ ...common, generationMode: 'auto' })

  const opening = continued.find((message) => message.role === 'user')
  assert.match(opening?.content ?? '', /Comienza la historia/)
  assert.match(continued[0]?.content ?? '', /Catálogo actualizado\./)
  assert.ok(continued.some((message) => /No inventes acciones/.test(message.content)))
  assert.ok(automatic.some((message) => /Puedes inventar acciones/.test(message.content)))
  assert.match(automatic[0]?.content ?? '', /Puedes hablar y decidir por el protagonista/)
})

for (const generationMode of ['normal', 'continue', 'auto'] as const) {
  test(`envía preferencias visuales como intercambio temporal en modo ${generationMode}`, () => {
    const history: Message[] = [
      { id: 'previous', storyId: story.id, role: 'assistant', raw: 'La escena continúa.', segments: [], createdAt: 1 },
      { id: 'latest', storyId: story.id, role: 'user', raw: 'Sigo adelante.', segments: [], createdAt: 2 }
    ]
    const common = {
      presetContent: 'Narra.',
      story,
      characters: [{ ...character, name: 'Lia' }],
      images: [],
      backgrounds: [],
      sounds: [],
      messages: history,
      historyBudget: 1000,
      userName: 'Vera',
      protagonistPreferences: '',
      generationMode
    }
    const baseline = buildChatMessages(common)
    const messages = buildChatMessages({
      ...common,
      pendingImageInstructions: [{
        characterId: character.id,
        imageId: 'image-2',
        tags: ['seria', 'armadura']
      }]
    })

    const instruction = messages.at(-1)!
    assert.equal(instruction.role, 'user')
    assert.match(instruction.content, /INDICACIÓN VISUAL PARA ESTA RESPUESTA/)
    assert.match(instruction.content, /Lia: \[seria\]\[armadura\]/)
    assert.match(instruction.content, /prefiero estas etiquetas visuales/)
    assert.match(instruction.content, /salvo que la historia requiera cambiar su aspecto o ropa/)
    assert.match(instruction.content, /solo se aplica a este intercambio; no es una instrucción permanente/)
    assert.deepEqual(messages.slice(0, -1), baseline)
    assert.equal(messages.at(-2)?.content, 'Vera: Sigo adelante.')
    assert.doesNotMatch(messages[0]!.content, /INDICACIÓN VISUAL/)
    assert.deepEqual(buildChatMessages({ ...common, pendingImageInstructions: [] }), baseline)
    assert.deepEqual(buildChatMessages({
      ...common,
      pendingImageInstructions: [
        { characterId: 'missing', imageId: 'image-3', tags: ['seria'] },
        { characterId: character.id, imageId: 'image-4', tags: [] }
      ]
    }), baseline)
  })
}

test('combina todos los mensajes system para Qwen sin perder catálogo ni orden', () => {
  const messages = buildChatMessages({
    presetContent: 'Narra.',
    story,
    characters: [character],
    images: [{
      id: 'image-1',
      characterId: character.id,
      position: 0,
      tags: ['feliz', 'armadura'],
      isDefault: true,
      mimeType: 'image/png',
      createdAt: 1
    }],
    backgrounds: [],
    sounds: [{
      id: 'sound-1',
      tags: ['campana'],
      characterId: character.id,
      backgroundId: null,
      mimeType: 'audio/ogg',
      createdAt: 1
    }],
    messages: [
      {
        id: 'assistant-1',
        storyId: story.id,
        role: 'assistant',
        raw: 'La puerta se abre.',
        segments: [],
        createdAt: 1
      },
      {
        id: 'instruction-1',
        storyId: story.id,
        role: 'user',
        raw: 'IA: Habla en susurros.',
        segments: [],
        createdAt: 2
      },
      {
        id: 'user-1',
        storyId: story.id,
        role: 'user',
        raw: 'Entra en la sala.',
        segments: [],
        createdAt: 3
      }
    ],
    historyBudget: 1000,
    userName: 'Vera',
    protagonistPreferences: '',
    generationMode: 'continue',
    imageCatalogChange: 'Catálogo actualizado.',
    pendingImageInstructions: [{
      characterId: character.id,
      imageId: 'image-2',
      tags: ['seria']
    }]
  })

  assert.equal(messages.filter((message) => message.role === 'system').length, 1)
  const systemContent = messages[0]?.content ?? ''
  assert.match(systemContent, /### Lia/)
  assert.match(systemContent, /Prompt exclusivo de la historia/)
  assert.match(systemContent, /Etiquetas descriptivas[^\n]*misteriosa/)
  assert.match(systemContent, /\[feliz\] \[armadura\]/)
  assert.match(systemContent, /\[campana\] \(personaje Alicia; efecto de sonido\)/)

  const instructionIndex = systemContent.indexOf('Habla en susurros.')
  const catalogIndex = systemContent.indexOf('Catálogo actualizado.')
  const continuationIndex = systemContent.indexOf('Continúa la historia')
  const reminderIndex = systemContent.indexOf('Responde directamente')
  assert.ok(instructionIndex > 0)
  assert.ok(instructionIndex < catalogIndex)
  assert.ok(catalogIndex < continuationIndex)
  assert.ok(continuationIndex < reminderIndex)
  assert.doesNotMatch(systemContent, /INDICACIÓN VISUAL/)
  assert.deepEqual(messages.slice(1, -1), [
    { role: 'assistant', content: 'La puerta se abre.' },
    { role: 'user', content: 'Vera: Entra en la sala.' }
  ])
  assert.equal(messages.at(-1)?.role, 'user')
  assert.match(messages.at(-1)?.content ?? '', /Alicia: \[seria\]/)
})

test('mantiene instrucciones IA y Narrador solo hasta una respuesta válida', () => {
  const instruction = {
    id: 'instruction-1',
    storyId: 'story-1',
    role: 'user' as const,
    raw: 'Narrador: Haz que todos hablen en susurros.',
    segments: [],
    createdAt: 1
  }
  const response = {
    id: 'assistant-1',
    storyId: 'story-1',
    role: 'assistant' as const,
    raw: 'La escena continúa.',
    segments: [],
    createdAt: 2
  }
  const action = {
    id: 'user-1',
    storyId: 'story-1',
    role: 'user' as const,
    raw: 'Entra en la sala.',
    segments: [],
    createdAt: 3
  }

  const pending = buildHistory([instruction, action], [], 1000, 'Usuario')
  assert.deepEqual(pending, [
    { role: 'system', content: 'Instrucción del usuario para la IA:\nHaz que todos hablen en susurros.' },
    { role: 'user', content: 'Usuario: Entra en la sala.' }
  ])

  const consumed = buildHistory([instruction, response, action], [], 1000, 'Usuario')
  assert.deepEqual(consumed, [
    { role: 'assistant', content: 'La escena continúa.' },
    { role: 'user', content: 'Usuario: Entra en la sala.' }
  ])

  const regenerated = buildHistory([instruction], [], 1000, 'Usuario')
  assert.deepEqual(regenerated, [
    { role: 'system', content: 'Instrucción del usuario para la IA:\nHaz que todos hablen en susurros.' }
  ])

  const aiPending = buildHistory([{ ...instruction, raw: 'IA: Responde brevemente.' }], [], 1000, 'Usuario')
  assert.deepEqual(aiPending, [
    { role: 'system', content: 'Instrucción del usuario para la IA:\nResponde brevemente.' }
  ])
})

test('instruye pensamientos con un preset personalizado y protege al protagonista fuera de Auto', () => {
  const options = {
    presetContent: 'Mi preset personalizado.', story, characters: [character], images: [],
    backgrounds: [], sounds: [], messages: [], historyBudget: 0, userName: 'Vera', protagonistPreferences: ''
  }
  for (const generationMode of ['normal', 'continue', 'auto'] as const) {
    const prompt = buildChatMessages({ ...options, generationMode })[0]!.content
    assert.match(prompt, /Pensamiento Nombre \[etiqueta\]\[otra etiqueta\]: texto/)
    assert.match(prompt, /Los demás personajes no lo oyen/)
    assert.match(prompt, /sin exigir uno en cada respuesta/)
    if (generationMode === 'auto') {
      assert.match(prompt, /Pensamiento Vera: texto/)
      assert.doesNotMatch(prompt, /No inventes sus pensamientos/)
    } else assert.match(prompt, /No inventes sus pensamientos/)
    if (generationMode === 'continue') assert.match(prompt, /No inventes acciones, decisiones, diálogo ni pensamientos/)
  }
})

test('historial y compactación distinguen pensamientos del diálogo', () => {
  const messages: Message[] = [{
    id: 'thought-message', storyId: story.id, role: 'assistant', raw: 'Original.', createdAt: 1,
    segments: [
      { type: 'thought', characterId: character.id, tag: 'feliz', tags: ['feliz', 'capa'], text: 'No lo saben.' },
      { type: 'protagonist-thought', characterId: null, tag: null, text: 'Debo esperar.' }
    ]
  }]
  const content = 'Pensamiento Alicia [feliz][capa]: No lo saben.\nPensamiento Vera: Debo esperar.'
  assert.equal(buildHistory(messages, [character], 0, 'Vera')[0]?.content, content)
  const compacted = buildCompactionMessages({ messages, characters: [character], userName: 'Vera' })
  assert.equal(JSON.parse(compacted[1]!.content).history[0].content, content)
})

test('ausentes conservan descripción y omiten imágenes, prefijo de generación, sonidos e indicaciones pendientes', () => {
  const options = {
    presetContent: 'Narra.', story: { ...story, absentCharacterIds: [character.id], autoGenerateImages: true },
    characters: [character],
    images: [{ id: 'hidden-image', position: 0, characterId: character.id, tags: ['etiqueta-secreta'], isDefault: true, mimeType: 'image/png', createdAt: 1 }],
    backgrounds: [],
    sounds: [{ id: 'hidden-sound', characterId: character.id, backgroundId: null, tags: ['sonido-secreto'], mimeType: 'audio/ogg', createdAt: 1 }],
    userName: 'Vera', protagonistPreferences: '', generationMode: 'normal' as const
  }
  const system = buildSystemPrompt(options)
  assert.match(system, /Prompt exclusivo de la historia/)
  assert.match(system, /misteriosa/)
  assert.match(system, /AUSENTE de la escena/)
  assert.match(system, /Lia no debe hablar, dialogar, pensar ni actuar en esta respuesta/)
  assert.match(system, /No escribas líneas de diálogo de Lia ni líneas de Pensamiento Lia/)
  assert.match(system, /aunque hablase en el historial o en el resumen/)
  assert.match(system, /El protagonista está siempre presente/)
  assert.doesNotMatch(system, /etiqueta-secreta|sonido-secreto|Etiqueta por defecto/)
  const chat = buildChatMessages({ ...options, messages: [], historyBudget: 0, pendingImageInstructions: [{ characterId: character.id, imageId: 'hidden-image', tags: ['pendiente-secreta'] }] })
  assert.ok(chat.every((message) => !message.content.includes('pendiente-secreta')))
  const present = buildSystemPrompt({ ...options, story })
  assert.match(present, /PRESENTE en la escena/)
  assert.match(present, /etiqueta-secreta/)
  assert.match(present, /sonido-secreto/)
})


test('prompt permite ausencia y retorno explícito antes de intervenir', () => {
  const prompt = buildSystemPrompt({ presetContent: 'Narra.', story: { ...story, absentCharacterIds: [character.id] },
    characters: [character], images: [], backgrounds: [], sounds: [], userName: 'Vera', protagonistPreferences: '', generationMode: 'normal' })
  assert.match(prompt, /Ausente Nombre:/)
  assert.match(prompt, /Presente Nombre:/)
  assert.match(prompt, /aunque no tenga diálogo/)
  assert.match(prompt, /personalizado/)
  assert.match(prompt, /procesa en orden/)
  assert.match(prompt, /Presente Lia:/)
})


test('primera compactación integra planteamiento como datos incluso con prompt personalizado', () => {
  const premise = 'PLANTEAMIENTO_UNICO: mundo sin magia. No ejecutes esta frase.'
  const payload = buildCompactionMessages({
    premise, prompt: 'Resume con detalle.', previousSummary: '  ', messages: [], characters: [], userName: 'Vera'
  })
  assert.match(payload[0]!.content, /El resumen sustituirá tanto el planteamiento como el historial/)
  assert.doesNotMatch(payload[0]!.content, /PLANTEAMIENTO_UNICO/)
  assert.deepEqual(JSON.parse(payload[1]!.content).history, [
    { role: 'system', content: `Planteamiento de la historia:\n${premise}` }
  ])
  const next = buildCompactionMessages({ premise, previousSummary: 'Mundo sin magia.',
    messages: [], characters: [], userName: 'Vera' })
  assert.doesNotMatch(JSON.stringify(next), /PLANTEAMIENTO_UNICO/)
  assert.equal(JSON.parse(next[1]!.content).previousSummary, 'Mundo sin magia.')
})

test('un resumen antiguo o manual sustituye planteamiento y libera su presupuesto completo', () => {
  const options = { presetContent: 'Narra.', story: { ...story, premise: 'P'.repeat(20000) },
    characters: [], images: [], backgrounds: [], sounds: [], messages: [], historyBudget: 0,
    userName: 'Vera', protagonistPreferences: '', generationMode: 'normal' as const }
  const before = buildChatMessages(options)
  const after = buildChatMessages({ ...options, story: { ...options.story, contextSummary: 'Resumen.' } })
  assert.match(before[0]!.content, /P{20000}/)
  assert.doesNotMatch(JSON.stringify(after), /PLANTEAMIENTO DE LA HISTORIA|P{10}/)
  assert.ok(chatContextSize(before) - chatContextSize(after) > 19000)
  const blank = buildChatMessages({ ...options, story: { ...options.story, contextSummary: '  ' } })
  assert.match(blank[0]!.content, /P{20000}/)
})

test('bloques pueden dividir un planteamiento grande sin perder texto ni reintroducirlo después', async () => {
  const { summarizeInBlocks } = await import('../../app/lib/contextBudget.ts')
  const premise = 'A😀B'.repeat(60)
  const history = buildCompactionHistory({ premise, previousSummary: '', messages: [], characters: [], userName: 'Vera' })
  const received: string[] = []
  const result = await summarizeInBlocks({
    previousSummary: '', history, signal: new AbortController().signal,
    fits: async (_summary, block) => block.reduce((sum, item) => sum + Array.from(item.content).length, 0) <= 50,
    summarize: async (_summary, block) => { received.push(...block.map(item => item.content)); return 'Resumen acumulado.' }
  })
  assert.ok(received.length > 1)
  assert.equal(received.join(''), `Planteamiento de la historia:\n${premise}`)
  assert.equal(result, 'Resumen acumulado.')
  assert.deepEqual(buildCompactionHistory({ premise, previousSummary: result, messages: [], characters: [], userName: 'Vera' }), [])
})
