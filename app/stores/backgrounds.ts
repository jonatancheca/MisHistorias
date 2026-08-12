import { defineStore } from 'pinia'
import {
  deleteBackground,
  listBackgrounds,
  newId,
  putBackground,
  type StoredBackground
} from '~/lib/db'
import { normalizeImage } from '~/lib/images'
import { hasTag, nextAvailableTag, sanitizeTags, tagKey } from '~/lib/tags'

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
    return backgrounds.value.find((background) => hasTag(background, tag)) ?? null
  }

  function urlFor(id: string | null | undefined) {
    if (!id) return null
    return urls.value[id] ?? null
  }

  function prepareTags(tags: string[], exceptId?: string) {
    const used = new Set(
      backgrounds.value
        .filter((background) => background.id !== exceptId)
        .flatMap((background) => background.tags)
        .map(tagKey)
    )
    const sanitized = sanitizeTags(tags)
    const prepared = sanitized.filter(
      (tag) => sanitized.length === 1 || tagKey(tag) !== 'neutral'
    )
    if (prepared.length === 0) prepared.push(nextAvailableTag('neutral', used))
    const duplicate = prepared.find((tag) => used.has(tagKey(tag)))
    if (duplicate) throw new Error(`Ya existe un fondo con la etiqueta “${duplicate}”.`)
    return prepared
  }

  async function addBackground(file: Blob, tags: string[], description: string) {
    const preparedTags = prepareTags(tags)
    const { blob, mimeType } = await normalizeImage(file)
    const background: StoredBackground = {
      id: newId(),
      tags: preparedTags,
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
    patch: Partial<Pick<StoredBackground, 'tags' | 'description'>>
  ) {
    const current = byId(id)
    if (!current) return null
    const tags = patch.tags === undefined ? current.tags : prepareTags(patch.tags, id)
    const updated: StoredBackground = {
      ...current,
      ...patch,
      tags,
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
