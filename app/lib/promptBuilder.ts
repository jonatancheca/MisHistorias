import type { Character, Message, Story } from '#shared/types'
import type { StoredImage } from '~/lib/db'
import { serializeSegments } from '~/lib/streamParser'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const FORMAT_REMINDER =
  'Recuerda el formato: una línea por intervención, `Nombre [etiqueta]: texto` para diálogo y línea sin prefijo para narración. Usa solo los personajes y etiquetas listados.'

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

export function buildSystemPrompt(options: {
  presetContent: string
  story: Story
  characters: Character[]
  images: StoredImage[]
  userName: string
}): string {
  const { presetContent, story, characters, images, userName } = options
  return [
    presetContent.trim(),
    '',
    '## PLANTEAMIENTO DE LA HISTORIA',
    story.premise.trim() || '(sin planteamiento)',
    '',
    '## EL USUARIO',
    `El usuario juega como "${userName}". Sus mensajes llegan con el prefijo \`${userName}:\`.`,
    'No hables ni decidas por él; reacciona a lo que hace.',
    '',
    '## PERSONAJES',
    characters.map((character) => characterSheet(character, images)).join('\n\n')
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
  messages: Message[]
  historyBudget: number
  userName: string
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
