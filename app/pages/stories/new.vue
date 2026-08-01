<script setup lang="ts">
const stories = useStoriesStore()
const characters = useCharactersStore()
const presets = usePresetsStore()
const settings = useSettingsStore()

await Promise.all([characters.load(), presets.load(), settings.load()])

const title = ref('')
const premise = ref('')
const protagonistPreferences = ref('')
const protagonistPreferencesMode = ref<'append' | 'replace'>('append')
const selected = ref<string[]>([])
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
        <input id="title" v-model="title" class="field" placeholder="La taberna del puerto" />
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
            />
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
