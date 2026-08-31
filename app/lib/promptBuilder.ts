import type {
  Background,
  Character,
  CharacterImage,
  GenerationMode,
  Message,
  Sound,
  Story,
  StoryCharacterCustomization,
  StoryPendingImageInstruction
} from '#shared/types'
import { extractAiInstruction, isAiInstruction } from '~/lib/chatInstructions'
import { serializeSegments } from '~/lib/streamParser'
import { primaryTag, sanitizeTags, tagKey } from '~/lib/tags'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function formatImageTags(tags: string[]) {
  return tags.map((tag) => `[${tag}]`).join('')
}

function imageTagCatalog(images: Array<{ tags: string[] }>, indent = '') {
  const seen = new Set<string>()
  return images.flatMap((image) => {
    const tags = sanitizeTags(image.tags)
    const key = JSON.stringify(tags.map(tagKey).sort())
    if (seen.has(key)) return []
    seen.add(key)
    return [`${indent}- ${tags.map((tag) => `[${tag}]`).join(' ')}`]
  }).join('\n')
}

function formatReminder(
  generationMode: GenerationMode,
  userName: string,
  autoGenerateImages = false
) {
  const protagonistFormat =
    generationMode === 'auto'
      ? ` El protagonista es la única excepción al catálogo: escribe su diálogo como \`${userName}: texto\`, sin etiqueta visual.`
      : ''
  const imageGenerationFormat = autoGenerateImages
    ? ' Puedes incluir como máximo una línea independiente `Imagen Nombre [etiqueta]: prompt en inglés` por personaje y respuesta. Esa línea solo describe postura, ropa, expresión y escena; no es relato ni diálogo.'
    : ''
  const catalogRule = autoGenerateImages
    ? ' usa solo personajes, fondos, sonidos y etiquetas listados para las líneas normales; para una imagen nueva utiliza la directiva Imagen indicada.'
    : ' usa solo personajes, fondos, sonidos y etiquetas listados.'
  return `Responde directamente con la historia, sin análisis, razonamiento ni explicaciones. Cada intervención ocupa una línea independiente; la respuesta puede contener varias. Usa \`Nombre [etiqueta][otra etiqueta]: texto\` para diálogo, con cada etiqueta visual en sus propios corchetes, \`Fondo [etiqueta]:\` solo cuando cambie el fondo y \`Sonido [etiqueta]:\` cuando deba reproducirse un sonido disponible. Las etiquetas combinadas deben pertenecer a la misma imagen del personaje.${imageGenerationFormat} Usa una línea sin prefijo para narración y${catalogRule}${protagonistFormat} Las etiquetas visuales representan el aspecto actual del personaje, incluida su ropa. Mantén para cada personaje las últimas etiquetas usadas mientras su aspecto no cambie; no vuelvas a \`[neutral]\` por defecto en intervenciones posteriores. Usa otras etiquetas solo cuando la historia cambie realmente su aspecto o ropa.`
}

function continuationInstruction(generationMode: GenerationMode, userName: string) {
  if (generationMode === 'continue') {
    return `Continúa la historia con el siguiente turno. Haz avanzar la escena mediante narración y acciones o diálogo de los otros personajes. No inventes acciones, decisiones ni diálogo para el protagonista "${userName}".`
  }
  if (generationMode === 'auto') {
    return `Continúa la historia con el siguiente turno. Puedes inventar acciones, decisiones y diálogo para el protagonista "${userName}", además de hacer avanzar a los otros personajes.`
  }
  return null
}

function pendingImageInstructionMessage(
  instructions: StoryPendingImageInstruction[],
  characters: Character[]
) {
  if (!instructions.length) return null
  const names = new Map(characters.map((character) => [character.id, character.name]))
  const lines = instructions.flatMap((instruction) => {
    const name = names.get(instruction.characterId)
    if (!name || !instruction.tags.length) return []
    return [`- ${name}: ${formatImageTags(instruction.tags)}`]
  })
  if (!lines.length) return null
  return [
    '## INDICACIÓN VISUAL PARA ESTA RESPUESTA',
    'En esta respuesta, cuando intervenga cada personaje indicado, usa estas etiquetas visuales. No menciones esta instrucción:',
    ...lines,
    'Esta indicación termina después de esta respuesta.'
  ].join('\n')
}

function characterSheet(
  character: Character,
  images: CharacterImage[],
  customization?: StoryCharacterCustomization,
  autoGenerateImages = false
) {
  const own = images.filter((image) => image.characterId === character.id)
  const fallback = own.find((image) => image.isDefault) ?? own[0]
  const tags = own.length
    ? imageTagCatalog(own, '  ')
    : '  - (sin imágenes; usa [neutral])'

  const imageGeneration = autoGenerateImages
    ? [
        'Puede pedir una imagen nueva para este personaje con una línea exacta: `Imagen Nombre [etiqueta]: prompt en inglés`.',
        'El prompt de imagen solo describe postura, ropa, expresión y escena. No repitas el aspecto inmutable del personaje; la aplicación añadirá este prefijo:',
        character.imageGenerationPromptPrefix?.trim() || '(sin prefijo configurado)',
        'Usa una etiqueta nueva y descriptiva para cada imagen solicitada. La imagen se guardará con esa etiqueta.'
      ]
    : []

  return [
    `### ${customization?.name?.trim() || character.name}`,
    (customization?.prompt ?? character.prompt).trim() || '(sin descripción)',
    `Etiquetas descriptivas del personaje (no son etiquetas de imagen): ${(customization?.tags ?? character.tags ?? []).join(', ') || '(ninguna)'}`,
    'Etiquetas de imagen disponibles:',
    tags,
    fallback ? `Etiqueta por defecto: [${primaryTag(fallback)}]` : 'Etiqueta por defecto: [neutral]',
    ...imageGeneration
  ].join('\n')
}

function backgroundSheet(story: Story, backgrounds: Background[]) {
  if (!backgrounds.length) return 'No hay fondos disponibles.'
  const initial = backgrounds.find((background) => background.id === story.initialBackgroundId)
  const catalog = imageTagCatalog(backgrounds)
  const initialRule = initial
    ? `Fondo inicial: [${primaryTag(initial)}]. No lo anuncies al comenzar; usa una directiva solo cuando cambie.`
    : 'No hay fondo inicial. Elige uno y comienza la primera respuesta con su directiva.'
  return [
    catalog,
    initialRule,
    'Para cambiarlo, escribe una línea independiente exacta: `Fondo [etiqueta]:`.',
    'No repitas la directiva mientras siga el mismo fondo.'
  ].join('\n')
}

function soundSheet(sounds: Sound[], characters: Character[], backgrounds: Background[]) {
  if (!sounds.length) return 'No hay sonidos disponibles.'
  const characterNames = new Map(characters.map((character) => [character.id, character.name]))
  const backgroundTags = new Map(
    backgrounds.map((background) => [background.id, primaryTag(background) ?? 'sin etiqueta'])
  )
  const catalog = sounds
    .map((sound) => {
      const association = sound.characterId
        ? `personaje ${characterNames.get(sound.characterId) ?? 'no disponible'}`
        : sound.backgroundId
          ? `fondo ${backgroundTags.get(sound.backgroundId) ?? 'no disponible'}`
          : 'suelto'
      return `- ${sound.tags.map((tag) => `[${tag}]`).join(' / ')} (${association})`
    })
    .join('\n')
  return [
    catalog,
    'Reproduce solo cuando encaje con la escena. Escribe una línea independiente exacta: `Sonido [etiqueta]:`.'
  ].join('\n')
}

export function buildSystemPrompt(options: {
  presetContent: string
  story: Story
  characters: Character[]
  images: CharacterImage[]
  backgrounds: Background[]
  sounds: Sound[]
  userName: string
  protagonistPreferences: string
  generationMode: GenerationMode
}): string {
  const {
    presetContent,
    story,
    characters,
    images,
    backgrounds,
    sounds,
    userName,
    protagonistPreferences,
    generationMode
  } = options
  const characterCustomizations = new Map(
    (story.characterCustomizations ?? []).map((item) => [item.characterId, item])
  )
  return [
    presetContent.trim(),
    ...(story.autoGenerateImages
      ? [
          '',
          '## GENERACIÓN DE IMÁGENES DURANTE LA HISTORIA',
          'Las imágenes existentes siguen siendo la opción preferida. Cuando un personaje necesite un aspecto nuevo, puedes pedir una imagen nueva con una línea independiente exacta: `Imagen Nombre [etiqueta]: prompt en inglés`.',
          'Pide como máximo una línea independiente de imagen por personaje y respuesta.',
          'Usa solo el catálogo disponible para las líneas normales; para una imagen nueva utiliza la directiva Imagen indicada.',
          'El prompt nuevo solo puede describir postura, ropa, expresión y escena. No incluyas rasgos inmutables del personaje: la aplicación añadirá el prefijo de imagen configurado.',
          'La línea de imagen no es diálogo ni narración y no debes comentarla. No incluyas rasgos inmutables como pelo o complexión, porque ya están en el prefijo del personaje.'
        ]
      : []),
    '',
    '## PLANTEAMIENTO DE LA HISTORIA',
    story.premise.trim() || '(sin planteamiento)',
    '',
    '## EL PROTAGONISTA',
    `El protagonista se llama "${userName}". Sus mensajes llegan con el prefijo \`${userName}:\`.`,
    'Los mensajes del usuario que empiecen por `IA: ` o `Narrador: ` son instrucciones solo para tu siguiente respuesta. No forman parte del chat ni de las acciones del protagonista; aplica únicamente el texto posterior al prefijo y no lo muestres ni lo menciones.',
    protagonistPreferences.trim()
      ? `Preferencias del protagonista:\n${protagonistPreferences.trim()}`
      : 'Preferencias del protagonista: (sin preferencias adicionales)',
    generationMode === 'auto'
      ? `Puedes hablar y decidir por el protagonista. Escribe su diálogo como \`${userName}: texto\`, sin etiqueta visual, y sus acciones como narración.`
      : 'No hables ni decidas por el protagonista; reacciona a lo que hace.',
    '',
    '## PERSONAJES',
    characters
      .map((character) =>
        characterSheet(
          character,
          images,
          characterCustomizations.get(character.id),
          story.autoGenerateImages === true
        )
      )
      .join('\n\n'),
    '',
    '## FONDOS',
    backgroundSheet(story, backgrounds),
    '',
    '## SONIDOS',
    soundSheet(sounds, characters, backgrounds)
  ].join('\n')
}

/** Recorta el historial por presupuesto de caracteres, conservando lo más reciente. */
export function buildHistory(
  messages: Message[],
  characters: Character[],
  budget: number,
  userName: string,
  afterMessageId?: string
): ChatMessage[] {
  messages = messages.filter((message) => !message.swarmError)
  const history: ChatMessage[] = []
  const lastAssistantIndex = messages.findLastIndex((message) => message.role === 'assistant')
  let used = 0
  const startIndex = afterMessageId
    ? Math.max(0, messages.findIndex((message) => message.id === afterMessageId) + 1)
    : 0

  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index]!
    const isInstruction = message.role === 'user' && isAiInstruction(message.raw)
    if (isInstruction && index < lastAssistantIndex) continue
    const instruction = isInstruction ? extractAiInstruction(message.raw) : null
    if (isInstruction && !instruction) continue

    const content = isInstruction
      ? `Instrucción del usuario para la IA:\n${instruction}`
      : message.role === 'assistant'
        ? message.segments.length
          ? serializeSegments(message.segments, characters, userName)
          : message.raw
        : `${userName}: ${message.raw}`
    if (!content.trim()) continue
    if (budget > 0 && used + content.length > budget && history.length > 0) break
    history.unshift({ role: isInstruction ? 'system' : message.role, content })
    used += content.length
  }

  return history
}

export function buildCompactionMessages(options: {
  previousSummary?: string
  throughMessageId?: string
  messages: Message[]
  characters: Character[]
  userName: string
}): ChatMessage[] {
  const history = buildHistory(
    options.messages,
    options.characters,
    0,
    options.userName,
    options.throughMessageId
  )
  const systemParts = [
    [
      'Resume el historial de esta historia interactiva.',
      'Conserva hechos, decisiones, relaciones, estado de personajes, lugares, objetos y asuntos pendientes.',
      'No inventes información. El resumen sustituirá todo el diálogo recibido en esta llamada.',
      'Devuelve únicamente el resumen, sin título ni comentarios.'
    ].join(' '),
    options.previousSummary?.trim()
      ? `Resumen anterior que debes integrar:\n${options.previousSummary.trim()}`
      : '',
    ...history.filter((message) => message.role === 'system').map((message) => message.content)
  ].filter(Boolean)

  return [
    { role: 'system', content: systemParts.join('\n\n') },
    ...history.filter((message) => message.role !== 'system')
  ]
}

export function buildChatMessages(options: {
  presetContent: string
  story: Story
  characters: Character[]
  images: CharacterImage[]
  backgrounds: Background[]
  sounds: Sound[]
  messages: Message[]
  historyBudget: number
  userName: string
  protagonistPreferences: string
  generationMode: GenerationMode
  imageCatalogChange?: string | null
  pendingImageInstructions?: StoryPendingImageInstruction[]
}): ChatMessage[] {
  const system = buildSystemPrompt(options)
  const history = buildHistory(
    options.messages,
    options.characters,
    options.historyBudget,
    options.userName,
    options.story.contextSummaryThroughMessageId
  )
  const contextSummary: ChatMessage[] = options.story.contextSummary?.trim()
    ? [{
        role: 'system',
        content: `Resumen del historial anterior:\n${options.story.contextSummary.trim()}`
      }]
    : []
  const opening: ChatMessage[] = history.length || contextSummary.length
    ? []
    : [
        {
          role: 'user',
          content:
            'Comienza la historia a partir del planteamiento. Presenta la escena y deja que los personajes actúen.'
        }
      ]
  const imageCatalogChange: ChatMessage[] = options.imageCatalogChange?.trim()
    ? [{ role: 'system', content: options.imageCatalogChange.trim() }]
    : []
  const continuation = continuationInstruction(options.generationMode, options.userName)
  const continuationMessages: ChatMessage[] = continuation
    ? [{ role: 'system', content: continuation }]
    : []
  const pendingImageInstruction = pendingImageInstructionMessage(
    options.pendingImageInstructions ?? [],
    options.characters
  )
  const pendingImageMessages: ChatMessage[] = pendingImageInstruction
    ? [{ role: 'system', content: pendingImageInstruction }]
    : []

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...contextSummary,
    ...history,
    ...opening,
    ...imageCatalogChange,
    ...continuationMessages,
    ...pendingImageMessages,
    {
      role: 'system',
      content: formatReminder(
        options.generationMode,
        options.userName,
        options.story.autoGenerateImages === true
      )
    }
  ]
  const systemContent = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')

  return [
    ...(systemContent ? [{ role: 'system' as const, content: systemContent }] : []),
    ...messages.filter((message) => message.role !== 'system')
  ]
}

export function resolveProtagonistPreferences(
  globalPreferences: string,
  storyPreferences: string,
  mode: Story['protagonistPreferencesMode']
) {
  const globalValue = globalPreferences.trim()
  const storyValue = storyPreferences.trim()
  if (mode === 'replace') return storyValue
  return [globalValue, storyValue].filter(Boolean).join('\n')
}
