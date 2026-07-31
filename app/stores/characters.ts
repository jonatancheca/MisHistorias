import { defineStore } from 'pinia'
import type { Character } from '#shared/types'
import {
  deleteCharacter,
  deleteImage,
  listAllImages,
  listCharacters,
  newId,
  putCharacter,
  putImage,
  type StoredImage
} from '~/lib/db'
import { normalizeImage } from '~/lib/images'
import { DEFAULT_CHARACTER_COLOR, normalizeColor, pickColor } from '~/lib/colors'

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
  function resolveImage(characterId: string, tag: string | null) {
    if (tag) {
      const normalized = tag.trim().toLowerCase()
      const match = imagesFor(characterId).find(
        (image) => image.tag.trim().toLowerCase() === normalized
      )
      if (match) return match
    }
    return defaultImage(characterId)
  }

  function urlFor(imageId: string | null | undefined) {
    if (!imageId) return null
    return urls.value[imageId] ?? null
  }

  async function saveCharacter(input: { id?: string; name: string; prompt: string; color?: string }) {
    const now = Date.now()
    const existing = input.id ? byId(input.id) : null
    const character: Character = {
      id: existing?.id ?? input.id ?? newId(),
      name: input.name.trim(),
      prompt: input.prompt,
      color: normalizeColor(
        input.color ?? existing?.color,
        existing?.color ?? pickColor(characters.value.length)
      ),
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

  async function removeCharacter(id: string) {
    await deleteCharacter(id)
    characters.value = characters.value.filter((character) => character.id !== id)
    images.value = images.value.filter((image) => image.characterId !== id)
    syncUrls()
  }

  async function addImage(characterId: string, file: File, tag: string, description: string) {
    const { blob, mimeType } = await normalizeImage(file)
    const isFirst = imagesFor(characterId).length === 0
    const image: StoredImage = {
      id: newId(),
      characterId,
      tag: tag.trim() || 'neutral',
      description: description.trim(),
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

  async function updateImage(id: string, patch: Partial<Pick<StoredImage, 'tag' | 'description' | 'isDefault'>>) {
    const current = images.value.find((image) => image.id === id)
    if (!current) return
    const updated: StoredImage = {
      ...current,
      ...patch,
      tag: (patch.tag ?? current.tag).trim() || current.tag
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
    removeCharacter,
    addImage,
    updateImage,
    removeImage,
    syncUrls
  }
})
