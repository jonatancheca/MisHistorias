import type {
  Character,
  LlmDebugTrace,
  Message,
  PromptPreset,
  Story
} from '#shared/types'
import {
  clearAll,
  getActiveDataScope,
  listAllImages,
  listBackgrounds,
  listCharacters,
  listLlmDebugTraces,
  listMessages,
  listPresets,
  listStories,
  putBackground,
  putCharacter,
  putImage,
  putLlmDebugTrace,
  putMessage,
  putPreset,
  putStory,
  writeSettings,
  type StoredBackground,
  type StoredImage
} from '~/lib/db'
import { buildStoryImageCatalog } from '~/lib/imageCatalog'

const TEST_TIME = Date.UTC(2026, 0, 15, 12, 0, 0)

export const TEST_DATA_IDS = {
  presetNarrative: 'test-preset-narrative',
  presetDialogue: 'test-preset-dialogue',
  characterAlicia: 'test-character-alicia',
  characterBruno: 'test-character-bruno',
  backgroundForest: 'test-background-forest',
  backgroundTavern: 'test-background-tavern',
  storyConversation: 'test-story-conversation',
  storyEmpty: 'test-story-empty'
} as const

export interface TestDataCounts {
  characters: number
  images: number
  backgrounds: number
  stories: number
  messages: number
  llmDebugTraces: number
  presets: number
}

export interface TestDataResetResult {
  counts: TestDataCounts
  activePresetId: string | null
  seeded: boolean
}

function assertDevelopmentNormalScope() {
  if (!import.meta.dev) throw new Error('Datos de prueba disponibles solo en desarrollo.')
  if (getActiveDataScope() !== 'normal') {
    throw new Error('La colección privada está protegida. Sal del modo privado primero.')
  }
}

function svgBlob(label: string, background: string, foreground = '#ffffff') {
  const safeLabel = label.replace(/[&<>"']/g, '')
  return new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">`,
      `<rect width="640" height="360" fill="${background}"/>`,
      `<text x="320" y="190" text-anchor="middle" fill="${foreground}" font-family="sans-serif" font-size="42">${safeLabel}</text>`,
      `</svg>`
    ],
    { type: 'image/svg+xml' }
  )
}

async function counts(): Promise<TestDataCounts> {
  const [characters, images, backgrounds, stories, presets] = await Promise.all([
    listCharacters(),
    listAllImages(),
    listBackgrounds(),
    listStories(),
    listPresets()
  ])
  const [messageGroups, traceGroups] = await Promise.all([
    Promise.all(stories.map((story) => listMessages(story.id))),
    Promise.all(stories.map((story) => listLlmDebugTraces(story.id)))
  ])
  return {
    characters: characters.length,
    images: images.length,
    backgrounds: backgrounds.length,
    stories: stories.length,
    messages: messageGroups.reduce((total, group) => total + group.length, 0),
    llmDebugTraces: traceGroups.reduce((total, group) => total + group.length, 0),
    presets: presets.length
  }
}

async function seedNormalData() {
  const presets: PromptPreset[] = [
    {
      id: TEST_DATA_IDS.presetNarrative,
      name: 'TEST — Narrativa equilibrada',
      content: 'Combina narración breve, fondos y diálogo etiquetado.',
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    },
    {
      id: TEST_DATA_IDS.presetDialogue,
      name: 'TEST — Solo diálogo',
      content: 'Prioriza diálogo directo y respuestas cortas.',
      createdAt: TEST_TIME + 1,
      updatedAt: TEST_TIME + 1
    }
  ]

  const characters: Character[] = [
    {
      id: TEST_DATA_IDS.characterAlicia,
      name: 'TEST Alicia',
      prompt: 'Exploradora curiosa, optimista y observadora.',
      tags: ['exploradora', 'optimista'],
      color: '#db2777',
      createdAt: TEST_TIME + 10,
      updatedAt: TEST_TIME + 10
    },
    {
      id: TEST_DATA_IDS.characterBruno,
      name: 'TEST Bruno',
      prompt: 'Guardián prudente, directo y leal.',
      tags: ['guardián', 'prudente'],
      color: '#2563eb',
      createdAt: TEST_TIME + 11,
      updatedAt: TEST_TIME + 11
    }
  ]

  const images: StoredImage[] = [
    {
      id: 'test-image-alicia-neutral',
      characterId: TEST_DATA_IDS.characterAlicia,
      tags: ['neutral'],
      description: 'Alicia en pose neutral.',
      isDefault: true,
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 20,
      blob: svgBlob('Alicia neutral', '#9d174d')
    },
    {
      id: 'test-image-alicia-happy',
      characterId: TEST_DATA_IDS.characterAlicia,
      tags: ['feliz', 'sonrisa'],
      description: 'Alicia sonriendo.',
      isDefault: false,
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 21,
      blob: svgBlob('Alicia feliz', '#ec4899')
    },
    {
      id: 'test-image-bruno-neutral',
      characterId: TEST_DATA_IDS.characterBruno,
      tags: ['neutral'],
      description: 'Bruno en pose neutral.',
      isDefault: true,
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 22,
      blob: svgBlob('Bruno neutral', '#1e3a8a')
    },
    {
      id: 'test-image-bruno-serious',
      characterId: TEST_DATA_IDS.characterBruno,
      tags: ['serio', 'alerta'],
      description: 'Bruno en alerta.',
      isDefault: false,
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 23,
      blob: svgBlob('Bruno serio', '#3b82f6')
    }
  ]

  const backgrounds: StoredBackground[] = [
    {
      id: TEST_DATA_IDS.backgroundForest,
      tags: ['bosque', 'exterior'],
      description: 'Bosque verde al amanecer.',
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 30,
      blob: svgBlob('Bosque', '#166534')
    },
    {
      id: TEST_DATA_IDS.backgroundTavern,
      tags: ['taberna', 'interior'],
      description: 'Taberna cálida iluminada por velas.',
      mimeType: 'image/svg+xml',
      createdAt: TEST_TIME + 31,
      blob: svgBlob('Taberna', '#92400e')
    }
  ]

  const stories: Story[] = [
    {
      id: TEST_DATA_IDS.storyConversation,
      title: 'TEST — Encuentro en el bosque',
      premise: 'Alicia busca a Bruno antes de que caiga la noche.',
      visualMode: false,
      protagonistPreferences: 'Mantener tono aventurero.',
      protagonistPreferencesMode: 'append',
      characterIds: [TEST_DATA_IDS.characterAlicia, TEST_DATA_IDS.characterBruno],
      characterCustomizations: [
        {
          characterId: TEST_DATA_IDS.characterAlicia,
          prompt: characters[0]!.prompt,
          tags: [...characters[0]!.tags]
        },
        {
          characterId: TEST_DATA_IDS.characterBruno,
          prompt: characters[1]!.prompt,
          tags: [...characters[1]!.tags]
        }
      ],
      initialBackgroundId: TEST_DATA_IDS.backgroundForest,
      presetId: TEST_DATA_IDS.presetNarrative,
      imageCatalogSnapshot: buildStoryImageCatalog(
        [TEST_DATA_IDS.characterAlicia, TEST_DATA_IDS.characterBruno],
        characters,
        images
      ),
      createdAt: TEST_TIME + 40,
      updatedAt: TEST_TIME + 50
    },
    {
      id: TEST_DATA_IDS.storyEmpty,
      title: 'TEST — Borrador vacío',
      premise: 'Historia preparada para probar el primer mensaje.',
      visualMode: false,
      protagonistPreferences: 'Usar frases muy cortas.',
      protagonistPreferencesMode: 'replace',
      characterIds: [TEST_DATA_IDS.characterAlicia],
      characterCustomizations: [
        {
          characterId: TEST_DATA_IDS.characterAlicia,
          prompt: characters[0]!.prompt,
          tags: [...characters[0]!.tags]
        }
      ],
      initialBackgroundId: null,
      presetId: TEST_DATA_IDS.presetDialogue,
      imageCatalogSnapshot: buildStoryImageCatalog(
        [TEST_DATA_IDS.characterAlicia],
        characters,
        images
      ),
      createdAt: TEST_TIME + 41,
      updatedAt: TEST_TIME + 41
    }
  ]

  const userMessageId = 'test-message-user'
  const assistantMessageId = 'test-message-assistant'
  const messages: Message[] = [
    {
      id: userMessageId,
      storyId: TEST_DATA_IDS.storyConversation,
      role: 'user',
      raw: 'Busca a Bruno en el bosque.',
      segments: [],
      createdAt: TEST_TIME + 60
    },
    {
      id: assistantMessageId,
      storyId: TEST_DATA_IDS.storyConversation,
      role: 'assistant',
      raw: 'Fondo [bosque]:\nNarración: Las ramas crujen.\nTEST Alicia [feliz]: ¡Bruno! Por fin te encuentro.',
      segments: [
        {
          type: 'background',
          characterId: null,
          backgroundId: TEST_DATA_IDS.backgroundForest,
          tag: 'bosque',
          text: ''
        },
        {
          type: 'narration',
          characterId: null,
          tag: null,
          text: 'Las ramas crujen.'
        },
        {
          type: 'dialogue',
          characterId: TEST_DATA_IDS.characterAlicia,
          tag: 'feliz',
          text: '¡Bruno! Por fin te encuentro.'
        }
      ],
      createdAt: TEST_TIME + 61
    }
  ]

  const traces: LlmDebugTrace[] = [
    {
      id: 'test-debug-trace-success',
      storyId: TEST_DATA_IDS.storyConversation,
      requestMessageId: userMessageId,
      responseMessageId: assistantMessageId,
      status: 'success',
      request: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Busca a Bruno en el bosque.' }],
        temperature: 0.8,
        max_tokens: 1000,
        stream: false
      },
      response: {
        content: messages[1]!.raw,
        finishReason: 'stop'
      },
      createdAt: TEST_TIME + 62
    }
  ]

  await Promise.all([
    ...characters.map(putCharacter),
    ...backgrounds.map(putBackground),
    ...presets.map(putPreset)
  ])
  await Promise.all(images.map(putImage))
  await Promise.all(stories.map(putStory))
  await Promise.all(messages.map(putMessage))
  await Promise.all(traces.map(putLlmDebugTrace))
}

export async function resetNormalTestData(seed: boolean): Promise<TestDataResetResult> {
  assertDevelopmentNormalScope()
  await clearAll('normal')
  if (seed) await seedNormalData()

  const activePresetId = seed ? TEST_DATA_IDS.presetNarrative : null
  await writeSettings({ activePresetId })

  return { counts: await counts(), activePresetId, seeded: seed }
}
