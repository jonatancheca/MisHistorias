import { defineStore } from 'pinia'
import {
  copyBackground as copyStoredBackground,
  deleteBackground,
  getActiveDataScope,
  listBackgrounds,
  newId,
  putBackground,
  type StoredBackground
} from '~/lib/db'
import { normalizeImage } from '~/lib/images'
import { normalizeBackgroundStyle } from '~/lib/backgroundStyles'
import { hasTag, nextAvailableTag, sanitizeTags, tagKey } from '~/lib/tags'

export const useBackgroundsStore = defineStore('backgrounds', () => {
  const backgrounds = ref<StoredBackground[]>([])
  const urls = ref<Record<string, string>>({})
  const loaded = ref(false)
  let loadRevision = 0

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
    loadRevision += 1
    backgrounds.value = []
    loaded.value = false
    syncUrls()
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const scope = getActiveDataScope()
    const revision = ++loadRevision
    const result = await listBackgrounds(scope)
    if (scope !== getActiveDataScope() || revision !== loadRevision) return
    backgrounds.value = result
    syncUrls()
    loaded.value = true
  }

  function byId(id: string | null | undefined) {
    if (!id) return null
    const background = backgrounds.value.find((item) => item.id === id) ?? null
    return background && isVisibleInDemo(background) ? background : null
  }

  function isVisibleInDemo(background: StoredBackground) {
    const privacy = usePrivacyStore()
    if (!privacy.isDemo || background.visibleInDemo) return true
    const storyStore = useStoriesStore()
    const story = storyStore.activeStory?.visibleInDemo ? storyStore.activeStory : null
    if (!story) return false
    if (story.initialBackgroundId === background.id) return true
    return storyStore.messages.some((message) =>
      message.segments.some((segment) => segment.backgroundId === background.id)
    )
  }

  function byTag(tag: string | null | undefined) {
    if (!tag) return null
    return backgrounds.value.find(
      (background) => isVisibleInDemo(background) && hasTag(background, tag)
    ) ?? null
  }

  function urlFor(id: string | null | undefined) {
    if (!id) return null
    if (!byId(id)) return null
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

  async function addBackground(file: Blob, tags: string[], description: string, style = '') {
    const preparedTags = prepareTags(tags)
    const { blob, mimeType } = await normalizeImage(file)
    const background: StoredBackground = {
      id: newId(),
      tags: preparedTags,
      style: normalizeBackgroundStyle(style),
      description: description.trim(),
      mimeType,
      visibleInDemo: usePrivacyStore().isDemo,
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
    patch: Partial<Pick<StoredBackground, 'tags' | 'style' | 'description' | 'visibleInDemo'>>
  ) {
    const current = byId(id)
    if (!current) return null
    const tags = patch.tags === undefined ? current.tags : prepareTags(patch.tags, id)
    const updated: StoredBackground = {
      ...current,
      ...patch,
      tags,
      style: normalizeBackgroundStyle(patch.style ?? current.style),
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

  async function copyBackground(id: string) {
    const copied = await copyStoredBackground(id)
    await load(true)
    return copied
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
    copyBackground,
    resetForScope
  }
})
