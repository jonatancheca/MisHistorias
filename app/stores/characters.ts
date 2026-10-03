import { defineStore } from 'pinia'
import type { Character, ImageGenerationMetadata } from '#shared/types'
import {
  getActiveDataScope,
  type DataScope,
  copyCharacter as copyStoredCharacter,
  deleteCharacter,
  deleteImage,
  importCharacterArchive as importStoredCharacterArchive,
  assetContentUrl,
  listImageMetadata,
  listCharacters,
  newId,
  putCharacter,
  putImage,
  reorderCharacterImages,
  restoreImage as restoreStoredImage,
  type ImageAsset,
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
  const images = ref<ImageAsset[]>([])
  const urls = ref<Record<string, string>>({})
  const urlBlobs = new Map<string, Blob>()
  const loaded = ref(false)
  let loadRevision = 0
  let imageUpdateQueue: Promise<void> = Promise.resolve()
  const imageUpdateVersions = new Map<string, number>()
  const defaultUpdateVersions = new Map<string, number>()
  let pendingLoad: { scope: DataScope; promise: Promise<void> } | null = null

  function syncUrls() {
    const next: Record<string, string> = {}
    for (const image of images.value) {
      next[image.id] = image.blob
        ? urlBlobs.get(image.id) === image.blob && urls.value[image.id]
          ? urls.value[image.id]!
          : URL.createObjectURL(image.blob)
        : assetContentUrl('images', image.id)
      if (image.blob) urlBlobs.set(image.id, image.blob)
      else urlBlobs.delete(image.id)
    }
    for (const [id, url] of Object.entries(urls.value)) {
      if (next[id] !== url) URL.revokeObjectURL(url)
      if (!next[id]) urlBlobs.delete(id)
    }
    urls.value = next
  }

  function resetForScope() {
    pendingLoad = null
    loadRevision += 1
    characters.value = []
    images.value = []
    loaded.value = false
    syncUrls()
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const scope = getActiveDataScope()
    if (!force && pendingLoad?.scope === scope) return pendingLoad.promise
    const pending = { scope, promise: loadCatalog(scope) }
    pendingLoad = pending
    try {
      await pending.promise
    } finally {
      if (pendingLoad === pending) pendingLoad = null
    }
  }

  async function loadCatalog(scope: DataScope) {
    const revision = ++loadRevision
    const [chars, imgs] = await Promise.all([
      listCharacters(scope),
      listImageMetadata(scope)
    ])
    if (scope !== getActiveDataScope() || revision !== loadRevision) return
    characters.value = chars
    images.value = imgs
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
    return images.value
      .filter((image) => image.characterId === characterId)
      .sort((left, right) =>
        left.position - right.position ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id)
      )
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
    imageGenerationNotes?: string
    imageGenerationPrompt?: string
    imageGenerationModel?: string
    visibleInDemo?: boolean
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
      imageGenerationNotes:
        input.imageGenerationNotes ?? existing?.imageGenerationNotes ?? '',
      imageGenerationPrompt:
        input.imageGenerationPrompt ?? existing?.imageGenerationPrompt ?? '',
      imageGenerationModel:
        input.imageGenerationModel ?? existing?.imageGenerationModel ?? '',
      archived: existing?.archived ?? false,
      visibleInDemo:
        input.visibleInDemo ?? existing?.visibleInDemo ?? usePrivacyStore().isDemo,
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
    input: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora' | 'imageGenerationSeed' | 'imageGenerationPromptPrefix' | 'imageGenerationNotes' | 'imageGenerationPrompt' | 'imageGenerationModel'>
  ) {
    const source = byId(sourceId)
    const { character } = await copyStoredCharacter(sourceId, {
      ...input,
      visibleInDemo: source?.readOnly ? false : usePrivacyStore().isDemo,
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

  async function setDemoVisibility(id: string, visibleInDemo: boolean) {
    const character = byId(id)
    if (!character || character.visibleInDemo === visibleInDemo) return character
    return saveCharacter({ ...character, visibleInDemo })
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

  async function addImage(characterId: string, file: Blob, tags: string[], originalFile?: Blob,
    options: { scope?: DataScope; generation?: ImageGenerationMetadata; signal?: AbortSignal } = {}) {
    const scope = options.scope ?? getActiveDataScope()
    const ownImages = imagesFor(characterId)
    const isFirst = ownImages.length === 0
    const { blob, mimeType } = await normalizeImage(file)
    options.signal?.throwIfAborted()
    const image: StoredImage = {
      id: newId(),
      characterId,
      position: ownImages.reduce((maximum, image) => Math.max(maximum, image.position), -1) + 1,
      tags: sanitizeTags(tags, undefined, 'neutral'),
      isDefault: isFirst,
      mimeType,
      createdAt: Date.now(),
      blob,
      generation: options.generation,
      originalBlob: originalFile ? (await normalizeImage(originalFile)).blob : undefined
    }
    const stored = await putImage(image, scope)
    if (scope !== getActiveDataScope()) return stored
    images.value.push(stored)
    if (image.isDefault) applyDefaultLocally(image)
    syncUrls()
    return stored
  }

  function applyDefaultLocally(image: ImageAsset) {
    const version = (defaultUpdateVersions.get(image.characterId) ?? 0) + 1
    defaultUpdateVersions.set(image.characterId, version)
    images.value = images.value.map((item) =>
      item.characterId === image.characterId && item.id !== image.id
        ? { ...item, isDefault: false }
        : item
    )
    return version
  }

  async function updateImage(
    id: string,
    patch: Partial<Pick<StoredImage, 'tags' | 'isDefault'>>
  ) {
    const scope = getActiveDataScope()
    const revision = loadRevision
    const version = (imageUpdateVersions.get(id) ?? 0) + 1
    imageUpdateVersions.set(id, version)
    const current = images.value.find((image) => image.id === id)
    if (!current) return
    const updated: ImageAsset = {
      ...current,
      ...patch,
      tags:
        patch.tags === undefined
          ? current.tags
          : sanitizeTags(patch.tags, undefined, 'neutral')
    }
    const previousDefaults = new Map(images.value.filter(image => image.characterId === current.characterId)
      .map(image => [image.id, image.isDefault]))
    images.value = images.value.map((image) => image.id === id ? updated : image)
    const defaultVersion = updated.isDefault ? applyDefaultLocally(updated) : null
    const persist = async () => {
      const cached = scope === getActiveDataScope() && revision === loadRevision
        ? images.value.find(image => image.id === id)?.blob : undefined
      const stored = await putImage({ ...updated, blob: updated.blob ?? cached }, scope)
      if (scope !== getActiveDataScope() || revision !== loadRevision) return
      images.value = images.value.map(image => image.id === id ? { ...image, blob: stored.blob } : image)
      syncUrls()
    }
    const request = imageUpdateQueue.then(persist, persist)
    imageUpdateQueue = request.then(() => undefined, () => undefined)
    try {
      await request
    } catch (caught) {
      if (scope === getActiveDataScope() && revision === loadRevision && imageUpdateVersions.get(id) === version) {
        const restoreDefaults = defaultVersion !== null && defaultUpdateVersions.get(current.characterId) === defaultVersion
        images.value = images.value.map(image => {
          const restored = image.id === id ? { ...current, isDefault: image.isDefault } : image
          return restoreDefaults && previousDefaults.has(image.id)
            ? { ...restored, isDefault: previousDefaults.get(image.id)! } : restored
        })
        syncUrls()
      }
      throw caught
    }
  }

  async function reorderImages(characterId: string, imageIds: string[]) {
    const current = imagesFor(characterId)
    const currentIds = current.map((image) => image.id)
    if (
      imageIds.length !== currentIds.length ||
      new Set(imageIds).size !== imageIds.length ||
      imageIds.some((id) => !currentIds.includes(id))
    ) {
      throw new Error('El orden de imágenes no es válido.')
    }

    const previousPositions = new Map(current.map((image) => [image.id, image.position]))
    const nextPositions = new Map(imageIds.map((id, position) => [id, position]))
    images.value = images.value.map((image) =>
      image.characterId === characterId
        ? { ...image, position: nextPositions.get(image.id) ?? image.position }
        : image
    )

    try {
      const stored = await reorderCharacterImages(characterId, imageIds)
      const storedById = new Map(stored.map((image) => [image.id, image]))
      images.value = images.value.map((image) => {
        const metadata = storedById.get(image.id)
        return metadata ? { ...image, ...metadata } : image
      })
    } catch (caught) {
      images.value = images.value.map((image) =>
        image.characterId === characterId
          ? { ...image, position: previousPositions.get(image.id) ?? image.position }
          : image
      )
      throw caught
    }
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

  async function cropImage(id: string, blob: Blob) {
    const current = images.value.find((image) => image.id === id)
    if (!current) throw new Error('Imagen no encontrada.')
    const normalized = await normalizeImage(blob)
    const updated = await putImage({ ...current, ...normalized })
    images.value = images.value.map((image) => image.id === id ? updated : image)
    syncUrls()
  }

  async function restoreImage(id: string) {
    const updated = await restoreStoredImage(id)
    images.value = images.value.map((image) => image.id === id ? updated : image)
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
    setDemoVisibility,
    addImage,
    updateImage,
    reorderImages,
    cropImage,
    restoreImage,
    removeImage,
    syncUrls,
    resetForScope
  }
})
