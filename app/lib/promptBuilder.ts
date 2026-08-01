import type { Character, Message, Story } from '#shared/types'
import type { StoredBackground, StoredImage } from '~/lib/db'
import { serializeSegments } from '~/lib/streamParser'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const FORMAT_REMINDER =
  'Responde directamente con la historia, sin análisis, razonamiento ni explicaciones. Cada intervención ocupa una línea independiente; la respuesta puede contener varias. Usa `Nombre [etiqueta]: texto` para diálogo, `Fondo [etiqueta]:` solo cuando cambie el fondo y una línea sin prefijo para narración. Usa solo personajes, fondos y etiquetas listados.'

function characterSheet(character: Character, images: StoredImage[]) {
  const own = images.filter((image) => image.characterId === character.id)
  const fallback = own.find((image) => image.isDefault) ?? own[0]
  const tags = own.length
    ? own
        .map(
          (image) =>
            `  - [${image.tag}]${image.isDefault ? ' (por defecto)' : ''}: ${image.description || 'sin descripción'}`
        )
        .join('\n')
    : '  - (sin imágenes; usa [neutral])'

  return [
    `### ${character.name}`,
    character.prompt.trim() || '(sin descripción)',
    'Etiquetas de imagen disponibles:',
    tags,
    fallback ? `Etiqueta por defecto: [${fallback.tag}]` : 'Etiqueta por defecto: [neutral]'
  ].join('\n')
}

function backgroundSheet(story: Story, backgrounds: StoredBackground[]) {
  if (!backgrounds.length) return 'No hay fondos disponibles.'
  const initial = backgrounds.find((background) => background.id === story.initialBackgroundId)
  const catalog = backgrounds
    .map(
      (background) =>
        `- [${background.tag}]: ${background.description || 'sin descripción'}`
    )
    .join('\n')
  const initialRule = initial
    ? `Fondo inicial: [${initial.tag}]. No lo anuncies al comenzar; usa una directiva solo cuando cambie.`
    : 'No hay fondo inicial. Elige uno y comienza la primera respuesta con su directiva.'
  return [
    catalog,
    initialRule,
    'Para cambiarlo, escribe una línea independiente exacta: `Fondo [etiqueta]:`.',
    'No repitas la directiva mientras siga el mismo fondo.'
  ].join('\n')
}

export function buildSystemPrompt(options: {
  presetContent: string
  story: Story
  characters: Character[]
  images: StoredImage[]
  backgrounds: StoredBackground[]
  userName: string
  protagonistPreferences: string
}): string {
  const {
    presetContent,
    story,
    characters,
    images,
    backgrounds,
    userName,
    protagonistPreferences
  } = options
  return [
    presetContent.trim(),
    '',
    '## PLANTEAMIENTO DE LA HISTORIA',
    story.premise.trim() || '(sin planteamiento)',
    '',
    '## EL PROTAGONISTA',
    `El protagonista se llama "${userName}". Sus mensajes llegan con el prefijo \`${userName}:\`.`,
    protagonistPreferences.trim()
      ? `Preferencias del protagonista:\n${protagonistPreferences.trim()}`
      : 'Preferencias del protagonista: (sin preferencias adicionales)',
    'No hables ni decidas por el protagonista; reacciona a lo que hace.',
    '',
    '## PERSONAJES',
    characters.map((character) => characterSheet(character, images)).join('\n\n'),
    '',
    '## FONDOS',
    backgroundSheet(story, backgrounds)
  ].join('\n')
}

/** Recorta el historial por presupuesto de caracteres, conservando lo más reciente. */
export function buildHistory(
  messages: Message[],
  characters: Character[],
  budget: number,
  userName: string
): ChatMessage[] {
  const history: ChatMessage[] = []
  let used = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const content =
      message.role === 'assistant'
        ? message.segments.length
          ? serializeSegments(message.segments, characters)
          : message.raw
        : `${userName}: ${message.raw}`
    if (!content.trim()) continue
    if (used + content.length > budget && history.length > 0) break
    history.unshift({ role: message.role, content })
    used += content.length
  }

  return history
}

export function buildChatMessages(options: {
  presetContent: string
  story: Story
  characters: Character[]
  images: StoredImage[]
  backgrounds: StoredBackground[]
  messages: Message[]
  historyBudget: number
  userName: string
  protagonistPreferences: string
}): ChatMessage[] {
  const system = buildSystemPrompt(options)
  const history = buildHistory(
    options.messages,
    options.characters,
    options.historyBudget,
    options.userName
  )
  const opening: ChatMessage[] = history.length
    ? []
    : [
        {
          role: 'user',
          content:
            'Comienza la historia a partir del planteamiento. Presenta la escena y deja que los personajes actúen.'
        }
      ]

  return [
    { role: 'system', content: system },
    ...history,
    ...opening,
    { role: 'system', content: FORMAT_REMINDER }
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
