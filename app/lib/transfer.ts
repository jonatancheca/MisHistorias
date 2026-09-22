import { readImageGeneration } from '../../shared/utils/imageGeneration.ts'
import { readStorySwarmError } from '../../shared/utils/swarmError.ts'
import type {
  Character,
  ImageGenerationMetadata,
  SwarmPrompt,
  Message,
  Story,
  StoryCharacterCustomization,
  StorySaveSlot
} from '#shared/types'
import {
  getOriginalImageBlob,
  listBackgrounds,
  listAllImages,
  listCharacters,
  listMessages,
  listSounds,
  listSwarmPrompts,
  putSwarmPrompt,
  listStories,
  listStorySaves,
  newId,
  putBackground,
  putCharacter,
  putImage,
  putMessage,
  putSound,
  putStory,
  putStorySave,
  type StoredBackground,
  type StoredImage,
  type StoredSound
} from '~/lib/db'
import { blobToDataUrl, dataUrlToBlob } from '~/lib/images'
import { DEFAULT_CHARACTER_COLOR, normalizeColor } from '~/lib/colors'
import { nextAvailableTag, sanitizeTags, tagKey } from '~/lib/tags'
import { buildStoryImageCatalog } from '~/lib/imageCatalog'
import {
  activeStoryCharacterCustomizations,
  storyCustomizationIds
} from '~/lib/storyCharacterCustomizations'
import { filterSoundDirectives, stripSoundDirectives, stripSoundSegments } from '~/lib/soundTransfer'
import {
  exportCharacterTransferFields,
  importImageGenerationLora,
  importImageGenerationModel,
  importImageGenerationPromptPrefix,
  importImageGenerationPreset,
  importImageGenerationSeed
} from '~/lib/characterTransfer'

const EXPORT_VERSION = 24
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_SOUND_BYTES = 10 * 1024 * 1024

interface ExportedImage {
  id?: string
  tags?: string[]
  tag?: string
  isDefault: boolean
  dataUrl: string
  originalDataUrl?: string
  generation?: ImageGenerationMetadata
}

interface ExportedCharacter {
  id: string
  name: string
  prompt: string
  tags?: string[]
  color: string
  imageGenerationPreset?: string
  imageGenerationLora?: string
  imageGenerationSeed?: string
  imageGenerationPromptPrefix?: string
  imageGenerationModel?: string
  archived?: boolean
  visibleInDemo?: boolean
  images: ExportedImage[]
}

interface ExportedBackground {
  id: string
  tags?: string[]
  tag?: string
  style?: string
  description: string
  visibleInDemo?: boolean
  dataUrl: string
}

interface ExportedSound {
  id: string
  tags: string[]
  characterId: string | null
  backgroundId: string | null
  mimeType: string
  dataUrl: string
}

interface ExportedStory {
  title: string
  premise: string
  visualMode?: boolean
  archived?: boolean
  visibleInDemo?: boolean
  autoGenerateImages?: boolean
  protagonistPreferences?: string
  protagonistPreferencesMode?: 'append' | 'replace'
  characterIds: string[]
  characterCustomizations?: StoryCharacterCustomization[]
  pendingImageInstructions?: Story['pendingImageInstructions']
  contextSummary?: string
  contextSummaryThroughMessageId?: string
  initialBackgroundId?: string | null
  backgroundStyle?: string | null
  messages: Array<Pick<Message, 'id' | 'role' | 'raw' | 'segments' | 'generationMode' | 'swarmError' | 'createdAt'>>
  saves?: StorySaveSlot[]
}

interface ExportBundle {
  version: number
  exportedAt: number
  characters: ExportedCharacter[]
  backgrounds?: ExportedBackground[]
  sounds?: ExportedSound[]
  stories: ExportedStory[]
  swarmPrompts?: SwarmPrompt[]
}

export async function exportBundle(
  options: { demo?: boolean } = {}
): Promise<ExportBundle> {
  const [listedCharacters, listedImages, listedBackgrounds, listedStories, listedSounds, listedSwarmPrompts] = await Promise.all([
    listCharacters(),
    listAllImages(),
    listBackgrounds(),
    listStories(),
    listSounds(),
    listSwarmPrompts()
  ])
  const allCharacters = listedCharacters.filter((item) => !item.readOnly)
  const images = listedImages.filter((item) => !item.readOnly)
  const allBackgrounds = listedBackgrounds.filter((item) => !item.readOnly)
  const allStories = listedStories.filter((item) => !item.readOnly)
  const sounds = listedSounds.filter((item) => !item.readOnly)
  const swarmPrompts = listedSwarmPrompts.filter((item) => !item.readOnly)

  const storyRecords = await Promise.all(
    allStories
      .filter((story) => !options.demo || story.visibleInDemo)
      .map(async (story) => ({
        story,
        messages: await listMessages(story.id),
        saves: await listStorySaves(story.id)
      }))
  )
  const includedCharacterIds = new Set(
    options.demo
      ? allCharacters.filter((character) => character.visibleInDemo).map((character) => character.id)
      : allCharacters.map((character) => character.id)
  )
  const includedBackgroundIds = new Set(
    options.demo
      ? allBackgrounds.filter((background) => background.visibleInDemo).map((background) => background.id)
      : allBackgrounds.map((background) => background.id)
  )
  for (const { story, messages, saves } of storyRecords) {
    story.characterIds.forEach((id) => includedCharacterIds.add(id))
    if (story.initialBackgroundId) includedBackgroundIds.add(story.initialBackgroundId)
    messages.forEach((message) => message.segments.forEach((segment) => {
      if (segment.characterId) includedCharacterIds.add(segment.characterId)
      if (segment.backgroundId) includedBackgroundIds.add(segment.backgroundId)
    }))
    saves.forEach((save) => {
      save.story.characterIds.forEach((id) => includedCharacterIds.add(id))
      if (save.story.initialBackgroundId) includedBackgroundIds.add(save.story.initialBackgroundId)
      save.messages.forEach((message) => message.segments.forEach((segment) => {
        if (segment.characterId) includedCharacterIds.add(segment.characterId)
        if (segment.backgroundId) includedBackgroundIds.add(segment.backgroundId)
      }))
    })
  }

  const characters = allCharacters.filter((character) => includedCharacterIds.has(character.id))
  const backgrounds = allBackgrounds.filter((background) => includedBackgroundIds.has(background.id))
  const includedSounds = sounds.filter((sound) =>
    !options.demo ||
    Boolean(sound.characterId && includedCharacterIds.has(sound.characterId)) ||
    Boolean(sound.backgroundId && includedBackgroundIds.has(sound.backgroundId))
  )
  const includedSoundIds = new Set(includedSounds.map((sound) => sound.id))
  const includedSoundTags = new Set(
    includedSounds.flatMap((sound) => sound.tags.map((tag) => tag.trim().toLocaleLowerCase()))
  )
  const exportMessages = (messages: Message[]) => messages.map((message) => ({
    id: message.id,
    role: message.role,
    raw: options.demo
      ? filterSoundDirectives(message.raw, includedSoundTags)
      : message.raw,
    segments: options.demo
      ? message.segments.filter(
          (segment) => segment.type !== 'sound' || Boolean(segment.soundId && includedSoundIds.has(segment.soundId))
        )
      : message.segments,
    generationMode: message.generationMode,
    swarmError: options.demo ? undefined : readStorySwarmError(message.swarmError),
    createdAt: message.createdAt
  }))

  const exportCharacterCustomizations = (story: Story) => {
    if (!options.demo) return story.characterCustomizations
    return activeStoryCharacterCustomizations(story.characterIds, story.characterCustomizations)
  }

  const exportedCharacters: ExportedCharacter[] = await Promise.all(
    characters.map(async (character) => ({
      ...exportCharacterTransferFields(character),
      images: await Promise.all(
        images
          .filter((image) => image.characterId === character.id)
          .map(async (image) => ({
            id: image.id,
            tags: image.tags,
            isDefault: image.isDefault,
            generation: image.generation,
            dataUrl: await blobToDataUrl(image.blob),
            originalDataUrl: image.hasOriginal
              ? await blobToDataUrl(await getOriginalImageBlob(image.id))
              : undefined
          }))
      )
    }))
  )

  const exportedStories: ExportedStory[] = await Promise.all(
    storyRecords.map(async ({ story, messages, saves }) => ({
      title: story.title,
      premise: story.premise,
      visualMode: story.visualMode,
      archived: story.archived,
      visibleInDemo: story.visibleInDemo,
      autoGenerateImages: story.autoGenerateImages === true,
      protagonistPreferences: story.protagonistPreferences ?? '',
      protagonistPreferencesMode: story.protagonistPreferencesMode ?? 'append',
      characterIds: story.characterIds,
      characterCustomizations: exportCharacterCustomizations(story),
      pendingImageInstructions: story.pendingImageInstructions ?? [],
      contextSummary: story.contextSummary ?? '',
      contextSummaryThroughMessageId: story.contextSummaryThroughMessageId,
      initialBackgroundId: story.initialBackgroundId ?? null,
      backgroundStyle: story.backgroundStyle ?? null,
      messages: exportMessages(messages),
      saves: saves.map((save) => ({
        ...save,
        story: options.demo
          ? {
              ...save.story,
              presetId: null,
              characterCustomizations: exportCharacterCustomizations(save.story)
            }
          : save.story,
        messages: exportMessages(save.messages),
        debugTraces: options.demo ? [] : save.debugTraces
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
        style: background.style ?? '',
        description: background.description,
        visibleInDemo: background.visibleInDemo,
        dataUrl: await blobToDataUrl(background.blob)
      }))
    ),
    sounds: await Promise.all(includedSounds.map(async (sound) => ({
      id: sound.id,
      tags: sound.tags,
      characterId: sound.characterId,
      backgroundId: sound.backgroundId,
      mimeType: sound.mimeType,
      dataUrl: await blobToDataUrl(sound.blob)
    }))),
    stories: exportedStories,
    swarmPrompts: options.demo ? [] : swarmPrompts
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
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, EXPORT_VERSION].includes(bundle.version)) {
    throw new Error('Versión de exportación no compatible')
  }
  if (bundle.swarmPrompts !== undefined && (!Array.isArray(bundle.swarmPrompts) || bundle.swarmPrompts.some((item) =>
    !item || typeof item.name !== 'string' || !item.name.trim() || typeof item.prompt !== 'string' || !item.prompt.trim() ||
    !Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')))) throw new Error('Prompts SwarmUI no válidos')
  if (!Array.isArray(bundle.characters) || !Array.isArray(bundle.stories)) {
    throw new Error('Fichero incompleto')
  }
  if (bundle.sounds !== undefined && (!Array.isArray(bundle.sounds) || bundle.sounds.some((item) =>
    !item || typeof item.id !== 'string' || !Array.isArray(item.tags) ||
    item.tags.some((tag) => typeof tag !== 'string') || typeof item.dataUrl !== 'string'))) {
    throw new Error('Sonidos no válidos')
  }
}

export async function importBundle(raw: string) {
  const parsed: unknown = JSON.parse(raw)
  assertBundle(parsed)
  const now = Date.now()

  for (const [index, item] of (parsed.swarmPrompts ?? []).entries()) {
    await putSwarmPrompt({ id: newId(), name: item.name.trim(), prompt: item.prompt.trim(),
      tags: sanitizeTags(item.tags), createdAt: now + index, updatedAt: now + index })
  }
  const characterIdMap = new Map<string, string>()
  function importSwarmError(value: unknown) {
    const error = readStorySwarmError(value)
    return error ? { ...error, characterId: characterIdMap.get(error.characterId) ?? error.characterId } : undefined
  }
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
      imageGenerationPreset: importImageGenerationPreset(item.imageGenerationPreset),
      imageGenerationLora: importImageGenerationLora(item.imageGenerationLora),
      imageGenerationSeed: importImageGenerationSeed(item.imageGenerationSeed),
      imageGenerationPromptPrefix: importImageGenerationPromptPrefix(
        item.imageGenerationPromptPrefix
      ),
      imageGenerationModel: importImageGenerationModel(item.imageGenerationModel),
      archived: item.archived === true,
      visibleInDemo: item.visibleInDemo === true,
      createdAt: now,
      updatedAt: now
    }
    characterIdMap.set(String(item.id), character.id)
    importedCharacters.push(character)
    await putCharacter(character)

    for (const [position, image] of (item.images ?? []).entries()) {
      if (typeof image.dataUrl !== 'string' || image.dataUrl.length > MAX_IMAGE_BYTES * 1.4) continue
      const blob = await dataUrlToBlob(image.dataUrl)
      if (blob.size > MAX_IMAGE_BYTES) continue
      let originalBlob: Blob | undefined
      if (image.originalDataUrl !== undefined) {
        if (typeof image.originalDataUrl !== 'string' || image.originalDataUrl.length > MAX_IMAGE_BYTES * 1.4) {
          throw new Error('Imagen original no válida o demasiado grande.')
        }
        originalBlob = await dataUrlToBlob(image.originalDataUrl)
        if (!originalBlob.size || originalBlob.size > MAX_IMAGE_BYTES) {
          throw new Error('Imagen original vacía o demasiado grande.')
        }
      }
      const stored: StoredImage = {
        id: newId(),
        characterId: character.id,
        position,
        tags: sanitizeTags(image.tags, image.tag, 'neutral'),
        isDefault: Boolean(image.isDefault),
        generation: readImageGeneration(image.generation),
        mimeType: blob.type || 'image/webp',
        createdAt: now,
        blob,
        originalBlob
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
      style: String(item.style ?? '').trim(),
      description: String(item.description ?? ''),
      mimeType: blob.type || 'image/webp',
      visibleInDemo: item.visibleInDemo === true,
      createdAt: now,
      blob
    }
    backgroundIdMap.set(String(item.id), background.id)
    backgroundTagMap.set(String(item.id), background.tags[0]!)
    await putBackground(background)
  }

  const soundIdMap = new Map<string, string>()
  const soundTagMap = new Map<string, string>()
  const usedSoundTags = new Set(
    (await listSounds()).flatMap((sound) => sound.tags).map(tagKey)
  )
  for (const item of parsed.sounds ?? []) {
    if (typeof item.dataUrl !== 'string' || item.dataUrl.length > MAX_SOUND_BYTES * 1.4) continue
    const blob = await dataUrlToBlob(item.dataUrl)
    if (!blob.size || blob.size > MAX_SOUND_BYTES) continue
    const characterId = item.characterId
      ? (characterIdMap.get(String(item.characterId)) ?? null)
      : null
    const backgroundId = item.backgroundId
      ? (backgroundIdMap.get(String(item.backgroundId)) ?? null)
      : null
    if ((item.characterId && !characterId) || (item.backgroundId && !backgroundId)) continue
    const sourceTags = sanitizeTags(item.tags)
    if (!sourceTags.length) continue
    const importedTags = sourceTags.map((baseTag) => {
      const uniqueTag = nextAvailableTag(baseTag, usedSoundTags)
      usedSoundTags.add(tagKey(uniqueTag))
      soundTagMap.set(tagKey(baseTag), uniqueTag)
      return uniqueTag
    })
    const sound: StoredSound = {
      id: newId(),
      tags: importedTags,
      characterId,
      backgroundId,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : blob.type || 'audio/ogg',
      createdAt: now,
      blob
    }
    soundIdMap.set(String(item.id), sound.id)
    await putSound(sound)
  }

  const importRaw = (raw: unknown) => {
    const value = String(raw ?? '')
    if (parsed.version < 23) return stripSoundDirectives(value)
    return value
      .split('\n')
      .flatMap((line) => {
        const match = line.match(/^(\s*Sonido\s*\[)([^\]\n]{1,80})(\]\s*:.*)$/i)
        if (!match) return [line]
        const tag = soundTagMap.get(tagKey(match[2]!))
        return tag ? [`${match[1]}${tag}${match[3]}`] : []
      })
      .join('\n')
  }
  const importSegments = (segments: Message['segments']) => {
    if (parsed.version < 23) return stripSoundSegments(segments)
    return segments.flatMap((segment) => {
      if (segment.type !== 'sound') return [segment]
      const soundId = segment.soundId ? soundIdMap.get(String(segment.soundId)) : undefined
      if (!soundId) return []
      return [{
        ...segment,
        soundId,
        tag: segment.tag ? (soundTagMap.get(tagKey(segment.tag)) ?? segment.tag) : segment.tag
      }]
    })
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
    const customizationSourceIds = storyCustomizationIds(
      (item.characterIds ?? []).map((sourceId) => String(sourceId)),
      item.characterCustomizations ?? []
    )
    const characterCustomizations = customizationSourceIds.flatMap((sourceId: string) => {
      const characterId = characterIdMap.get(String(sourceId))
      if (!characterId) return []
      const source = exportedCustomizations.get(String(sourceId))
      const character = importedCharacters.find((candidate) => candidate.id === characterId)
      if (!source && !character) return []
      return [
        {
          characterId,
          name: String(source?.name ?? character?.name ?? '').trim() || String(character?.name ?? ''),
          color: normalizeColor(source?.color, character?.color ?? DEFAULT_CHARACTER_COLOR),
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
      archived: item.archived === true,
      visibleInDemo: item.visibleInDemo === true,
      autoGenerateImages: item.autoGenerateImages === true,
      protagonistPreferences: String(item.protagonistPreferences ?? ''),
      protagonistPreferencesMode:
        item.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
      characterIds: storyCharacterIds,
      characterCustomizations,
      pendingImageInstructions: (item.pendingImageInstructions ?? []).flatMap((instruction) => {
        const characterId = characterIdMap.get(String(instruction.characterId))
        const imageId = imageIdMap.get(String(instruction.imageId))
        if (!characterId || !imageId) return []
        return [{ characterId, imageId, tags: sanitizeTags(instruction.tags) }]
      }),
      initialBackgroundId: item.initialBackgroundId
        ? (backgroundIdMap.get(String(item.initialBackgroundId)) ?? null)
        : null,
      backgroundStyle: String(item.backgroundStyle ?? '').trim() || null,
      imageCatalogSnapshot: buildStoryImageCatalog(
        storyCharacterIds,
        importedCharacters,
        importedImages
      ),
      contextSummary: String(item.contextSummary ?? ''),
      createdAt: now,
      updatedAt: now
    }
    await putStory(story)

    const messageIdMap = new Map<string, string>()
    for (const message of item.messages ?? []) {
      const stored: Message = {
        id: newId(),
        storyId: story.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        raw: importRaw(message.raw),
        swarmError: importSwarmError(message.swarmError),
        generationMode:
          message.generationMode === 'continue' || message.generationMode === 'auto'
            ? message.generationMode
            : 'normal',
        segments: importSegments(message.segments ?? []).map((segment) => ({
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
      if (message.id) messageIdMap.set(String(message.id), stored.id)
      await putMessage(stored)
    }
    const summaryThroughId = item.contextSummaryThroughMessageId
      ? messageIdMap.get(String(item.contextSummaryThroughMessageId))
      : undefined
    if (story.contextSummary && summaryThroughId) {
      story.contextSummaryThroughMessageId = summaryThroughId
      await putStory(story)
    }

    for (const save of item.saves ?? []) {
      if (
        typeof save.thumbnailDataUrl !== 'string' ||
        !save.thumbnailDataUrl.startsWith('data:image/webp;base64,')
      ) continue
      const savedCharacterIds = (save.story.characterIds ?? [])
        .map((id) => characterIdMap.get(String(id)))
        .filter((id): id is string => Boolean(id))
      const savedCustomizations = new Map(
        (save.story.characterCustomizations ?? []).map((customization) => [
          String(customization.characterId),
          customization
        ])
      )
      const storySnapshot: Story = {
        ...story,
        title: String(save.story.title ?? story.title),
        premise: String(save.story.premise ?? story.premise),
        visualMode: save.story.visualMode === true,
        visibleInDemo: save.story.visibleInDemo === true,
        autoGenerateImages: save.story.autoGenerateImages === true,
        protagonistPreferences: String(save.story.protagonistPreferences ?? ''),
        protagonistPreferencesMode:
          save.story.protagonistPreferencesMode === 'replace' ? 'replace' : 'append',
        characterIds: savedCharacterIds,
        characterCustomizations: storyCustomizationIds(
          (save.story.characterIds ?? []).map((sourceId) => String(sourceId)),
          save.story.characterCustomizations ?? []
        ).flatMap((sourceId) => {
          const characterId = characterIdMap.get(String(sourceId))
          if (!characterId) return []
          const source = savedCustomizations.get(String(sourceId))
          const character = importedCharacters.find((candidate) => candidate.id === characterId)
          return [{
            characterId,
            name: String(source?.name ?? character?.name ?? '').trim() || String(character?.name ?? ''),
            color: normalizeColor(source?.color, character?.color ?? DEFAULT_CHARACTER_COLOR),
            prompt: String(source?.prompt ?? character?.prompt ?? ''),
            tags: sanitizeTags(source?.tags ?? character?.tags)
          }]
        }),
        pendingImageInstructions: (save.story.pendingImageInstructions ?? []).flatMap(
          (instruction) => {
            const characterId = characterIdMap.get(String(instruction.characterId))
            const imageId = imageIdMap.get(String(instruction.imageId))
            return characterId && imageId
              ? [{ characterId, imageId, tags: sanitizeTags(instruction.tags) }]
              : []
          }
        ),
        initialBackgroundId: save.story.initialBackgroundId
          ? (backgroundIdMap.get(String(save.story.initialBackgroundId)) ?? null)
          : null,
        backgroundStyle: String(save.story.backgroundStyle ?? '').trim() || null,
        imageCatalogSnapshot: buildStoryImageCatalog(
          savedCharacterIds,
          importedCharacters,
          importedImages
        ),
        contextSummary: String(save.story.contextSummary ?? ''),
        createdAt: story.createdAt,
        updatedAt: Number(save.story.updatedAt) || story.updatedAt
      }

      const messageIdMap = new Map<string, string>()
      const savedMessages: Message[] = (save.messages ?? []).map((message) => {
        const id = newId()
        messageIdMap.set(String(message.id), id)
        return {
          id,
          storyId: story.id,
          role: message.role === 'assistant' ? 'assistant' : 'user',
          raw: importRaw(message.raw),
          swarmError: importSwarmError(message.swarmError),
          generationMode:
            message.generationMode === 'continue' || message.generationMode === 'auto'
              ? message.generationMode
              : 'normal',
          segments: importSegments(message.segments ?? []).map((segment) => ({
            ...segment,
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
      })
      const debugTraces = (save.debugTraces ?? []).map((trace) => ({
        ...trace,
        id: newId(),
        storyId: story.id,
        requestMessageId: trace.requestMessageId
          ? messageIdMap.get(String(trace.requestMessageId))
          : undefined,
        responseMessageId: trace.responseMessageId
          ? messageIdMap.get(String(trace.responseMessageId))
          : undefined
      }))
      if (storySnapshot.contextSummary && save.story.contextSummaryThroughMessageId) {
        storySnapshot.contextSummaryThroughMessageId = messageIdMap.get(
          String(save.story.contextSummaryThroughMessageId)
        )
      }
      await putStorySave({
        id: newId(),
        storyId: story.id,
        name: String(save.name ?? 'Partida importada'),
        story: storySnapshot,
        messages: savedMessages,
        debugTraces,
        thumbnailDataUrl: save.thumbnailDataUrl,
        createdAt: Number(save.createdAt) || now
      })
    }
  }
}
