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

const buffer = ref('')
const bufferMode = ref<'append' | 'replace'>('append')
const textarea = ref<HTMLTextAreaElement | null>(null)
let previousFocus: HTMLElement | null = null

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

        <div class="mt-4 grid gap-4 sm:grid-cols-[1fr_12rem]">
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
          <div>
            <label class="label" for="story-protagonist-preferences-mode">Combinar con globales</label>
            <select id="story-protagonist-preferences-mode" v-model="bufferMode" class="field">
              <option value="append">Añadir</option>
              <option value="replace">Reemplazar</option>
            </select>
          </div>
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="submit" class="btn-primary">Aplicar preferencias</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
