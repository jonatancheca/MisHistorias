<script setup lang="ts">
import { primaryTag } from '~/lib/tags'

const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const presets = usePresetsStore()
const settings = useSettingsStore()

await Promise.all([characters.load(), backgrounds.load(), presets.load(), settings.load()])

const title = ref('')
const premise = ref('')
const protagonistPreferences = ref('')
const protagonistPreferencesMode = ref<'append' | 'replace'>('append')
const selected = ref<string[]>([])
const initialBackgroundId = ref<string | null>(null)
const presetId = ref<string | null>(settings.activePresetId)
const saving = ref(false)

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
      protagonistPreferences: protagonistPreferences.value,
      protagonistPreferencesMode: protagonistPreferencesMode.value,
      characterIds: selected.value,
      initialBackgroundId: initialBackgroundId.value,
      presetId: presetId.value
    })
    await navigateTo(`/stories/${story.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <h1 class="mb-6 text-2xl font-bold">Nueva historia</h1>

    <form class="grid gap-5" @submit.prevent="submit">
      <div>
        <label class="label" for="title">Título</label>
        <input id="title" v-model="title" class="field" placeholder="La taberna del puerto" >
      </div>

      <div>
        <label class="label" for="premise">Planteamiento</label>
        <textarea
          id="premise"
          v-model="premise"
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
        <span class="label">Personajes</span>
        <p v-if="characters.characters.length === 0" class="text-sm text-[var(--color-fg-muted)]">
          No hay personajes.
          <NuxtLink to="/characters" class="text-brand-600 underline">Crea uno primero</NuxtLink>.
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="character in characters.characters"
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

      <div>
        <span class="label">Fondo inicial</span>
        <p class="mb-2 text-xs text-[var(--color-fg-muted)]">
          Opcional. El modelo podrá cambiarlo después por cualquier fondo del catálogo.
        </p>
        <div class="grid gap-2 sm:grid-cols-2">
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

      <div>
        <label class="label" for="preset">Prompt de preparación</label>
        <select id="preset" v-model="presetId" class="field">
          <option v-for="preset in presets.presets" :key="preset.id" :value="preset.id">
            {{ preset.name }}
          </option>
        </select>
      </div>

      <div class="flex gap-2">
        <button type="submit" class="btn-primary" :disabled="!canSubmit">Empezar historia</button>
        <NuxtLink to="/" class="btn-ghost">Cancelar</NuxtLink>
      </div>
    </form>
  </div>
</template>
