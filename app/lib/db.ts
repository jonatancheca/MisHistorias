import { isReactive, isRef, ref, toRaw, unref } from 'vue'
import type {
  AppSettings,
  Background,
  Character,
  CharacterImage,
  DatabaseBackup,
  LlmDebugTrace,
  Message,
  PromptPreset,
  Sound,
  Story,
  StorySaveSlot
} from '#shared/types'

export interface StoredImage extends CharacterImage {
  blob: Blob
  originalBlob?: Blob
}

export interface StoredBackground extends Background {
  blob: Blob
}

export interface StoredSound extends Sound {
  blob: Blob
}

type ImageMetadata = CharacterImage
type BackgroundMetadata = Background
type SoundMetadata = Sound

export type DataScope = 'normal' | 'private'

export const activeDataScope = ref<DataScope>('normal')

export function getActiveDataScope() {
  return activeDataScope.value
}

export function setActiveDataScope(scope: DataScope) {
  activeDataScope.value = scope
}

export function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function unwrap<T>(value: T): T {
  if (isRef(value)) return unwrap(unref(value) as T)
  const raw = (isReactive(value) ? toRaw(value) : value) as unknown
  if (Array.isArray(raw)) return raw.map((item) => unwrap(item)) as unknown as T
  if (raw && typeof raw === 'object' && Object.getPrototypeOf(raw) === Object.prototype) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(raw)) result[key] = unwrap(item)
    return result as T
  }
  return raw as T
}

function dataUrl(path: string, scope: DataScope = activeDataScope.value) {
  const separator = path.includes('?') ? '&' : '?'
  return `/api/data/${path}${separator}scope=${scope}`
}

async function putJson<T extends { id: string }>(resource: string, value: T) {
  return $fetch<T>(dataUrl(`${resource}/${encodeURIComponent(value.id)}`), {
    method: 'PUT',
    body: unwrap(value)
  })
}

async function deleteJson(resource: string, id: string) {
  await $fetch(dataUrl(`${resource}/${encodeURIComponent(id)}`), { method: 'DELETE' })
}

async function fetchBlob(resource: 'images' | 'backgrounds' | 'sounds', id: string) {
  const response = await fetch(dataUrl(`${resource}/${encodeURIComponent(id)}/content`))
  if (!response.ok) throw new Error('No se pudo cargar el archivo guardado')
  return response.blob()
}

async function putBinary<T extends { id: string; blob: Blob; originalBlob?: Blob }>(
  resource: 'images' | 'backgrounds' | 'sounds',
  value: T
) {
  const { blob, originalBlob, ...metadata } = unwrap(value)
  const form = new FormData()
  form.append('metadata', JSON.stringify(metadata))
  form.append('file', blob, `${value.id}.bin`)
  if (resource === 'images' && originalBlob) form.append('original', originalBlob, 'original.bin')
  return $fetch<Omit<T, 'blob' | 'originalBlob'>>(dataUrl(`${resource}/${encodeURIComponent(value.id)}`), {
    method: 'PUT',
    body: form
  })
}

export async function listCharacters() {
  return $fetch<Character[]>(dataUrl('characters'))
}

export async function getCharacter(id: string) {
  try {
    return await $fetch<Character>(dataUrl(`characters/${encodeURIComponent(id)}`))
  } catch (caught) {
    if ((caught as { statusCode?: number }).statusCode === 404) return undefined
    throw caught
  }
}

export async function putCharacter(character: Character) {
  return putJson('characters', character)
}

export async function copyCharacter(
  sourceId: string,
  input: Pick<Character, 'name' | 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora' | 'imageGenerationSeed' | 'imageGenerationPromptPrefix'>
) {
  return $fetch<{ character: Character; images: CharacterImage[] }>(
    dataUrl(`characters/${encodeURIComponent(sourceId)}/copy`),
    {
      method: 'POST',
      body: unwrap(input)
    }
  )
}

export async function importCharacterArchive(input: {
  mode: 'new' | 'replace'
  targetId?: string
  name: string
  character: Pick<Character, 'prompt' | 'tags' | 'color' | 'imageGenerationPreset' | 'imageGenerationLora' | 'imageGenerationSeed' | 'imageGenerationPromptPrefix'>
  images: Array<Pick<StoredImage, 'tags' | 'isDefault' | 'mimeType' | 'blob' | 'originalBlob'>>
  sounds: Array<Pick<StoredSound, 'tags' | 'mimeType' | 'blob'>>
}) {
  const form = new FormData()
  const images = input.images.map((image, index) => {
    const field = `image-${index}`
    form.append(field, image.blob, field)
    if (image.originalBlob) form.append(`${field}-original`, image.originalBlob, 'original.bin')
    return {
      field,
      tags: image.tags,
      isDefault: image.isDefault,
      mimeType: image.mimeType
    }
  })
  const sounds = input.sounds.map((sound, index) => {
    const field = `sound-${index}`
    form.append(field, sound.blob, field)
    return { field, tags: sound.tags, mimeType: sound.mimeType }
  })
  form.append('metadata', JSON.stringify({
    mode: input.mode,
    targetId: input.targetId,
    name: input.name,
    character: input.character,
    images,
    sounds
  }))
  return $fetch<{ character: Character; images: CharacterImage[]; sounds: Sound[] }>(
    dataUrl('characters/import'),
    { method: 'POST', body: form }
  )
}

export async function deleteCharacter(id: string) {
  await deleteJson('characters', id)
}

export async function listImages(characterId: string) {
  const metadata = await $fetch<ImageMetadata[]>(
    dataUrl(`images?characterId=${encodeURIComponent(characterId)}`)
  )
  return Promise.all(metadata.map(async (image) => ({ ...image, blob: await fetchBlob('images', image.id) })))
}

export async function listAllImages() {
  const metadata = await $fetch<ImageMetadata[]>(dataUrl('images'))
  return Promise.all(metadata.map(async (image) => ({ ...image, blob: await fetchBlob('images', image.id) })))
}

export async function putImage(image: StoredImage) {
  const metadata = await putBinary('images', image)
  return { ...metadata, blob: image.blob }
}

export async function getOriginalImageBlob(id: string) {
  const response = await fetch(dataUrl(`images/${encodeURIComponent(id)}/original`))
  if (!response.ok) throw new Error('No se pudo cargar la imagen original')
  return response.blob()
}

export async function restoreImage(id: string): Promise<StoredImage> {
  const metadata = await $fetch<CharacterImage>(dataUrl(`images/${encodeURIComponent(id)}/original`), {
    method: 'POST'
  })
  return { ...metadata, blob: await fetchBlob('images', id) }
}

export async function deleteImage(id: string) {
  await deleteJson('images', id)
}

export async function listBackgrounds() {
  const metadata = await $fetch<BackgroundMetadata[]>(dataUrl('backgrounds'))
  return Promise.all(
    metadata.map(async (background) => ({
      ...background,
      blob: await fetchBlob('backgrounds', background.id)
    }))
  )
}

export async function putBackground(background: StoredBackground) {
  await putBinary('backgrounds', background)
  return background
}

export async function deleteBackground(id: string) {
  await deleteJson('backgrounds', id)
}

export async function listSounds() {
  const metadata = await $fetch<SoundMetadata[]>(dataUrl('sounds'))
  return Promise.all(
    metadata.map(async (sound) => ({
      ...sound,
      blob: await fetchBlob('sounds', sound.id)
    }))
  )
}

export async function putSound(sound: StoredSound) {
  await putBinary('sounds', sound)
  return sound
}

export async function deleteSound(id: string) {
  await deleteJson('sounds', id)
}

export async function listStories() {
  return $fetch<Story[]>(dataUrl('stories'))
}

export async function getStory(id: string) {
  try {
    return await $fetch<Story>(dataUrl(`stories/${encodeURIComponent(id)}`))
  } catch (caught) {
    if ((caught as { statusCode?: number }).statusCode === 404) return undefined
    throw caught
  }
}

export async function putStory(story: Story) {
  return putJson('stories', story)
}

export async function deleteStory(id: string) {
  await deleteJson('stories', id)
}

export async function listMessages(storyId: string) {
  return $fetch<Message[]>(dataUrl(`messages?storyId=${encodeURIComponent(storyId)}`))
}

export async function putMessage(message: Message) {
  return putJson('messages', message)
}

export async function deleteMessage(id: string) {
  await deleteJson('messages', id)
}

export async function deleteMessages(ids: string[]) {
  if (ids.length === 0) return
  await $fetch(dataUrl('messages/delete-many'), { method: 'POST', body: { ids } })
}

export async function listLlmDebugTraces(storyId: string) {
  return $fetch<LlmDebugTrace[]>(
    dataUrl(`llmDebugTraces?storyId=${encodeURIComponent(storyId)}`)
  )
}

export async function putLlmDebugTrace(trace: LlmDebugTrace) {
  return putJson('llmDebugTraces', trace)
}

export async function deleteLlmDebugTrace(id: string) {
  await deleteJson('llmDebugTraces', id)
}

export async function listStorySaves(storyId: string) {
  return $fetch<StorySaveSlot[]>(
    dataUrl(`storySaves?storyId=${encodeURIComponent(storyId)}`)
  )
}

export async function createStorySave(
  storyId: string,
  name: string,
  thumbnailDataUrl: string
) {
  return $fetch<StorySaveSlot>(
    dataUrl(`storySaves/${encodeURIComponent(storyId)}/create`),
    { method: 'POST', body: { name, thumbnailDataUrl } }
  )
}

export async function putStorySave(save: StorySaveSlot) {
  return putJson('storySaves', save)
}

export async function loadStorySave(id: string) {
  return $fetch<{ save: StorySaveSlot; story: Story }>(
    dataUrl(`storySaves/${encodeURIComponent(id)}/load`),
    { method: 'POST' }
  )
}

export async function deleteStorySave(id: string) {
  await deleteJson('storySaves', id)
}

export async function listPresets() {
  return $fetch<PromptPreset[]>(dataUrl('presets'))
}

export async function putPreset(preset: PromptPreset) {
  return putJson('presets', preset)
}

export async function deletePreset(id: string) {
  await deleteJson('presets', id)
}

export async function readSettings() {
  return $fetch<AppSettings | null>('/api/settings')
}

export async function writeSettings(patch: Partial<AppSettings>) {
  return $fetch<AppSettings>('/api/settings', { method: 'PATCH', body: unwrap(patch) })
}

export async function readApiKey(scope: DataScope = activeDataScope.value) {
  return $fetch<{ apiKey: string }>('/api/settings/api-key', {
    method: 'POST',
    query: { scope }
  })
}

export async function readSwarmAuthToken() {
  return $fetch<{ swarmAuthToken: string }>('/api/settings/swarm-token', { method: 'POST' })
}

export async function listDatabaseBackups() {
  return $fetch<DatabaseBackup[]>('/api/backups')
}

export async function createDatabaseBackup() {
  return $fetch<DatabaseBackup>('/api/backups', { method: 'POST' })
}

export async function restoreDatabaseBackup(name: string) {
  return $fetch<{
    restored: DatabaseBackup
    safety: DatabaseBackup
    health: { ok: boolean, schemaVersion: number }
    backups: DatabaseBackup[]
  }>(`/api/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' })
}

export async function clearAll(scope: DataScope = activeDataScope.value) {
  await $fetch(dataUrl('clear', scope), { method: 'POST' })
}
