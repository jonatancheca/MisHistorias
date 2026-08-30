<script setup lang="ts">
import type { StoryCharacterCustomization } from '#shared/types'
import { primaryTag } from '~/lib/tags'

const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const settings = useSettingsStore()

await Promise.all([
  stories.load(),
  characters.load(),
  backgrounds.load(),
  settings.load()
])

const copyFromId = Array.isArray(route.query.copyFrom)
  ? route.query.copyFrom[0]
  : route.query.copyFrom
const copiedStory =
  typeof copyFromId === 'string'
    ? (stories.stories.find((story) => story.id === copyFromId) ?? null)
    : null
const selectableCharacters = computed(() =>
  characters.characters.filter((character) => !character.archived)
)
const availableCharacterIds = new Set(selectableCharacters.value.map((character) => character.id))
const copiedCustomizations = new Map(
  (copiedStory?.characterCustomizations ?? []).map((customization) => [
    customization.characterId,
    customization
  ])
)

const title = ref('')
const premise = ref(copiedStory?.premise ?? '')
const autoGenerateImages = ref(copiedStory?.autoGenerateImages ?? false)
const protagonistPreferences = ref(copiedStory?.protagonistPreferences ?? '')
const protagonistPreferencesMode = ref<'append' | 'replace'>(
  copiedStory?.protagonistPreferencesMode ?? 'append'
)
const selected = ref<string[]>(
  copiedStory?.characterIds.filter((characterId) => availableCharacterIds.has(characterId)) ?? []
)
const initialBackgroundId = ref<string | null>(
  copiedStory && backgrounds.byId(copiedStory.initialBackgroundId)
    ? copiedStory.initialBackgroundId
    : null
)
const saving = ref(false)
const characterCustomizations = ref<Record<string, StoryCharacterCustomization>>(
  Object.fromEntries(
    selectableCharacters.value.map((character) => {
      const copied = copiedCustomizations.get(character.id)
      return [
        character.id,
        {
          characterId: character.id,
          name: copied?.name ?? character.name,
          color: copied?.color ?? character.color,
          prompt: copied?.prompt ?? character.prompt,
          tags: [...(copied?.tags ?? character.tags)]
        }
      ]
    })
  )
)
const selectedCharacters = computed(() =>
  selected.value.flatMap((id) => {
    const character = characters.byId(id)
    return character ? [character] : []
  })
)
const characterTagSuggestions = computed(() =>
  selectableCharacters.value.flatMap((character) => character.tags ?? [])
)

function customizationFor(characterId: string) {
  return characterCustomizations.value[characterId]!
}

function toggle(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}

const canSubmit = computed(
  () => premise.value.trim().length > 0 && selected.value.length > 0 && !saving.value
)

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const story = await stories.createStory({
      title: title.value,
      premise: premise.value,
      visualMode: copiedStory?.visualMode ?? false,
      autoGenerateImages: autoGenerateImages.value,
      protagonistPreferences: protagonistPreferences.value,
      protagonistPreferencesMode: protagonistPreferencesMode.value,
      characterIds: selected.value,
      characterCustomizations: selected.value.map((characterId) => ({
        ...customizationFor(characterId),
        tags: [...customizationFor(characterId).tags]
      })),
      initialBackgroundId: initialBackgroundId.value,
    })
    await navigateTo(`/stories/${story.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <h1 class="mb-6 text-2xl font-bold">Nueva historia</h1>

    <form class="grid max-w-5xl gap-5" @submit.prevent="submit">
      <div>
        <label class="label" for="title">Título</label>
        <input id="title" v-model="title" autocomplete="off" class="field" placeholder="La taberna del puerto" >
      </div>

      <div>
        <label class="label" for="premise">Planteamiento</label>
        <textarea
          id="premise"
          v-model="premise"
          autocomplete="off"
          class="field min-h-40"
          placeholder="Dónde ocurre, cuándo, qué está pasando y qué tono tiene la historia."
        />
      </div>

      <div class="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <div>
          <label class="label" for="protagonistPreferences">Preferencias del protagonista</label>
          <textarea
            id="protagonistPreferences"
            v-model="protagonistPreferences"
            autocomplete="off"
            class="field min-h-28"
            placeholder="Preferencias específicas para esta historia."
          />
        </div>
        <div>
          <label class="label" for="protagonistPreferencesMode">Combinar con globales</label>
          <select
            id="protagonistPreferencesMode"
            v-model="protagonistPreferencesMode"
            class="field"
          >
            <option value="append">Añadir</option>
            <option value="replace">Reemplazar</option>
          </select>
        </div>
      </div>

      <div>
        <label class="flex items-start gap-2 text-sm">
          <input v-model="autoGenerateImages" type="checkbox" class="mt-0.5 h-4 w-4">
          <span>
            <span class="block font-medium">Crear imágenes nuevas durante la historia</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">
              El LLM podrá pedir una imagen nueva por personaje y respuesta.
            </span>
          </span>
        </label>
      </div>

      <div>
        <span class="label">Personajes</span>
        <p v-if="selectableCharacters.length === 0" class="text-sm text-[var(--color-fg-muted)]">
          No hay personajes.
          <NuxtLink to="/characters" class="text-brand-600 underline">Crea uno primero</NuxtLink>.
        </p>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="character in selectableCharacters"
            :key="character.id"
            type="button"
            class="flex items-center gap-3 rounded-xl border p-3 text-left transition"
            :class="
              selected.includes(character.id)
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-[var(--color-border-soft)] hover:border-brand-400'
            "
            @click="toggle(character.id)"
          >
            <img
              v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
              :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
              alt=""
              class="h-10 w-10 rounded-full object-cover"
            >
            <span v-else class="h-10 w-10 rounded-full bg-brand-500/20" />
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ character.name }}</span>
              <span class="block truncate text-xs text-[var(--color-fg-muted)]">
                {{ characters.imagesFor(character.id).length }} imágenes
              </span>
            </span>
          </button>
        </div>
      </div>

      <div v-if="selectedCharacters.length" class="grid gap-3">
        <div>
          <span class="label">Personalización en esta historia</span>
          <p class="text-xs text-[var(--color-fg-muted)]">
            Copia independiente. Cambiarla no modifica los personajes globales.
          </p>
        </div>
        <section
          v-for="character in selectedCharacters"
          :key="character.id"
          class="rounded-xl border border-[var(--color-border-soft)] p-4"
        >
          <h2 class="font-semibold">{{ character.name }}</h2>
          <div class="mt-3 grid gap-3">
            <div>
              <label class="label" :for="`story-character-name-${character.id}`">Nombre en esta historia</label>
              <input
                :id="`story-character-name-${character.id}`"
                v-model="customizationFor(character.id).name"
                autocomplete="off"
                class="field"
              >
            </div>
            <div>
              <label class="label" :for="`story-character-prompt-${character.id}`">Prompt</label>
              <textarea
                :id="`story-character-prompt-${character.id}`"
                v-model="customizationFor(character.id).prompt"
                autocomplete="off"
                class="field min-h-32"
              />
            </div>
            <div>
              <label class="label" :for="`story-character-tags-${character.id}`">
                Etiquetas descriptivas
              </label>
              <TagInput
                :id="`story-character-tags-${character.id}`"
                v-model="customizationFor(character.id).tags"
                :suggestions="characterTagSuggestions"
                show-all-suggestions
                placeholder="aventurera"
              />
            </div>
          </div>
        </section>
      </div>

      <div>
        <span class="label">Fondo inicial</span>
        <p class="mb-2 text-xs text-[var(--color-fg-muted)]">
          Opcional. El modelo podrá cambiarlo después por cualquier fondo del catálogo.
        </p>
        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            class="rounded-xl border p-3 text-left transition"
            :class="
              initialBackgroundId === null
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-[var(--color-border-soft)] hover:border-brand-400'
            "
            @click="initialBackgroundId = null"
          >
            <span class="block font-medium">Que decida el LLM</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">Elegirá al abrir la escena</span>
          </button>
          <button
            v-for="background in backgrounds.backgrounds"
            :key="background.id"
            type="button"
            class="flex items-center gap-3 rounded-xl border p-3 text-left transition"
            :class="
              initialBackgroundId === background.id
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-[var(--color-border-soft)] hover:border-brand-400'
            "
            @click="initialBackgroundId = background.id"
          >
            <img
              :src="backgrounds.urlFor(background.id)!"
              alt=""
              class="h-12 w-16 shrink-0 rounded-lg object-contain"
            >
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ primaryTag(background) }}</span>
              <span class="block truncate text-xs text-[var(--color-fg-muted)]">
                {{ background.description || 'Sin descripción' }}
              </span>
            </span>
          </button>
        </div>
        <p v-if="backgrounds.backgrounds.length === 0" class="mt-2 text-sm text-[var(--color-fg-muted)]">
          <NuxtLink to="/backgrounds" class="text-brand-600 underline">Añade fondos</NuxtLink>
          para poder elegir uno.
        </p>
      </div>

      <div class="flex gap-2">
        <button type="submit" class="btn-primary" :disabled="!canSubmit">Empezar historia</button>
        <NuxtLink to="/" class="btn-ghost">Cancelar</NuxtLink>
      </div>
    </form>
  </div>
</template>
