<script setup lang="ts">
const props = defineProps<{
  open: boolean
  preferences: string
  mode: 'append' | 'replace'
}>()

const emit = defineEmits<{
  close: []
  save: [value: { preferences: string; mode: 'append' | 'replace' }]
}>()

const settings = useSettingsStore()
const buffer = ref('')
const bufferMode = ref<'append' | 'replace'>('append')
const textarea = ref<HTMLTextAreaElement | null>(null)
let previousFocus: HTMLElement | null = null
const globalPreferences = computed(() => settings.activeProtagonistPreferences.trim())

watch(() => props.open, async (open) => {
  if (!open) {
    previousFocus?.focus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  buffer.value = props.preferences
  bufferMode.value = props.mode
  await nextTick()
  textarea.value?.focus()
})

useDialogEscape(
  () => props.open,
  () => emit('close')
)

function save() {
  emit('save', { preferences: buffer.value.trim(), mode: bufferMode.value })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
      @click.self="emit('close')"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-preferences-title"
        class="w-full max-w-2xl rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
        @submit.prevent="save"
      >
        <h2 id="story-preferences-title" class="text-lg font-bold">Preferencias del protagonista</h2>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Define instrucciones propias de esta historia y cómo se combinan con las globales.
        </p>

        <div class="mt-4 grid gap-4">
          <div>
            <label class="label" for="story-protagonist-preferences">Preferencias del protagonista</label>
            <textarea
              id="story-protagonist-preferences"
              ref="textarea"
              v-model="buffer"
              autocomplete="off"
              class="field min-h-36"
              placeholder="Preferencias específicas para esta historia."
            />
          </div>

          <fieldset>
            <legend class="label">Combinar con preferencias globales</legend>
            <div
              class="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] p-1"
              role="radiogroup"
              aria-label="Combinar con preferencias globales"
            >
              <button
                type="button"
                role="radio"
                class="rounded-lg px-4 py-2.5 text-sm font-semibold transition"
                :class="bufferMode === 'append' ? 'bg-brand-500 text-white shadow-sm' : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'"
                :aria-checked="bufferMode === 'append'"
                @click="bufferMode = 'append'"
              >
                Añadir
              </button>
              <button
                type="button"
                role="radio"
                class="rounded-lg px-4 py-2.5 text-sm font-semibold transition"
                :class="bufferMode === 'replace' ? 'bg-brand-500 text-white shadow-sm' : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'"
                :aria-checked="bufferMode === 'replace'"
                @click="bufferMode = 'replace'"
              >
                Reemplazar
              </button>
            </div>
          </fieldset>

          <section class="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Preferencias globales</h3>
              <span class="text-xs text-[var(--color-fg-muted)]">Solo lectura</span>
            </div>
            <p v-if="globalPreferences" class="mt-2 whitespace-pre-wrap text-sm text-[var(--color-fg-muted)]">
              {{ globalPreferences }}
            </p>
            <p v-else class="mt-2 text-sm text-[var(--color-fg-muted)]">
              No hay preferencias globales configuradas.
            </p>
          </section>
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="submit" class="btn-primary">Aplicar preferencias</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
