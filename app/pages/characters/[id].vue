<script setup lang="ts">
import { CHARACTER_COLORS, normalizeColor, pickColor } from '~/lib/colors'

const route = useRoute()
const characters = useCharactersStore()
await characters.load()

const isNew = computed(() => route.params.id === 'new')
const characterId = ref(String(route.params.id))
const existing = computed(() => (isNew.value ? null : characters.byId(characterId.value)))
const copyFromId = Array.isArray(route.query.copyFrom)
  ? route.query.copyFrom[0]
  : route.query.copyFrom
const copiedCharacter =
  isNew.value && typeof copyFromId === 'string' ? characters.byId(copyFromId) : null

const name = ref(existing.value?.name ?? copiedCharacter?.name ?? '')
const prompt = ref(existing.value?.prompt ?? copiedCharacter?.prompt ?? '')
const tags = ref([...(existing.value?.tags ?? copiedCharacter?.tags ?? [])])
const imageGenerationPreset = ref(
  existing.value?.imageGenerationPreset ?? copiedCharacter?.imageGenerationPreset ?? ''
)
const imageGenerationLora = ref(
  existing.value?.imageGenerationLora ?? copiedCharacter?.imageGenerationLora ?? ''
)
const color = ref(
  normalizeColor(
    existing.value?.color ?? copiedCharacter?.color,
    pickColor(characters.characters.length)
  )
)
const characterTagSuggestions = computed(() =>
  characters.characters.flatMap((character) => character.tags ?? [])
)
const saving = ref(false)
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const saveError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let savePending = false
let saveRevision = 0
let saveQueue: Promise<void> = Promise.resolve()

function enqueueSave(revision: number, navigateAfterCreate = false) {
  const input = {
    id: isNew.value ? undefined : characterId.value,
    name: name.value,
    prompt: prompt.value,
    tags: [...tags.value],
    color: color.value,
    imageGenerationPreset: imageGenerationPreset.value,
    imageGenerationLora: imageGenerationLora.value
  }
  const run = async () => {
    if (!input.name.trim()) return
    if (savedTimer) {
      clearTimeout(savedTimer)
      savedTimer = null
    }
    saving.value = true
    saveStatus.value = 'saving'
    saveError.value = null
    try {
      const character = copiedCharacter && isNew.value
        ? await characters.copyCharacter(copiedCharacter.id, input)
        : await characters.saveCharacter(input)
      if (revision === saveRevision) {
        saveStatus.value = 'saved'
        savedTimer = setTimeout(() => {
          savedTimer = null
          if (saveStatus.value === 'saved') saveStatus.value = 'idle'
        }, 2000)
      }
      if (navigateAfterCreate) await navigateTo(`/characters/${character.id}`)
    } catch (caught) {
      if (revision === saveRevision) {
        saveStatus.value = 'error'
        saveError.value = (caught as Error).message || 'No se pudo guardar el personaje.'
      }
    } finally {
      saving.value = false
    }
  }
  saveQueue = saveQueue.then(run, run)
  return saveQueue
}

function scheduleSave() {
  if (isNew.value) return
  saveRevision += 1
  savePending = true
  if (saveTimer) clearTimeout(saveTimer)
  const revision = saveRevision
  saveTimer = setTimeout(() => {
    saveTimer = null
    savePending = false
    void enqueueSave(revision)
  }, 500)
}

async function flushSave() {
  if (isNew.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savePending) {
    savePending = false
    await enqueueSave(saveRevision)
  } else {
    await saveQueue
  }
}

async function save() {
  if (!name.value.trim() || saving.value) return
  if (!isNew.value) {
    await flushSave()
    return
  }
  saveRevision += 1
  await enqueueSave(saveRevision, true)
}

function onSaveShortcut(event: KeyboardEvent) {
  if (isNew.value || (!event.ctrlKey && !event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  void flushSave()
}

watch(
  () => [
    name.value,
    prompt.value,
    JSON.stringify(tags.value),
    color.value,
    imageGenerationPreset.value,
    imageGenerationLora.value
  ],
  scheduleSave
)

onMounted(() => window.addEventListener('keydown', onSaveShortcut))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSaveShortcut)
  if (saveTimer) clearTimeout(saveTimer)
  if (savedTimer) clearTimeout(savedTimer)
  void flushSave()
})
onBeforeRouteLeave(flushSave)
</script>

<template>
  <div class="page-shell">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">
        {{ copiedCharacter ? 'Copiar personaje' : isNew ? 'Nuevo personaje' : name || 'Personaje' }}
      </h1>
      <NuxtLink to="/characters" class="btn-ghost">Volver</NuxtLink>
    </header>

    <p v-if="!isNew && !existing" class="card text-sm">Personaje no encontrado.</p>

    <template v-else>
      <form class="mb-8 grid max-w-3xl gap-4" @submit.prevent="save">
        <div>
          <label class="label" for="name">Nombre</label>
          <input id="name" v-model="name" autocomplete="off" class="field" placeholder="Ana" >
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            El modelo usará este nombre exacto como prefijo al hablar.
          </p>
        </div>
        <div>
          <label class="label" for="color">Color</label>
          <div class="flex flex-wrap items-center gap-2">
            <input id="color" v-model="color" type="color" autocomplete="off" class="h-9 w-14 cursor-pointer rounded border border-[var(--color-border-soft)] bg-transparent" >
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
            autocomplete="off"
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
            show-all-suggestions
            placeholder="aventurera"
          />
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Describen al personaje y no se mezclan con etiquetas de imagen. Pulsa badges o escribe una nueva.
          </p>
        </div>
        <div class="flex min-h-10 items-center gap-3">
          <button v-if="isNew" type="submit" class="btn-primary" :disabled="!name.trim() || saving">
            Guardar
          </button>
          <span v-if="saveStatus === 'saving'" class="text-xs text-[var(--color-fg-muted)]">Guardando…</span>
          <span v-else-if="saveStatus === 'saved'" class="text-xs text-[var(--color-fg-muted)]">Guardado</span>
          <span v-else-if="saveStatus === 'error'" class="text-xs text-red-500" role="alert">
            {{ saveError || 'Error al guardar' }}
          </span>
        </div>
      </form>

      <CharacterImageEditor
        v-if="!isNew && existing"
        v-model:image-generation-preset="imageGenerationPreset"
        v-model:image-generation-lora="imageGenerationLora"
        :character-id="characterId"
      />
      <section v-if="!isNew && existing" class="card mt-8 max-w-3xl">
        <SoundEditor :character-id="characterId" title="Sonidos del personaje" />
      </section>
      <p v-else class="text-sm text-[var(--color-fg-muted)]">
        {{
          copiedCharacter
            ? 'Las imágenes se copiarán al guardar el personaje.'
            : 'Guarda el personaje para poder añadirle imágenes.'
        }}
      </p>
    </template>
  </div>
</template>
