<script setup lang="ts">
import type { StoredSound } from '~/lib/db'

const props = defineProps<{
  characterId?: string
  backgroundId?: string
  title?: string
}>()

const sounds = useSoundsStore()
const confirmDialog = useConfirmStore()
await sounds.load()

const tags = ref<string[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const entries = computed(() => {
  if (props.characterId) return sounds.forCharacter(props.characterId)
  if (props.backgroundId) return sounds.forBackground(props.backgroundId)
  return sounds.standalone()
})

async function add(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  busy.value = true
  error.value = null
  try {
    await sounds.addSound({
      file,
      tags: tags.value,
      characterId: props.characterId,
      backgroundId: props.backgroundId
    })
    tags.value = []
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar el sonido.'
  } finally {
    busy.value = false
  }
}

async function update(sound: StoredSound, nextTags: string[]) {
  error.value = null
  try {
    await sounds.updateSound(sound.id, nextTags)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar el sonido.'
  }
}

async function remove(sound: StoredSound) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar sonido',
    message: `Se borrará el sonido [${sound.tags[0] ?? 'sin etiqueta'}].`
  })
  if (accepted) await sounds.removeSound(sound.id)
}
</script>

<template>
  <section class="grid gap-3">
    <h2 v-if="title" class="text-lg font-semibold">{{ title }}</h2>
    <div class="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <label class="label">Etiquetas del sonido</label>
        <TagInput v-model="tags" placeholder="puerta, pasos" />
      </div>
      <div>
        <input
          ref="fileInput"
          type="file"
          accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
          class="hidden"
          @change="add"
        >
        <button
          type="button"
          class="btn-primary w-full"
          :disabled="busy || tags.length === 0"
          @click="fileInput?.click()"
        >
          {{ busy ? 'Guardando…' : 'Añadir sonido' }}
        </button>
      </div>
    </div>
    <p class="text-xs text-[var(--color-fg-muted)]">MP3, WAV u OGG. Máximo 10 MB.</p>
    <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>

    <p v-if="entries.length === 0" class="text-sm text-[var(--color-fg-muted)]">Sin sonidos.</p>
    <ul v-else class="grid gap-3">
      <li
        v-for="sound in entries"
        :key="sound.id"
        class="grid gap-2 rounded-xl border border-[var(--color-border-soft)] p-3"
      >
        <audio :src="sounds.urlFor(sound.id)!" controls preload="metadata" class="w-full" />
        <TagInput
          :model-value="sound.tags"
          aria-label="Etiquetas del sonido"
          placeholder="puerta"
          @update:model-value="update(sound, $event)"
        />
        <div class="flex justify-end">
          <button type="button" class="btn-danger" @click="remove(sound)">Borrar</button>
        </div>
      </li>
    </ul>
  </section>
</template>
