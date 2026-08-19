import { defineStore } from 'pinia'
import {
  deleteSound,
  getActiveDataScope,
  listSounds,
  newId,
  putSound,
  type StoredSound
} from '~/lib/db'
import type { AppSettings } from '#shared/types'
import {
  DEFAULT_SOUNDS,
  DEFAULT_SOUND_CREATED_AT,
  DEFAULT_SOUND_VERSION,
  planDefaultSoundSeeds
} from '~/lib/defaultSounds'
import { sanitizeTags, tagKey } from '~/lib/tags'

const ALLOWED_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg'
])
const MAX_SOUND_BYTES = 10 * 1024 * 1024

export const useSoundsStore = defineStore('sounds', () => {
  const sounds = ref<StoredSound[]>([])
  const urls = ref<Record<string, string>>({})
  const loaded = ref(false)
  let audioContext: AudioContext | null = null
  const decoded = new Map<string, AudioBuffer>()
  const activePlayers = new Set<HTMLAudioElement>()

  function syncUrls() {
    const next: Record<string, string> = {}
    for (const sound of sounds.value) {
      next[sound.id] = urls.value[sound.id] ?? URL.createObjectURL(sound.blob)
    }
    for (const [id, url] of Object.entries(urls.value)) {
      if (!next[id]) URL.revokeObjectURL(url)
    }
    urls.value = next
  }

  function resetForScope() {
    sounds.value = []
    loaded.value = false
    decoded.clear()
    syncUrls()
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const settings = useSettingsStore()
    await settings.load()
    const all = await listSounds()
    const versionKey = getActiveDataScope() === 'private'
      ? ('privateDefaultSoundVersion' as const)
      : ('defaultSoundVersion' as const)
    const appliedVersion = settings.settings[versionKey]
    if (appliedVersion < DEFAULT_SOUND_VERSION) {
      const seeds = planDefaultSoundSeeds(all, appliedVersion)
      for (const seed of seeds) {
        const response = await fetch(`/sounds/default/${encodeURIComponent(seed.file)}`)
        if (!response.ok) throw new Error(`No se pudo cargar el sonido ${seed.tags[0]}.`)
        const sound: StoredSound = {
          id: seed.id,
          tags: seed.tags,
          characterId: null,
          backgroundId: null,
          mimeType: 'audio/wav',
          createdAt:
            DEFAULT_SOUND_CREATED_AT +
            DEFAULT_SOUNDS.findIndex((definition) => definition.id === seed.id),
          blob: await response.blob()
        }
        await putSound(sound)
        all.push(sound)
      }
      await settings.save({ [versionKey]: DEFAULT_SOUND_VERSION } as Partial<AppSettings>)
    }
    sounds.value = all
    syncUrls()
    loaded.value = true
  }

  function byId(id: string | null | undefined) {
    if (!id) return null
    return sounds.value.find((sound) => sound.id === id) ?? null
  }

  function byTag(tag: string | null | undefined) {
    if (!tag) return null
    const key = tagKey(tag)
    return sounds.value.find((sound) => sound.tags.some((item) => tagKey(item) === key)) ?? null
  }

  function forCharacter(characterId: string) {
    return sounds.value.filter((sound) => sound.characterId === characterId)
  }

  function forBackground(backgroundId: string) {
    return sounds.value.filter((sound) => sound.backgroundId === backgroundId)
  }

  function standalone() {
    return sounds.value.filter((sound) => !sound.characterId && !sound.backgroundId)
  }

  function urlFor(id: string | null | undefined) {
    if (!id) return null
    return urls.value[id] ?? null
  }

  function prepareTags(values: string[], exceptId?: string) {
    const prepared = sanitizeTags(values)
    if (prepared.length === 0) throw new Error('Añade al menos una etiqueta.')
    const used = new Set(
      sounds.value
        .filter((sound) => sound.id !== exceptId)
        .flatMap((sound) => sound.tags)
        .map(tagKey)
    )
    const duplicate = prepared.find((tag) => used.has(tagKey(tag)))
    if (duplicate) throw new Error(`Ya existe un sonido con la etiqueta “${duplicate}”.`)
    return prepared
  }

  async function addSound(input: {
    file: File | Blob
    tags: string[]
    characterId?: string | null
    backgroundId?: string | null
  }) {
    if (input.file.size > MAX_SOUND_BYTES) throw new Error('El sonido supera 10 MB.')
    const mimeType = input.file.type.toLocaleLowerCase()
    if (!ALLOWED_TYPES.has(mimeType)) throw new Error('Usa un archivo MP3, WAV u OGG.')
    const sound: StoredSound = {
      id: newId(),
      tags: prepareTags(input.tags),
      characterId: input.characterId ?? null,
      backgroundId: input.backgroundId ?? null,
      mimeType,
      createdAt: Date.now(),
      blob: input.file
    }
    await putSound(sound)
    sounds.value.push(sound)
    syncUrls()
    return sound
  }

  async function updateSound(id: string, tags: string[]) {
    const current = byId(id)
    if (!current) return null
    const updated = { ...current, tags: prepareTags(tags, id) }
    await putSound(updated)
    sounds.value = sounds.value.map((sound) => (sound.id === id ? updated : sound))
    return updated
  }

  async function removeSound(id: string) {
    await deleteSound(id)
    sounds.value = sounds.value.filter((sound) => sound.id !== id)
    syncUrls()
  }

  async function unlock() {
    if (typeof AudioContext === 'undefined') return
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') await audioContext.resume()
  }

  async function play(id: string | null | undefined) {
    const sound = byId(id)
    if (!sound) return
    try {
      if (audioContext?.state === 'running') {
        let buffer = decoded.get(sound.id)
        if (!buffer) {
          buffer = await audioContext.decodeAudioData(await sound.blob.arrayBuffer())
          decoded.set(sound.id, buffer)
        }
        const source = audioContext.createBufferSource()
        source.buffer = buffer
        source.connect(audioContext.destination)
        source.start()
        return
      }
    } catch {
      // El control HTML sigue disponible si Web Audio no puede decodificar el fichero.
    }
    const url = urlFor(sound.id)
    if (!url || typeof Audio === 'undefined') return
    const audio = new Audio(url)
    activePlayers.add(audio)
    const release = () => activePlayers.delete(audio)
    audio.addEventListener('ended', release, { once: true })
    audio.addEventListener('error', release, { once: true })
    void audio.play().catch(release)
  }

  return {
    sounds,
    loaded,
    load,
    byId,
    byTag,
    forCharacter,
    forBackground,
    standalone,
    urlFor,
    addSound,
    updateSound,
    removeSound,
    unlock,
    play,
    resetForScope
  }
})
