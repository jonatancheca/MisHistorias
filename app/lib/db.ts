import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { isReactive, isRef, ref, toRaw, unref } from 'vue'
import { sanitizeTags } from '~/lib/tags'
import type {
  AppSettings,
  Background,
  Character,
  CharacterImage,
  LlmDebugTrace,
  Message,
  PromptPreset,
  Story
} from '#shared/types'

export interface StoredImage extends CharacterImage {
  blob: Blob
}

export interface StoredBackground extends Background {
  blob: Blob
}

interface LocalChatDB extends DBSchema {
  characters: {
    key: string
    value: Character
  }
  images: {
    key: string
    value: StoredImage
    indexes: { byCharacter: string }
  }
  backgrounds: {
    key: string
    value: StoredBackground
  }
  stories: {
    key: string
    value: Story
  }
  messages: {
    key: string
    value: Message
    indexes: { byStory: string }
  }
  llmDebugTraces: {
    key: string
    value: LlmDebugTrace
    indexes: {
      byStory: string
      byRequestMessage: string
      byResponseMessage: string
    }
  }
  presets: {
    key: string
    value: PromptPreset
  }
  settings: {
    key: string
    value: { key: string; value: AppSettings }
  }
}

export type DataScope = 'normal' | 'private'

const DB_NAMES: Record<DataScope, string> = {
  normal: 'local-chat',
  private: 'local-chat-private'
}
const DB_VERSION = 5

const dbPromises: Partial<Record<DataScope, Promise<IDBPDatabase<LocalChatDB>>>> = {}
export const activeDataScope = ref<DataScope>('normal')

export function getActiveDataScope() {
  return activeDataScope.value
}

export function setActiveDataScope(scope: DataScope) {
  activeDataScope.value = scope
}

export function getDb(scope: DataScope = activeDataScope.value) {
  if (!dbPromises[scope]) {
    dbPromises[scope] = openDB<LocalChatDB>(DB_NAMES[scope], DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('characters')) {
          db.createObjectStore('characters', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('images')) {
          const store = db.createObjectStore('images', { keyPath: 'id' })
          store.createIndex('byCharacter', 'characterId')
        }
        if (!db.objectStoreNames.contains('backgrounds')) {
          db.createObjectStore('backgrounds', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('stories')) {
          db.createObjectStore('stories', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' })
          store.createIndex('byStory', 'storyId')
        }
        if (!db.objectStoreNames.contains('llmDebugTraces')) {
          const store = db.createObjectStore('llmDebugTraces', { keyPath: 'id' })
          store.createIndex('byStory', 'storyId')
          store.createIndex('byRequestMessage', 'requestMessageId')
          store.createIndex('byResponseMessage', 'responseMessageId')
        }
        if (!db.objectStoreNames.contains('presets')) {
          db.createObjectStore('presets', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' })
        }
        if (oldVersion < 4) {
          let imageCursor = await transaction.objectStore('images').openCursor()
          while (imageCursor) {
            const value = imageCursor.value as StoredImage & { tag?: unknown; tags?: unknown }
            const migrated = {
              ...value,
              tags: sanitizeTags(value.tags, value.tag, 'neutral')
            }
            delete migrated.tag
            await imageCursor.update(migrated)
            imageCursor = await imageCursor.continue()
          }

          let backgroundCursor = await transaction.objectStore('backgrounds').openCursor()
          while (backgroundCursor) {
            const value = backgroundCursor.value as StoredBackground & {
              tag?: unknown
              tags?: unknown
            }
            const migrated = {
              ...value,
              tags: sanitizeTags(value.tags, value.tag, 'neutral')
            }
            delete migrated.tag
            await backgroundCursor.update(migrated)
            backgroundCursor = await backgroundCursor.continue()
          }
        }
        if (oldVersion < 5) {
          let characterCursor = await transaction.objectStore('characters').openCursor()
          while (characterCursor) {
            const value = characterCursor.value as Character & { tags?: unknown }
            await characterCursor.update({
              ...value,
              tags: sanitizeTags(value.tags)
            })
            characterCursor = await characterCursor.continue()
          }
        }
      }
    })
  }
  return dbPromises[scope]!
}

export function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * IndexedDB usa structuredClone, que revienta con los Proxy reactivos de Vue.
 * Devuelve una copia plana; los objetos no simples (Blob, File…) se dejan tal cual.
 */
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

/* characters */

function normalizeCharacter(character: Character & { tags?: unknown }): Character {
  return { ...character, tags: sanitizeTags(character.tags) }
}

export async function listCharacters() {
  const db = await getDb()
  const all = await db.getAll('characters')
  return all.map(normalizeCharacter).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCharacter(id: string) {
  const db = await getDb()
  const character = await db.get('characters', id)
  return character ? normalizeCharacter(character) : undefined
}

export async function putCharacter(character: Character) {
  const db = await getDb()
  await db.put('characters', unwrap(character))
  return character
}

export async function deleteCharacter(id: string) {
  const db = await getDb()
  const tx = db.transaction(['characters', 'images'], 'readwrite')
  await tx.objectStore('characters').delete(id)
  const imageStore = tx.objectStore('images')
  const keys = await imageStore.index('byCharacter').getAllKeys(id)
  await Promise.all(keys.map((key) => imageStore.delete(key)))
  await tx.done
}

/* images */

export async function listImages(characterId: string) {
  const db = await getDb()
  const images = await db.getAllFromIndex('images', 'byCharacter', characterId)
  return images.sort((a, b) => a.createdAt - b.createdAt)
}

export async function listAllImages() {
  const db = await getDb()
  return db.getAll('images')
}

export async function putImage(image: StoredImage) {
  const db = await getDb()
  const value = unwrap(image)
  if (value.isDefault) {
    const tx = db.transaction('images', 'readwrite')
    const others = await tx.store.index('byCharacter').getAll(value.characterId)
    await Promise.all(
      others
        .filter((item) => item.id !== value.id && item.isDefault)
        .map((item) => tx.store.put({ ...item, isDefault: false }))
    )
    await tx.store.put(value)
    await tx.done
    return image
  }
  await db.put('images', value)
  return image
}

export async function deleteImage(id: string) {
  const db = await getDb()
  await db.delete('images', id)
}

/* backgrounds */

export async function listBackgrounds() {
  const db = await getDb()
  const all = await db.getAll('backgrounds')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putBackground(background: StoredBackground) {
  const db = await getDb()
  await db.put('backgrounds', unwrap(background))
  return background
}

export async function deleteBackground(id: string) {
  const db = await getDb()
  await db.delete('backgrounds', id)
}

/* stories */

export async function listStories() {
  const db = await getDb()
  const all = await db.getAll('stories')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getStory(id: string) {
  const db = await getDb()
  return db.get('stories', id)
}

export async function putStory(story: Story) {
  const db = await getDb()
  await db.put('stories', unwrap(story))
  return story
}

export async function deleteStory(id: string) {
  const db = await getDb()
  const tx = db.transaction(['stories', 'messages', 'llmDebugTraces'], 'readwrite')
  await tx.objectStore('stories').delete(id)
  const messageStore = tx.objectStore('messages')
  const keys = await messageStore.index('byStory').getAllKeys(id)
  await Promise.all(keys.map((key) => messageStore.delete(key)))
  const traceStore = tx.objectStore('llmDebugTraces')
  const traceKeys = await traceStore.index('byStory').getAllKeys(id)
  await Promise.all(traceKeys.map((key) => traceStore.delete(key)))
  await tx.done
}

/* messages */

export async function listMessages(storyId: string) {
  const db = await getDb()
  const messages = await db.getAllFromIndex('messages', 'byStory', storyId)
  return messages.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putMessage(message: Message) {
  const db = await getDb()
  await db.put('messages', unwrap(message))
  return message
}

export async function deleteMessage(id: string) {
  const db = await getDb()
  const tx = db.transaction(['messages', 'llmDebugTraces'], 'readwrite')
  await tx.objectStore('messages').delete(id)
  const traceStore = tx.objectStore('llmDebugTraces')
  const [requestTraces, responseTraces] = await Promise.all([
    traceStore.index('byRequestMessage').getAll(id),
    traceStore.index('byResponseMessage').getAll(id)
  ])
  const traces = [...requestTraces.filter((trace) => trace.status === 'error'), ...responseTraces]
  await Promise.all(traces.map((trace) => traceStore.delete(trace.id)))
  await tx.done
}

export async function deleteMessages(ids: string[]) {
  if (ids.length === 0) return
  const db = await getDb()
  const tx = db.transaction(['messages', 'llmDebugTraces'], 'readwrite')
  const messageStore = tx.objectStore('messages')
  await Promise.all(ids.map((id) => messageStore.delete(id)))
  const idSet = new Set(ids)
  const traceStore = tx.objectStore('llmDebugTraces')
  const traces = await traceStore.getAll()
  const traceIds = traces
    .filter(
      (trace) =>
        (trace.responseMessageId && idSet.has(trace.responseMessageId)) ||
        (trace.status === 'error' && trace.requestMessageId && idSet.has(trace.requestMessageId))
    )
    .map((trace) => trace.id)
  await Promise.all(traceIds.map((id) => traceStore.delete(id)))
  await tx.done
}

/* LLM debug traces */

export async function listLlmDebugTraces(storyId: string) {
  const db = await getDb()
  const traces = await db.getAllFromIndex('llmDebugTraces', 'byStory', storyId)
  return traces.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putLlmDebugTrace(trace: LlmDebugTrace) {
  const db = await getDb()
  await db.put('llmDebugTraces', unwrap(trace))
  return trace
}

/* presets */

export async function listPresets() {
  const db = await getDb()
  const all = await db.getAll('presets')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function putPreset(preset: PromptPreset) {
  const db = await getDb()
  await db.put('presets', unwrap(preset))
  return preset
}

export async function deletePreset(id: string) {
  const db = await getDb()
  await db.delete('presets', id)
}

/* settings */

const SETTINGS_KEY = 'app'

export async function readSettings() {
  const db = await getDb('normal')
  const row = await db.get('settings', SETTINGS_KEY)
  return row?.value ?? null
}

export async function writeSettings(value: AppSettings) {
  const db = await getDb('normal')
  await db.put('settings', { key: SETTINGS_KEY, value: unwrap(value) })
  return value
}

export async function clearAll(scope: DataScope = activeDataScope.value) {
  const db = await getDb(scope)
  const stores = [
    'characters',
    'images',
    'backgrounds',
    'stories',
    'messages',
    'llmDebugTraces',
    'presets'
  ] as const
  const tx = db.transaction(stores, 'readwrite')
  await Promise.all(stores.map((name) => tx.objectStore(name).clear()))
  await tx.done
}
