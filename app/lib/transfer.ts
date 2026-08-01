import type { Character, Message, PromptPreset, Story } from '#shared/types'
import {
  listAllImages,
  listCharacters,
  listMessages,
  listPresets,
  listStories,
  newId,
  putCharacter,
  putImage,
  putMessage,
  putPreset,
  putStory,
  type StoredImage
} from '~/lib/db'
import { blobToDataUrl, dataUrlToBlob } from '~/lib/images'
import { DEFAULT_CHARACTER_COLOR, normalizeColor } from '~/lib/colors'

const EXPORT_VERSION = 2
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface ExportedImage {
  tag: string
  description: string
  isDefault: boolean
  dataUrl: string
}

interface ExportedCharacter {
  id: string
  name: string
  prompt: string
  color: string
  images: ExportedImage[]
}

interface ExportedStory {
  title: string
  premise: string
  protagonistPreferences?: string
  protagonistPreferencesMode?: 'append' | 'replace'
  characterIds: string[]
  presetId: string | null
  messages: Array<Pick<Message, 'role' | 'raw' | 'segments' | 'createdAt'>>
}

interface ExportBundle {
  version: number
  exportedAt: number
  characters: ExportedCharacter[]
  stories: ExportedStory[]
  presets: Array<Pick<PromptPreset, 'id' | 'name' | 'content'>>
}

export async function exportBundle(): Promise<ExportBundle> {
  const [characters, images, stories, presets] = await Promise.all([
    listCharacters(),
    listAllImages(),
    listStories(),
    listPresets()
  ])

  const exportedCharacters: ExportedCharacter[] = await Promise.all(
    characters.map(async (character) => ({
      id: character.id,
      name: character.name,
      prompt: character.prompt,
      color: character.color,
      images: await Promise.all(
        images
          .filter((image) => image.characterId === character.id)
          .map(async (image) => ({
            tag: image.tag,
            description: image.description,
            isDefault: image.isDefault,
            dataUrl: await blobToDataUrl(image.blob)
          }))
      )
    }))
  )

  const exportedStories: ExportedStory[] = await Promise.all(
    stories.map(async (story) => ({
      title: story.title,
      premise: story.premise,
      protagonistPreferences: story.protagonistPreferences ?? '',
      protagonistPreferencesMode: story.protagonistPreferencesMode ?? 'append',
      characterIds: story.characterIds,
      presetId: story.presetId,
      messages: (await listMessages(story.id)).map((message) => ({
        role: message.role,
        raw: message.raw,
        segments: message.segments,
        createdAt: message.createdAt
      }))
    }))
  )

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    characters: exportedCharacters,
    stories: exportedStories,
    presets: presets.map((preset) => ({ id: preset.id, name: preset.name, content: preset.content }))
  }
}

export function downloadBundle(bundle: ExportBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `local-chat-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function assertBundle(value: unknown): asserts value is ExportBundle {
  const bundle = value as ExportBundle
  if (!bundle || typeof bundle !== 'object') throw new Error('Fichero no válido')
  if (bundle.version !== 1 && bundle.version !== EXPORT_VERSION) {
    throw new Error('Versión de exportación no compatible')
  }
  if (!Array.isArray(bundle.characters) || !Array.isArray(bundle.stories)) {
    throw new Error('Fichero incompleto')
  }
}

export async function importBundle(raw: string) {
  const parsed: unknown = JSON.parse(raw)
  assertBundle(parsed)
  const now = Date.now()

  const presetIdMap = new Map<string, string>()
  for (const preset of parsed.presets ?? []) {
    const created: PromptPreset = {
      id: newId(),
      name: String(preset.name ?? 'Importado'),
      content: String(preset.content ?? ''),
      createdAt: now,
      updatedAt: now
    }
    presetIdMap.set(String(preset.id), created.id)
    await putPreset(created)
  }

  const characterIdMap = new Map<string, string>()
  for (const item of parsed.characters) {
    const character: Character = {
      id: newId(),
      name: String(item.name ?? 'Sin nombre'),
      prompt: String(item.prompt ?? ''),
      color: normalizeColor(item.color, DEFAULT_CHARACTER_COLOR),
      createdAt: now,
      updatedAt: now
    }
    characterIdMap.set(String(item.id), character.id)
    await putCharacter(character)

    for (const image of item.images ?? []) {
      if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_IMAGE_BYTES * 1.4) continue
      const blob = await dataUrlToBlob(image.dataUrl)
      if (blob.size > MAX_IMAGE_BYTES) continue
      const stored: StoredImage = {
        id: newId(),
        characterId: character.id,
        tag: String(image.tag ?? 'neutral'),
        description: String(image.description ?? ''),
        isDefault: Boolean(image.isDefault),
        mimeType: blob.type || 'image/webp',
        createdAt: now,
        blob
      }
      await putImage(stored)
    }
  }

  for (const item of parsed.stories) {
    const story: Story = {
      id: newId(),
      title: String(item.title ?? 'Historia importada'),
      premise: String(item.premise ?? ''),
      protagonistPreferences: String(item.protagonistPreferences ?? ''),
      protagonistPreferencesMode:
        item.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
      characterIds: (item.characterIds ?? [])
        .map((id: string) => characterIdMap.get(String(id)))
        .filter((id): id is string => Boolean(id)),
      presetId: item.presetId ? (presetIdMap.get(String(item.presetId)) ?? null) : null,
      createdAt: now,
      updatedAt: now
    }
    await putStory(story)

    for (const message of item.messages ?? []) {
      const stored: Message = {
        id: newId(),
        storyId: story.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        raw: String(message.raw ?? ''),
        segments: (message.segments ?? []).map((segment) => ({
          ...segment,
          characterId: segment.characterId
            ? (characterIdMap.get(String(segment.characterId)) ?? null)
            : null
        })),
        createdAt: Number(message.createdAt) || now
      }
      await putMessage(stored)
    }
  }
}
