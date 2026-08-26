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
  buildChatMessages,
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
  createdAt: 1,
  updatedAt: 1
}

const story: Story = {
  id: 'story-1',
  title: 'Historia',
  premise: 'Premisa',
  visualMode: false,
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

test('usa prompt y etiquetas descriptivas de la historia sin cambiar etiquetas visuales', () => {
  const legacyImage = {
    id: 'image-1',
    characterId: 'character-1',
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
  assert.match(prompt, /\[feliz\]\[armadura\]/)
  assert.doesNotMatch(prompt, /\[feliz\] \/ \[armadura\]/)
  assert.doesNotMatch(prompt, /DESCRIPCIÓN LEGACY NO ENVIADA/)
  assert.match(prompt, /Sonido \[etiqueta\]:/)
  assert.match(prompt, /\[campana\] \(personaje Alicia\)/)
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
  assert.ok(continued.some((message) => message.content === 'Catálogo actualizado.'))
  assert.ok(continued.some((message) => /No inventes acciones/.test(message.content)))
  assert.ok(automatic.some((message) => /Puedes inventar acciones/.test(message.content)))
  assert.match(automatic[0]?.content ?? '', /Puedes hablar y decidir por el protagonista/)
})

test('añade indicaciones visuales solo para la respuesta solicitada', () => {
  const messages = buildChatMessages({
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
    generationMode: 'normal',
    pendingImageInstructions: [{
      characterId: character.id,
      imageId: 'image-2',
      tags: ['seria', 'armadura']
    }]
  })

  const instruction = messages.find((message) =>
    message.content.includes('INDICACIÓN VISUAL PARA ESTA RESPUESTA')
  )
  assert.equal(instruction?.role, 'system')
  assert.match(instruction?.content ?? '', /Alicia: \[seria\]\[armadura\]/)
  assert.match(instruction?.content ?? '', /termina después de esta respuesta/)
})

test('agrupa todos los mensajes system al principio para Qwen sin reordenar conversación', () => {
  const messages = buildChatMessages({
    presetContent: 'Narra.',
    story,
    characters: [character],
    images: [],
    backgrounds: [],
    sounds: [],
    messages: [
      {
        id: 'instruction-1',
        storyId: story.id,
        role: 'user',
        raw: 'IA: Habla en susurros.',
        segments: [],
        createdAt: 1
      },
      {
        id: 'user-1',
        storyId: story.id,
        role: 'user',
        raw: 'Entra en la sala.',
        segments: [],
        createdAt: 2
      },
      {
        id: 'assistant-1',
        storyId: story.id,
        role: 'assistant',
        raw: 'La puerta se abre.',
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

  const firstConversation = messages.findIndex((message) => message.role !== 'system')
  assert.ok(firstConversation > 0)
  assert.ok(messages.slice(0, firstConversation).every((message) => message.role === 'system'))
  assert.ok(messages.slice(firstConversation).every((message) => message.role !== 'system'))

  const systemContents = messages.slice(0, firstConversation).map((message) => message.content)
  const instructionIndex = systemContents.findIndex((content) => content.includes('Habla en susurros.'))
  const catalogIndex = systemContents.indexOf('Catálogo actualizado.')
  const continuationIndex = systemContents.findIndex((content) => content.startsWith('Continúa la historia'))
  const pendingIndex = systemContents.findIndex((content) => content.includes('INDICACIÓN VISUAL'))
  const reminderIndex = systemContents.findIndex((content) => content.startsWith('Responde directamente'))
  assert.deepEqual(
    [instructionIndex, catalogIndex, continuationIndex, pendingIndex, reminderIndex],
    [1, 2, 3, 4, 5]
  )
  assert.deepEqual(messages.slice(firstConversation), [
    { role: 'user', content: 'Vera: Entra en la sala.' },
    { role: 'assistant', content: 'La puerta se abre.' }
  ])
})

test('convierte mensajes IA en instrucciones ocultas del historial', () => {
  const history = buildHistory(
    [
      {
        id: 'instruction-1',
        storyId: 'story-1',
        role: 'user',
        raw: 'IA: Haz que todos hablen en susurros.',
        segments: [],
        createdAt: 1
      },
      {
        id: 'user-1',
        storyId: 'story-1',
        role: 'user',
        raw: 'Entra en la sala.',
        segments: [],
        createdAt: 2
      }
    ],
    [],
    1000,
    'Usuario'
  )

  assert.deepEqual(history, [
    { role: 'system', content: 'Instrucción del usuario para la IA:\nHaz que todos hablen en susurros.' },
    { role: 'user', content: 'Usuario: Entra en la sala.' }
  ])
})
