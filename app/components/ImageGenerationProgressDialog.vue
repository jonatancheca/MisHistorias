<script setup lang="ts">
defineProps<{
  completed: number
  total: number
  currentPrompt: string
  lastImageUrl: string | null
}>()

const emit = defineEmits<{ cancel: [] }>()
const cancelButton = ref<HTMLButtonElement | null>(null)

onMounted(() => cancelButton.value?.focus())

function trapFocus(event: KeyboardEvent) {
  event.preventDefault()
  cancelButton.value?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      @keydown.esc.stop.prevent="emit('cancel')"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-generation-progress-title"
        class="flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl"
        data-testid="image-generation-progress-dialog"
      >
        <header class="border-b border-[var(--color-border-soft)] px-4 py-3">
          <h2 id="image-generation-progress-title" class="text-lg font-bold">Generando imágenes</h2>
          <p role="status" class="text-sm text-[var(--color-fg-muted)]">
            Imagen {{ completed }} de {{ total }} completadas.
          </p>
        </header>

        <div class="grid min-h-0 gap-4 overflow-y-auto p-4">
          <div>
            <div class="mb-1 flex items-center justify-between gap-3 text-sm">
              <span>Prompt actual</span>
              <span>{{ completed + 1 }} / {{ total }}</span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-brand-500/15"
              role="progressbar"
              aria-label="Progreso de generación"
              :aria-valuenow="completed"
              aria-valuemin="0"
              :aria-valuemax="total"
            >
              <div
                class="h-full rounded-full bg-brand-500 transition-[width]"
                :style="{ width: `${total ? (completed / total) * 100 : 0}%` }"
              />
            </div>
            <p class="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
              {{ currentPrompt }}
            </p>
          </div>

          <div v-if="lastImageUrl" class="grid gap-2">
            <h3 class="text-sm font-semibold">Última imagen generada</h3>
            <div class="flex min-h-32 items-center justify-center overflow-hidden rounded-xl bg-black/10 p-2 dark:bg-white/10">
              <img :src="lastImageUrl" alt="Última imagen generada" class="max-h-80 max-w-full object-contain">
            </div>
          </div>
          <p v-else class="text-sm text-[var(--color-fg-muted)]">Todavía no hay imágenes generadas.</p>
        </div>

        <footer class="flex justify-end border-t border-[var(--color-border-soft)] p-3">
          <button ref="cancelButton" type="button" class="btn-danger" @click="emit('cancel')">
            Cancelar generación
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
