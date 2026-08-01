import { defineStore } from 'pinia'
import {
  deleteBackground,
  listBackgrounds,
  newId,
  putBackground,
  type StoredBackground
} from '~/lib/db'
import { normalizeImage } from '~/lib/images'

function normalizeTag(value: string) {
  return value.trim().toLocaleLowerCase()
}

export const useBackgroundsStore = defineStore('backgrounds', () => {
  const backgrounds = ref<StoredBackground[]>([])
  const urls = ref<Record<string, string>>({})
  const loaded = ref(false)

  function syncUrls() {
    const next: Record<string, string> = {}
    for (const background of backgrounds.value) {
      next[background.id] = urls.value[background.id] ?? URL.createObjectURL(background.blob)
    }
    for (const [id, url] of Object.entries(urls.value)) {
      if (!next[id]) URL.revokeObjectURL(url)
    }
    urls.value = next
  }

  function resetForScope() {
    backgrounds.value = []
    loaded.value = false
    syncUrls()
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    backgrounds.value = await listBackgrounds()
    syncUrls()
    loaded.value = true
  }

  function byId(id: string | null | undefined) {
    if (!id) return null
    return backgrounds.value.find((background) => background.id === id) ?? null
  }

  function byTag(tag: string | null | undefined) {
    if (!tag) return null
    const normalized = normalizeTag(tag)
    return backgrounds.value.find((background) => normalizeTag(background.tag) === normalized) ?? null
  }

  function urlFor(id: string | null | undefined) {
    if (!id) return null
    return urls.value[id] ?? null
  }

  function assertUniqueTag(tag: string, exceptId?: string) {
    const trimmed = tag.trim()
    if (!trimmed) throw new Error('La etiqueta es obligatoria.')
    const duplicate = backgrounds.value.some(
      (background) => background.id !== exceptId && normalizeTag(background.tag) === normalizeTag(trimmed)
    )
    if (duplicate) throw new Error('Ya existe un fondo con esa etiqueta.')
    return trimmed
  }

  async function addBackground(file: File, tag: string, description: string) {
    const normalizedTag = assertUniqueTag(tag)
    const { blob, mimeType } = await normalizeImage(file)
    const background: StoredBackground = {
      id: newId(),
      tag: normalizedTag,
      description: description.trim(),
      mimeType,
      createdAt: Date.now(),
      blob
    }
    await putBackground(background)
    backgrounds.value.push(background)
    syncUrls()
    return background
  }

  async function updateBackground(
    id: string,
    patch: Partial<Pick<StoredBackground, 'tag' | 'description'>>
  ) {
    const current = byId(id)
    if (!current) return null
    const tag = patch.tag === undefined ? current.tag : assertUniqueTag(patch.tag, id)
    const updated: StoredBackground = {
      ...current,
      ...patch,
      tag,
      description: (patch.description ?? current.description).trim()
    }
    await putBackground(updated)
    backgrounds.value = backgrounds.value.map((background) =>
      background.id === id ? updated : background
    )
    return updated
  }

  async function removeBackground(id: string) {
    await deleteBackground(id)
    backgrounds.value = backgrounds.value.filter((background) => background.id !== id)
    syncUrls()
  }

  return {
    backgrounds,
    loaded,
    load,
    byId,
    byTag,
    urlFor,
    addBackground,
    updateBackground,
    removeBackground,
    resetForScope
  }
})
