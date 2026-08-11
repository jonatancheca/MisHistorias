import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const jiti = createJiti(import.meta.url, {
  alias: {
    '~': resolve(root, 'app'),
    '#shared': resolve(root, 'shared')
  }
})
const { buildSystemPrompt } = await jiti.import<
  typeof import('../../app/lib/promptBuilder.ts')
>('../../app/lib/promptBuilder.ts')

test('usa prompt y etiquetas descriptivas de la historia sin cambiar etiquetas visuales', () => {
  const prompt = buildSystemPrompt({
    presetContent: 'Narra.',
    story: {
      id: 'story-1',
      title: 'Historia',
      premise: 'Premisa',
      visualMode: false,
      protagonistPreferences: '',
      protagonistPreferencesMode: 'append',
      characterIds: ['character-1'],
      characterCustomizations: [
        {
          characterId: 'character-1',
          prompt: 'Prompt exclusivo de la historia',
          tags: ['misteriosa']
        }
      ],
      initialBackgroundId: null,
      presetId: null,
      createdAt: 1,
      updatedAt: 1
    },
    characters: [
      {
        id: 'character-1',
        name: 'Alicia',
        prompt: 'Prompt global que no debe aparecer',
        tags: ['global'],
        color: '#123456',
        createdAt: 1,
        updatedAt: 1
      }
    ],
    images: [
      {
        id: 'image-1',
        characterId: 'character-1',
        tags: ['feliz'],
        description: '',
        isDefault: true,
        mimeType: 'image/png',
        createdAt: 1,
        blob: new Blob()
      }
    ],
    backgrounds: [],
    userName: 'Usuario',
    protagonistPreferences: '',
    generationMode: 'normal'
  })

  assert.match(prompt, /Prompt exclusivo de la historia/)
  assert.doesNotMatch(prompt, /Prompt global que no debe aparecer/)
  assert.match(prompt, /Etiquetas descriptivas[^\n]*misteriosa/)
  assert.doesNotMatch(prompt, /Etiquetas descriptivas[^\n]*global/)
  assert.match(prompt, /\[feliz\]/)
})
