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
  buildCompactionMessages,
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
    userName: 'Vera'
  })

  assert.equal(payload.filter((message) => message.role === 'system').length, 1)
  assert.match(payload[0]?.content ?? '', /Resumen anterior que debes integrar/)
  assert.match(payload[0]?.content ?? '', /Alicia abrió la puerta/)
  assert.doesNotMatch(JSON.stringify(payload), /Respuesta ya resumida/)
  assert.deepEqual(payload.slice(1), [
    { role: 'user', content: 'Vera: Abro la ventana.' },
    { role: 'assistant', content: 'Entra aire frío.' }
  ])
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

test('combina todos los mensajes system para Qwen sin perder catálogo ni orden', () => {
  const messages = buildChatMessages({
    presetContent: 'Narra.',
    story,
    characters: [character],
    images: [{
      id: 'image-1',
      characterId: character.id,
      tags: ['feliz', 'armadura'],
      isDefault: true,
      mimeType: 'image/png',
      createdAt: 1,
      blob: new Blob()
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
  assert.match(systemContent, /\[feliz\]\[armadura\]/)
  assert.match(systemContent, /\[campana\] \(personaje Alicia\)/)

  const instructionIndex = systemContent.indexOf('Habla en susurros.')
  const catalogIndex = systemContent.indexOf('Catálogo actualizado.')
  const continuationIndex = systemContent.indexOf('Continúa la historia')
  const pendingIndex = systemContent.indexOf('INDICACIÓN VISUAL')
  const reminderIndex = systemContent.indexOf('Responde directamente')
  assert.ok(instructionIndex > 0)
  assert.ok(instructionIndex < catalogIndex)
  assert.ok(catalogIndex < continuationIndex)
  assert.ok(continuationIndex < pendingIndex)
  assert.ok(pendingIndex < reminderIndex)
  assert.deepEqual(messages.slice(1), [
    { role: 'assistant', content: 'La puerta se abre.' },
    { role: 'user', content: 'Vera: Entra en la sala.' }
  ])
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
