import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { test as base, expect, type APIRequestContext } from '@playwright/test'
import type {
  AppSettings,
  Background,
  Character,
  CharacterImage,
  Message,
  PromptPreset,
  Sound,
  Story
} from '../../shared/types'

export type DataScope = 'normal' | 'private'

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

export function createPng(width = 2, height = 2) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const row = Buffer.alloc(1 + width * 4)
  for (let x = 0; x < width; x++) {
    row.set(x % 2 === 0 ? [219, 39, 119, 255] : [37, 99, 235, 255], 1 + x * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

export const PNG_BYTES = createPng()
export const SOUND_BYTES = Buffer.from('OggS\u0000MisHistorias')

interface CharacterInput {
  name?: string
  prompt?: string
  tags?: string[]
  color?: string
  imageGenerationPreset?: string
  imageGenerationLora?: string
  imageGenerationSeed?: string
  imageGenerationPromptPrefix?: string
  imageGenerationModel?: string
  scope?: DataScope
}

interface PresetInput {
  name?: string
  content?: string
  scope?: DataScope
}

interface BackgroundInput {
  tags?: string[]
  description?: string
  scope?: DataScope
}

interface StoryInput {
  title?: string
  premise?: string
  visualMode?: boolean
  autoGenerateImages?: boolean
  protagonistPreferences?: string
  protagonistPreferencesMode?: 'append' | 'replace'
  characters: Character[]
  background?: Background | null
  preset?: PromptPreset | null
  scope?: DataScope
}

interface MessageInput {
  story: Story
  role: 'user' | 'assistant'
  raw: string
  segments?: Message['segments']
  generationMode?: Message['generationMode']
  scope?: DataScope
}

export interface TestDataFactory {
  prefix: string
  unique(label: string): string
  createCharacter(input?: CharacterInput): Promise<Character>
  createPreset(input?: PresetInput): Promise<PromptPreset>
  createBackground(input?: BackgroundInput): Promise<Background>
  createImage(character: Character, tags?: string[], scope?: DataScope): Promise<CharacterImage>
  createSound(character: Character, tags?: string[], scope?: DataScope): Promise<Sound>
  createStory(input: StoryInput): Promise<Story>
  createMessage(input: MessageInput): Promise<Message>
  patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  get<T>(resource: string, id: string, scope?: DataScope): Promise<T>
  list<T>(resource: string, scope?: DataScope, query?: Record<string, string>): Promise<T[]>
}

async function assertOk(response: Awaited<ReturnType<APIRequestContext['put']>>) {
  if (response.ok()) return
  throw new Error(`${response.status()} ${response.statusText()}: ${await response.text()}`)
}

function resourceUrl(
  resource: string,
  scope: DataScope,
  query: Record<string, string> = {}
) {
  const params = new URLSearchParams({ ...query, scope })
  return `/api/data/${resource}?${params}`
}

export const test = base.extend<{ data: TestDataFactory }>({
  data: async ({ request }, use) => {
    let sequence = 0
    const prefix = `pw-${randomUUID().slice(0, 8)}`
    const unique = (label: string) => `${prefix}-${label}-${++sequence}`

    async function putJson<T extends { id: string }>(
      resource: string,
      value: T,
      scope: DataScope
    ) {
      const response = await request.put(resourceUrl(`${resource}/${value.id}`, scope), {
        data: value
      })
      await assertOk(response)
      return response.json() as Promise<T>
    }

    async function putBinary<T extends { id: string; mimeType: string }>(
      resource: 'images' | 'backgrounds' | 'sounds',
      value: T,
      scope: DataScope,
      buffer = PNG_BYTES
    ) {
      const response = await request.put(resourceUrl(`${resource}/${value.id}`, scope), {
        multipart: {
          metadata: JSON.stringify(value),
          file: {
            name: `${value.id}.bin`,
            mimeType: value.mimeType,
            buffer
          }
        }
      })
      await assertOk(response)
      return response.json() as Promise<T>
    }

    const factory: TestDataFactory = {
      prefix,
      unique,
      async createCharacter(input = {}) {
        const now = Date.now()
        const character: Character = {
          id: unique('character'),
          name: input.name ?? unique('Personaje'),
          prompt: input.prompt ?? 'Personaje creado exclusivamente para esta prueba.',
          tags: input.tags ?? ['prueba', unique('rasgo')],
          color: input.color ?? '#db2777',
          imageGenerationPreset: input.imageGenerationPreset ?? '',
          imageGenerationLora: input.imageGenerationLora ?? '',
          imageGenerationSeed: input.imageGenerationSeed ?? '',
          imageGenerationPromptPrefix: input.imageGenerationPromptPrefix ?? '',
          imageGenerationModel: input.imageGenerationModel ?? '',
          archived: false,
          createdAt: now,
          updatedAt: now
        }
        return putJson('characters', character, input.scope ?? 'normal')
      },
      async createPreset(input = {}) {
        const now = Date.now()
        const preset: PromptPreset = {
          id: unique('preset'),
          name: input.name ?? unique('Prompt'),
          content: input.content ?? 'Narra una escena breve de prueba.',
          createdAt: now,
          updatedAt: now
        }
        return putJson('presets', preset, input.scope ?? 'normal')
      },
      async createBackground(input = {}) {
        const background: Background = {
          id: unique('background'),
          tags: input.tags ?? [unique('fondo')],
          description: input.description ?? 'Fondo creado exclusivamente para esta prueba.',
          mimeType: 'image/png',
          createdAt: Date.now()
        }
        return putBinary('backgrounds', background, input.scope ?? 'normal')
      },
      async createImage(character, tags = ['neutral'], scope = 'normal') {
        const image: CharacterImage = {
          id: unique('image'),
          characterId: character.id,
          tags,
          isDefault: true,
          mimeType: 'image/png',
          createdAt: Date.now()
        }
        return putBinary('images', image, scope)
      },
      async createSound(character, tags = [unique('sonido')], scope = 'normal') {
        const sound: Sound = {
          id: unique('sound'),
          tags,
          characterId: character.id,
          backgroundId: null,
          mimeType: 'audio/ogg',
          createdAt: Date.now()
        }
        return putBinary('sounds', sound, scope, SOUND_BYTES)
      },
      async createStory(input) {
        const now = Date.now()
        const story: Story = {
          id: unique('story'),
          title: input.title ?? unique('Historia'),
          premise: input.premise ?? 'Planteamiento exclusivo para esta prueba.',
          visualMode: input.visualMode ?? false,
          autoGenerateImages: input.autoGenerateImages ?? false,
          protagonistPreferences: input.protagonistPreferences ?? '',
          protagonistPreferencesMode: input.protagonistPreferencesMode ?? 'append',
          characterIds: input.characters.map((character) => character.id),
          characterCustomizations: input.characters.map((character) => ({
            characterId: character.id,
            color: character.color,
            prompt: character.prompt,
            tags: [...character.tags]
          })),
          initialBackgroundId: input.background?.id ?? null,
          presetId: input.preset?.id ?? null,
          imageCatalogSnapshot: [],
          pendingImageInstructions: [],
          createdAt: now,
          updatedAt: now
        }
        return putJson('stories', story, input.scope ?? 'normal')
      },
      async createMessage(input) {
        const message: Message = {
          id: unique('message'),
          storyId: input.story.id,
          role: input.role,
          raw: input.raw,
          segments: input.segments ?? [],
          generationMode: input.generationMode,
          createdAt: Date.now() + sequence
        }
        return putJson('messages', message, input.scope ?? 'normal')
      },
      async patchSettings(patch) {
        const response = await request.patch('/api/settings', { data: patch })
        await assertOk(response)
        return response.json() as Promise<AppSettings>
      },
      async get<T>(resource, id, scope = 'normal') {
        const response = await request.get(resourceUrl(`${resource}/${id}`, scope))
        await expect(response).toBeOK()
        return response.json() as Promise<T>
      },
      async list<T>(resource, scope = 'normal', query = {}) {
        const response = await request.get(resourceUrl(resource, scope, query))
        await expect(response).toBeOK()
        return response.json() as Promise<T[]>
      }
    }

    await use(factory)
  }
})

export { expect }
