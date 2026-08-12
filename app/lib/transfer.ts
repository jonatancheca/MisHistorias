import type {
  Character,
  Message,
  PromptPreset,
  Story,
  StoryCharacterCustomization
} from '#shared/types'
import {
  listBackgrounds,
  listAllImages,
  listCharacters,
  listMessages,
  listPresets,
  listStories,
  newId,
  putBackground,
  putCharacter,
  putImage,
  putMessage,
  putPreset,
  putStory,
  type StoredBackground,
  type StoredImage
} from '~/lib/db'
import { blobToDataUrl, dataUrlToBlob } from '~/lib/images'
import { DEFAULT_CHARACTER_COLOR, normalizeColor } from '~/lib/colors'
import { nextAvailableTag, sanitizeTags, tagKey } from '~/lib/tags'
import { buildStoryImageCatalog } from '~/lib/imageCatalog'

const EXPORT_VERSION = 10
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

interface ExportedImage {
  id?: string
  tags?: string[]
  tag?: string
  description: string
  isDefault: boolean
  dataUrl: string
}

interface ExportedCharacter {
  id: string
  name: string
  prompt: string
  tags?: string[]
  color: string
  images: ExportedImage[]
}

interface ExportedBackground {
  id: string
  tags?: string[]
  tag?: string
  description: string
  dataUrl: string
}

interface ExportedStory {
  title: string
  premise: string
  visualMode?: boolean
  protagonistPreferences?: string
  protagonistPreferencesMode?: 'append' | 'replace'
  characterIds: string[]
  characterCustomizations?: StoryCharacterCustomization[]
  initialBackgroundId?: string | null
  presetId: string | null
  messages: Array<Pick<Message, 'role' | 'raw' | 'segments' | 'generationMode' | 'createdAt'>>
}

interface ExportBundle {
  version: number
  exportedAt: number
  characters: ExportedCharacter[]
  backgrounds?: ExportedBackground[]
  stories: ExportedStory[]
  presets: Array<Pick<PromptPreset, 'id' | 'name' | 'content'>>
}

export async function exportBundle(): Promise<ExportBundle> {
  const [characters, images, backgrounds, stories, presets] = await Promise.all([
    listCharacters(),
    listAllImages(),
    listBackgrounds(),
    listStories(),
    listPresets()
  ])

  const exportedCharacters: ExportedCharacter[] = await Promise.all(
    characters.map(async (character) => ({
      id: character.id,
      name: character.name,
      prompt: character.prompt,
      tags: character.tags,
      color: character.color,
      images: await Promise.all(
        images
          .filter((image) => image.characterId === character.id)
          .map(async (image) => ({
            id: image.id,
            tags: image.tags,
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
      visualMode: story.visualMode,
      protagonistPreferences: story.protagonistPreferences ?? '',
      protagonistPreferencesMode: story.protagonistPreferencesMode ?? 'append',
      characterIds: story.characterIds,
      characterCustomizations: story.characterCustomizations,
      initialBackgroundId: story.initialBackgroundId ?? null,
      presetId: story.presetId,
      messages: (await listMessages(story.id)).map((message) => ({
        role: message.role,
        raw: message.raw,
        segments: message.segments,
        generationMode: message.generationMode,
        createdAt: message.createdAt
      }))
    }))
  )

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    characters: exportedCharacters,
    backgrounds: await Promise.all(
      backgrounds.map(async (background) => ({
        id: background.id,
        tags: background.tags,
        description: background.description,
        dataUrl: await blobToDataUrl(background.blob)
      }))
    ),
    stories: exportedStories,
    presets: presets.map((preset) => ({ id: preset.id, name: preset.name, content: preset.content }))
  }
}

export function downloadBundle(bundle: ExportBundle) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `mis-historias-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function assertBundle(value: unknown): asserts value is ExportBundle {
  const bundle = value as ExportBundle
  if (!bundle || typeof bundle !== 'object') throw new Error('Fichero no válido')
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, EXPORT_VERSION].includes(bundle.version)) {
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
  const imageIdMap = new Map<string, string>()
  const importedCharacters: Character[] = []
  const importedImages: StoredImage[] = []
  for (const item of parsed.characters) {
    const character: Character = {
      id: newId(),
      name: String(item.name ?? 'Sin nombre'),
      prompt: String(item.prompt ?? ''),
      tags: sanitizeTags(item.tags),
      color: normalizeColor(item.color, DEFAULT_CHARACTER_COLOR),
      createdAt: now,
      updatedAt: now
    }
    characterIdMap.set(String(item.id), character.id)
    importedCharacters.push(character)
    await putCharacter(character)

    for (const image of item.images ?? []) {
      if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_IMAGE_BYTES * 1.4) continue
      const blob = await dataUrlToBlob(image.dataUrl)
      if (blob.size > MAX_IMAGE_BYTES) continue
      const stored: StoredImage = {
        id: newId(),
        characterId: character.id,
        tags: sanitizeTags(image.tags, image.tag, 'neutral'),
        description: String(image.description ?? ''),
        isDefault: Boolean(image.isDefault),
        mimeType: blob.type || 'image/webp',
        createdAt: now,
        blob
      }
      importedImages.push(stored)
      if (image.id) imageIdMap.set(String(image.id), stored.id)
      await putImage(stored)
    }
  }

  const backgroundIdMap = new Map<string, string>()
  const backgroundTagMap = new Map<string, string>()
  const usedBackgroundTags = new Set(
    (await listBackgrounds()).flatMap((background) => background.tags).map(tagKey)
  )
  for (const item of parsed.backgrounds ?? []) {
    if (typeof item.dataUrl !== 'string' || item.dataUrl.length > MAX_IMAGE_BYTES * 1.4) continue
    const blob = await dataUrlToBlob(item.dataUrl)
    if (blob.size > MAX_IMAGE_BYTES) continue
    const requestedTags = sanitizeTags(item.tags, item.tag)
    if (requestedTags.length === 0) requestedTags.push('neutral')
    const uniqueTags = requestedTags.map((baseTag) => {
      const uniqueTag = nextAvailableTag(baseTag, usedBackgroundTags)
      usedBackgroundTags.add(tagKey(uniqueTag))
      return uniqueTag
    })
    const background: StoredBackground = {
      id: newId(),
      tags: uniqueTags,
      description: String(item.description ?? ''),
      mimeType: blob.type || 'image/webp',
      createdAt: now,
      blob
    }
    backgroundIdMap.set(String(item.id), background.id)
    backgroundTagMap.set(String(item.id), background.tags[0]!)
    await putBackground(background)
  }

  for (const item of parsed.stories) {
    const storyCharacterIds = (item.characterIds ?? [])
      .map((id: string) => characterIdMap.get(String(id)))
      .filter((id): id is string => Boolean(id))
    const exportedCustomizations = new Map(
      (item.characterCustomizations ?? []).map((customization) => [
        String(customization.characterId),
        customization
      ])
    )
    const characterCustomizations = (item.characterIds ?? []).flatMap((sourceId: string) => {
      const characterId = characterIdMap.get(String(sourceId))
      if (!characterId) return []
      const source = exportedCustomizations.get(String(sourceId))
      const character = importedCharacters.find((candidate) => candidate.id === characterId)
      if (!source && !character) return []
      return [
        {
          characterId,
          prompt: String(source?.prompt ?? character?.prompt ?? ''),
          tags: sanitizeTags(source?.tags ?? character?.tags)
        }
      ]
    })
    const story: Story = {
      id: newId(),
      title: String(item.title ?? 'Historia importada'),
      premise: String(item.premise ?? ''),
      visualMode: item.visualMode === true,
      protagonistPreferences: String(item.protagonistPreferences ?? ''),
      protagonistPreferencesMode:
        item.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
      characterIds: storyCharacterIds,
      characterCustomizations,
      initialBackgroundId: item.initialBackgroundId
        ? (backgroundIdMap.get(String(item.initialBackgroundId)) ?? null)
        : null,
      presetId: item.presetId ? (presetIdMap.get(String(item.presetId)) ?? null) : null,
      imageCatalogSnapshot: buildStoryImageCatalog(
        storyCharacterIds,
        importedCharacters,
        importedImages
      ),
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
        generationMode:
          message.generationMode === 'continue' || message.generationMode === 'auto'
            ? message.generationMode
            : 'normal',
        segments: (message.segments ?? []).map((segment) => ({
          ...segment,
          tags:
            segment.type === 'dialogue'
              ? sanitizeTags(segment.tags, segment.tag)
              : undefined,
          tag:
            segment.type === 'background' && segment.backgroundId
              ? (backgroundTagMap.get(String(segment.backgroundId)) ?? segment.tag)
              : segment.tag,
          characterId: segment.characterId
            ? (characterIdMap.get(String(segment.characterId)) ?? null)
            : null,
          backgroundId: segment.backgroundId
            ? (backgroundIdMap.get(String(segment.backgroundId)) ?? null)
            : segment.type === 'background'
              ? null
              : undefined,
          imageId: segment.imageId
            ? (imageIdMap.get(String(segment.imageId)) ?? null)
            : segment.imageId === null
              ? null
              : undefined
        })),
        createdAt: Number(message.createdAt) || now
      }
      await putMessage(stored)
    }
  }
}
