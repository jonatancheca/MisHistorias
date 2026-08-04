<script setup lang="ts">
defineProps<{ count: number }>()

const emit = defineEmits<{
  choose: [mode: 'original' | 'crop' | 'cancel']
}>()

const cancelButton = ref<HTMLButtonElement | null>(null)
const originalButton = ref<HTMLButtonElement | null>(null)
const cropButton = ref<HTMLButtonElement | null>(null)

onMounted(() => cancelButton.value?.focus())

function trapFocus(event: KeyboardEvent) {
  const buttons = [cancelButton.value, originalButton.value, cropButton.value].filter(
    (button): button is HTMLButtonElement => Boolean(button)
  )
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.shiftKey
    ? (current - 1 + buttons.length) % buttons.length
    : (current + 1) % buttons.length
  buttons[next]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="emit('choose', 'cancel')"
      @keydown.esc.stop.prevent="emit('choose', 'cancel')"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-image-title"
        aria-describedby="batch-image-description"
        class="w-full max-w-md rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
      >
        <h2 id="batch-image-title" class="text-lg font-bold">Añadir {{ count }} imágenes</h2>
        <p id="batch-image-description" class="mt-2 text-sm text-[var(--color-fg-muted)]">
          Todas usarán las etiquetas indicadas. ¿Quieres recortarlas individualmente?
        </p>
        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button ref="cancelButton" type="button" class="btn-ghost" @click="emit('choose', 'cancel')">
            Cancelar
          </button>
          <button ref="originalButton" type="button" class="btn-ghost" @click="emit('choose', 'original')">
            Usar originales
          </button>
          <button ref="cropButton" type="button" class="btn-primary" @click="emit('choose', 'crop')">
            Recortar una por una
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
