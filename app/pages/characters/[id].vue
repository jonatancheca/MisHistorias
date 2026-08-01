<script setup lang="ts">
import { CHARACTER_COLORS, normalizeColor, pickColor } from '~/lib/colors'

const route = useRoute()
const characters = useCharactersStore()
await characters.load()

const isNew = computed(() => route.params.id === 'new')
const characterId = ref(String(route.params.id))
const existing = computed(() => (isNew.value ? null : characters.byId(characterId.value)))

const name = ref(existing.value?.name ?? '')
const prompt = ref(existing.value?.prompt ?? '')
const tags = ref([...(existing.value?.tags ?? [])])
const color = ref(
  normalizeColor(existing.value?.color, pickColor(characters.characters.length))
)
const characterTagSuggestions = computed(() =>
  characters.characters.flatMap((character) => character.tags ?? [])
)
const saving = ref(false)
const savedAt = ref<number | null>(null)

async function save() {
  if (!name.value.trim() || saving.value) return
  saving.value = true
  try {
    const character = await characters.saveCharacter({
      id: isNew.value ? undefined : characterId.value,
      name: name.value,
      prompt: prompt.value,
      tags: tags.value,
      color: color.value
    })
    savedAt.value = Date.now()
    if (isNew.value) await navigateTo(`/characters/${character.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl p-8">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">{{ isNew ? 'Nuevo personaje' : name || 'Personaje' }}</h1>
      <NuxtLink to="/characters" class="btn-ghost">Volver</NuxtLink>
    </header>

    <p v-if="!isNew && !existing" class="card text-sm">Personaje no encontrado.</p>

    <template v-else>
      <form class="mb-8 grid gap-4" @submit.prevent="save">
        <div>
          <label class="label" for="name">Nombre</label>
          <input id="name" v-model="name" class="field" placeholder="Ana" />
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            El modelo usará este nombre exacto como prefijo al hablar.
          </p>
        </div>
        <div>
          <label class="label" for="color">Color</label>
          <div class="flex flex-wrap items-center gap-2">
            <input id="color" v-model="color" type="color" class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent" />
            <button
              v-for="swatch in CHARACTER_COLORS"
              :key="swatch"
              type="button"
              class="h-7 w-7 rounded-full border-2 transition"
              :style="{ backgroundColor: swatch, borderColor: color === swatch ? 'var(--color-fg)' : 'transparent' }"
              :aria-label="swatch"
              @click="color = swatch"
            />
          </div>
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Se usa para su nombre y su diálogo dentro de la historia.
          </p>
        </div>
        <div>
          <label class="label" for="prompt">Prompt del personaje</label>
          <textarea
            id="prompt"
            v-model="prompt"
            class="field min-h-40"
            placeholder="Quién es, cómo habla, qué quiere, qué no haría nunca."
          />
        </div>
        <div>
          <label class="label" for="character-tags">Etiquetas del personaje</label>
          <TagInput
            id="character-tags"
            v-model="tags"
            :suggestions="characterTagSuggestions"
            placeholder="aventurera"
          />
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Describen al personaje y no se mezclan con etiquetas de imagen. Pulsa Enter o coma para añadir.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="btn-primary" :disabled="!name.trim() || saving">
            Guardar
          </button>
          <span v-if="savedAt" class="text-xs text-[var(--color-fg-muted)]">Guardado</span>
        </div>
      </form>

      <CharacterImageEditor v-if="!isNew && existing" :character-id="characterId" />
      <p v-else class="text-sm text-[var(--color-fg-muted)]">
        Guarda el personaje para poder añadirle imágenes.
      </p>
    </template>
  </div>
</template>
