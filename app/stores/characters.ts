import { defineStore } from 'pinia'
import type { Character } from '#shared/types'
import {
  copyCharacter as copyStoredCharacter,
  deleteCharacter,
  deleteImage,
  importCharacterArchive as importStoredCharacterArchive,
  listAllImages,
  listCharacters,
  newId,
  putCharacter,
  putImage,
  type StoredImage
} from '~/lib/db'
import type { ImportedCharacterArchive } from '~/lib/characterArchive'
import { normalizeImage } from '~/lib/images'
import { sanitizeTags } from '~/lib/tags'
import { DEFAULT_CHARACTER_COLOR, normalizeColor, pickColor } from '~/lib/colors'
import {
  selectCharacterImage,
  type RequestedImageTags
} from '~/lib/imageSelection'

export const useCharactersStore = defineStore('characters', () => {
  const characters = ref<Character[]>([])
  const images = ref<StoredImage[]>([])
  const urls = ref<Record<string, string>>({})
  const loaded = ref(false)

  function syncUrls() {
    const next: Record<string, string> = {}
    for (const image of images.value) {
      next[image.id] = urls.value[image.id] ?? URL.createObjectURL(image.blob)
    }
    for (const [id, url] of Object.entries(urls.value)) {
      if (!next[id]) URL.revokeObjectURL(url)
    }
    urls.value = next
  }

  function resetForScope() {
    characters.value = []
    images.value = []
    loaded.value = false
    syncUrls()
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const [chars, imgs] = await Promise.all([listCharacters(), listAllImages()])
    characters.value = chars
    images.value = imgs.sort((a, b) => a.createdAt - b.createdAt)
    syncUrls()
    loaded.value = true
  }

  function byId(id: string) {
    return characters.value.find((character) => character.id === id) ?? null
  }

  /** Color del personaje, con fallback para fichas antiguas sin color. */
  function colorOf(id: string | null | undefined) {
    if (!id) return DEFAULT_CHARACTER_COLOR
    return normalizeColor(byId(id)?.color, DEFAULT_CHARACTER_COLOR)
  }

  function imagesFor(characterId: string) {
    return images.value.filter((image) => image.characterId === characterId)
  }

  function defaultImage(characterId: string) {
    const own = imagesFor(characterId)
    return own.find((image) => image.isDefault) ?? own[0] ?? null
  }

  /** Resuelve la imagen a mostrar para una etiqueta emitida por el modelo. */
  function resolveImage(
    characterId: string,
    requestedTags: RequestedImageTags,
    preferredImageId?: string | null,
    selectionSeed = '',
    forcePreferred = false
  ) {
    const own = imagesFor(characterId)
    if (forcePreferred && preferredImageId) {
      const preferred = own.find((image) => image.id === preferredImageId)
      if (preferred) return preferred
    }
    return selectCharacterImage(
      own,
      characterId,
      requestedTags,
      selectionSeed,
      preferredImageId
    )
  }

  function urlFor(imageId: string | null | undefined) {
    if (!imageId) return null
    return urls.value[imageId] ?? null
  }

  async function saveCharacter(input: {
    id?: string
    name: string
    prompt: string
    tags: string[]
    color?: string
    imageGenerationPreset?: string
    imageGenerationLora?: string
    imageGenerationSeed?: string
    imageGenerationPromptPrefix?: string
  }) {
    const now = Date.now()
    const existing = input.id ? byId(input.id) : null
    const character: Character = {
      id: existing?.id ?? input.id ?? newId(),
      name: input.name.trim(),
      prompt: input.prompt,
      tags: sanitizeTags(input.tags),
      color: normalizeColor(
        input.color ?? existing?.color,
        existing?.color ?? pickColor(characters.value.length)
      ),
      imageGenerationPreset:
        input.imageGenerationPreset ?? existing?.imageGenerationPreset ?? '',
      imageGenerationLora:
        input.imageGenerationLora ?? existing?.imageGenerationLora ?? '',
      imageGenerationSeed:
        input.imageGenerationSeed ?? existing?.imageGenerationSeed ?? '',
      imageGenerationPromptPrefix:
        input.imageGenerationPromptPrefix ?? existing?.imageGenerationPromptPrefix ?? '',
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    await putCharacter(character)
    const index = characters.value.findIndex((item) => item.id === character.id)
    if (index >= 0) characters.value[index] = character
    else characters.value.push(character)
    characters.value.sort((a, b) => a.name.localeCompare(b.name))
    return character
  }

  async function copyCharacter(
    sourceId: string,
    input: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora' | 'imageGenerationSeed' | 'imageGenerationPromptPrefix'>
  ) {
    const { character } = await copyStoredCharacter(sourceId, {
      ...input,
      name: input.name.trim(),
      tags: sanitizeTags(input.tags),
      color: normalizeColor(input.color, DEFAULT_CHARACTER_COLOR)
    })
    await load(true)
    return character
  }

  async function removeCharacter(id: string) {
    await deleteCharacter(id)
    characters.value = characters.value.filter((character) => character.id !== id)
    images.value = images.value.filter((image) => image.characterId !== id)
    syncUrls()
  }

  async function setArchived(id: string, archived: boolean) {
    const character = byId(id)
    if (!character) return null
    const updated: Character = {
      ...character,
      archived,
      updatedAt: Date.now()
    }
    await putCharacter(updated)
    const index = characters.value.findIndex((item) => item.id === id)
    if (index >= 0) characters.value[index] = updated
    return updated
  }

  async function importArchive(
    archive: ImportedCharacterArchive,
    name: string,
    targetId?: string
  ) {
    const result = await importStoredCharacterArchive({
      mode: targetId ? 'replace' : 'new',
      targetId,
      name,
      character: archive.character,
      images: archive.images,
      sounds: archive.sounds
    })
    await load(true)
    const soundsStore = useSoundsStore()
    if (soundsStore.loaded) await soundsStore.load(true)
    return result.character
  }

  async function addImage(characterId: string, file: Blob, tags: string[]) {
    const { blob, mimeType } = await normalizeImage(file)
    const isFirst = imagesFor(characterId).length === 0
    const image: StoredImage = {
      id: newId(),
      characterId,
      tags: sanitizeTags(tags, undefined, 'neutral'),
      isDefault: isFirst,
      mimeType,
      createdAt: Date.now(),
      blob
    }
    await putImage(image)
    images.value.push(image)
    if (image.isDefault) applyDefaultLocally(image)
    syncUrls()
    return image
  }

  function applyDefaultLocally(image: StoredImage) {
    images.value = images.value.map((item) =>
      item.characterId === image.characterId && item.id !== image.id
        ? { ...item, isDefault: false }
        : item
    )
  }

  async function updateImage(
    id: string,
    patch: Partial<Pick<StoredImage, 'tags' | 'isDefault'>>
  ) {
    const current = images.value.find((image) => image.id === id)
    if (!current) return
    const updated: StoredImage = {
      ...current,
      ...patch,
      tags:
        patch.tags === undefined
          ? current.tags
          : sanitizeTags(patch.tags, undefined, 'neutral')
    }
    await putImage(updated)
    images.value = images.value.map((image) => (image.id === id ? updated : image))
    if (updated.isDefault) applyDefaultLocally(updated)
  }

  async function removeImage(id: string) {
    await deleteImage(id)
    const removed = images.value.find((image) => image.id === id)
    images.value = images.value.filter((image) => image.id !== id)
    if (removed?.isDefault) {
      const fallback = imagesFor(removed.characterId)[0]
      if (fallback) await updateImage(fallback.id, { isDefault: true })
    }
    syncUrls()
  }

  return {
    characters,
    images,
    loaded,
    load,
    byId,
    colorOf,
    imagesFor,
    defaultImage,
    resolveImage,
    urlFor,
    saveCharacter,
    copyCharacter,
    importArchive,
    removeCharacter,
    setArchived,
    addImage,
    updateImage,
    removeImage,
    syncUrls,
    resetForScope
  }
})
