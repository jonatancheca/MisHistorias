<script setup lang="ts">
import type { StorySaveSlot } from '#shared/types'

const props = defineProps<{
  open: boolean
  saves: StorySaveSlot[]
  busy?: boolean
  error?: string | null
}>()
const emit = defineEmits<{
  close: []
  save: [name: string]
  load: [id: string]
  remove: [id: string]
}>()

const name = ref('')
const dateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'short',
  timeStyle: 'medium'
})

useDialogEscape(
  () => props.open,
  () => emit('close')
)

watch(
  () => props.open,
  (open) => {
    if (open) name.value = dateFormatter.format(new Date())
  },
  { immediate: true }
)

function submit() {
  const value = name.value.trim()
  if (value) emit('save', value)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      @click.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-saves-title"
        class="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl"
      >
        <header class="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] p-5">
          <div>
            <h2 id="story-saves-title" class="text-lg font-bold">Partidas</h2>
            <p class="text-xs text-[var(--color-fg-muted)]">Guarda o recupera un punto de esta historia.</p>
          </div>
          <button type="button" class="btn-ghost" aria-label="Cerrar partidas" @click="emit('close')">Cerrar</button>
        </header>

        <form class="flex gap-2 border-b border-[var(--color-border-soft)] p-5" @submit.prevent="submit">
          <div class="min-w-0 flex-1">
            <label class="label" for="story-save-name">Nombre de la partida</label>
            <input
              id="story-save-name"
              v-model="name"
              class="field"
              autocomplete="off"
              maxlength="200"
              required
            >
          </div>
          <button type="submit" class="btn-primary self-end" :disabled="busy || !name.trim()">
            Guardar partida
          </button>
        </form>
        <p v-if="error" class="border-b border-[var(--color-border-soft)] px-5 py-3 text-sm text-red-500" role="alert">
          {{ error }}
        </p>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <p v-if="!saves.length" class="text-sm text-[var(--color-fg-muted)]">
            Todavía no hay partidas guardadas.
          </p>
          <ul v-else class="grid gap-3">
            <li
              v-for="save in saves"
              :key="save.id"
              class="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] p-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <img
                :src="save.thumbnailDataUrl"
                alt=""
                class="aspect-video w-full rounded-lg bg-slate-950 object-cover sm:w-40"
              >
              <div class="min-w-0">
                <p class="truncate font-semibold">{{ save.name }}</p>
                <p class="text-xs text-[var(--color-fg-muted)]">{{ dateFormatter.format(save.createdAt) }}</p>
              </div>
              <div class="flex flex-wrap gap-2 sm:justify-end">
                <button type="button" class="btn-ghost" :disabled="busy" @click="emit('load', save.id)">
                  Cargar
                </button>
                <button type="button" class="btn-danger" :disabled="busy" @click="emit('remove', save.id)">
                  Borrar
                </button>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </Teleport>
</template>
