import { defineStore } from 'pinia'
import type {
  NsfwLibraryEntry,
  NsfwPublication,
  NsfwStudioCharacter,
  NsfwStudioExperience,
  NsfwStudioPlace,
  NsfwStudioSprite
} from '../../shared/types/nsfw/studio.ts'

export const useNsfwStudioStore = defineStore('nsfwStudio', () => {
  const characters = ref<NsfwStudioCharacter[]>([])
  const places = ref<NsfwStudioPlace[]>([])
  const experiences = ref<NsfwStudioExperience[]>([])
  const hub = ref<NsfwPublication[]>([])
  const libraryEntries = ref<NsfwLibraryEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadCharacters() {
    const result = await $fetch<{ characters: NsfwStudioCharacter[] }>(
      '/api/private/studio/characters'
    )
    characters.value = result.characters
  }

  async function createCharacter(input: { name: string; tags?: string[] }) {
    const result = await $fetch<{ character: NsfwStudioCharacter }>(
      '/api/private/studio/characters',
      { method: 'POST', body: input }
    )
    await loadCharacters()
    return result.character
  }

  async function loadSprites(characterId: string) {
    const result = await $fetch<{ sprites: NsfwStudioSprite[] }>(
      `/api/private/studio/characters/${characterId}/sprites`
    )
    return result.sprites
  }

  async function addSprite(
    characterId: string,
    input: { label: string; facets: string[]; mimeType?: string; dataBase64?: string }
  ) {
    const result = await $fetch<{ sprite: NsfwStudioSprite }>(
      `/api/private/studio/characters/${characterId}/sprites`,
      { method: 'POST', body: input }
    )
    return result.sprite
  }

  async function uploadPlaceBackground(
    placeId: string,
    input: { dataBase64: string; mimeType?: string }
  ) {
    return $fetch<{ background: { id: string } }>(
      `/api/private/studio/places/${placeId}/background`,
      { method: 'POST', body: input }
    )
  }

  async function loadPlaces() {
    const result = await $fetch<{ places: NsfwStudioPlace[] }>('/api/private/studio/places')
    places.value = result.places
  }

  async function createPlace(input: { name: string; setting?: string; era?: string }) {
    const result = await $fetch<{ place: NsfwStudioPlace }>('/api/private/studio/places', {
      method: 'POST',
      body: input
    })
    await loadPlaces()
    return result.place
  }

  async function loadExperiences() {
    const result = await $fetch<{ experiences: NsfwStudioExperience[] }>(
      '/api/private/studio/experiences'
    )
    experiences.value = result.experiences
  }

  async function createExperience(input: { title: string; premise: string }) {
    const result = await $fetch<{ experience: NsfwStudioExperience }>(
      '/api/private/studio/experiences',
      { method: 'POST', body: input }
    )
    await loadExperiences()
    return result.experience
  }

  async function publish(input: {
    resourceType: 'character' | 'place' | 'experience'
    resourceId: string
  }) {
    const result = await $fetch<{ publication: NsfwPublication }>(
      '/api/private/studio/publications',
      { method: 'POST', body: input }
    )
    return result.publication
  }

  async function loadHub(query: { type?: string; q?: string } = {}) {
    const result = await $fetch<{ listings: NsfwPublication[] }>('/api/private/hub', { query })
    hub.value = result.listings
  }

  async function addFromHub(publicationId: string) {
    const result = await $fetch<{ entry: NsfwLibraryEntry }>('/api/private/hub/add', {
      method: 'POST',
      body: { publicationId }
    })
    await loadLibraryEntries()
    return result.entry
  }

  async function loadLibraryEntries() {
    const result = await $fetch<{ entries: NsfwLibraryEntry[] }>('/api/private/library/entries')
    libraryEntries.value = result.entries
  }

  return {
    characters,
    places,
    experiences,
    hub,
    libraryEntries,
    loading,
    error,
    loadCharacters,
    createCharacter,
    loadSprites,
    addSprite,
    loadPlaces,
    createPlace,
    uploadPlaceBackground,
    loadExperiences,
    createExperience,
    publish,
    loadHub,
    addFromHub,
    loadLibraryEntries
  }
})
