<script setup lang="ts">
const props = withDefaults(defineProps<{
  count: number
  suggestions?: string[]
  saving?: boolean
}>(), {
  suggestions: () => [],
  saving: false
})

const emit = defineEmits<{
  cancel: []
  save: [tags: string[]]
}>()

const dialog = ref<HTMLElement | null>(null)
const tags = ref<string[]>([])

function cancel() {
  if (!props.saving) emit('cancel')
}

useDialogEscape(
  () => true,
  cancel,
  () => !props.saving
)

onMounted(async () => {
  await nextTick()
  dialog.value?.querySelector<HTMLInputElement>('input')?.focus()
})

function trapFocus(event: KeyboardEvent) {
  const focusable = Array.from(
    dialog.value?.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? []
  )
  if (!focusable.length) return
  const current = focusable.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? (current - 1 + focusable.length) % focusable.length
    : (current + 1) % focusable.length
  focusable[next]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
      @click.self="cancel"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uploaded-image-tags-title"
        aria-describedby="uploaded-image-tags-description"
        class="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 shadow-2xl sm:p-5"
      >
        <h2 id="uploaded-image-tags-title" class="text-lg font-bold">
          {{ count === 1 ? 'Etiquetas de la imagen subida' : `Etiquetas de las ${count} imágenes subidas` }}
        </h2>
        <p id="uploaded-image-tags-description" class="mt-2 text-sm text-[var(--color-fg-muted)]">
          {{ count === 1 ? 'Añade etiquetas para encontrar esta imagen.' : 'Las etiquetas se aplicarán a todas las imágenes subidas.' }}
          Puedes omitir este paso.
        </p>
        <div class="mt-4 min-w-0">
          <label class="label" for="uploaded-image-tags">Etiquetas</label>
          <TagInput
            id="uploaded-image-tags"
            v-model="tags"
            :suggestions="suggestions"
            show-all-suggestions
            placeholder="feliz"
          />
        </div>
        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" :disabled="saving" @click="cancel">
            Omitir
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="saving || tags.length === 0"
            @click="emit('save', tags)"
          >
            {{ saving ? 'Guardando…' : 'Guardar etiquetas' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
