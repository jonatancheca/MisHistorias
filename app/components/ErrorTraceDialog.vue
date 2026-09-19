<script setup lang="ts">
import type { ErrorTrace } from '#shared/types'

const props = defineProps<{ trace: ErrorTrace | null }>()
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)
const copyStatus = ref('')

useDialogEscape(
  () => Boolean(props.trace),
  () => emit('close')
)

const formatted = computed(() => JSON.stringify(props.trace, null, 2))

watch(() => props.trace, async (trace) => {
  copyStatus.value = ''
  if (!trace) return
  await nextTick()
  closeButton.value?.focus()
})

async function copyJson() {
  try {
    await navigator.clipboard.writeText(formatted.value)
    copyStatus.value = 'JSON copiado.'
  } catch {
    copyStatus.value = 'No se pudo copiar el JSON.'
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="trace"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
      @click.self="emit('close')"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="error-trace-dialog-title"
        class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl min-w-0 flex-col rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl"
      >
        <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-soft)] p-4">
          <div class="min-w-0">
            <h2 id="error-trace-dialog-title" class="text-lg font-bold">Detalle de traza</h2>
            <p class="truncate text-xs text-[var(--color-fg-muted)]">
              {{ trace.source }} · {{ trace.operation }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-ghost" @click="copyJson">Copiar JSON</button>
            <button
              ref="closeButton"
              type="button"
              class="btn-ghost"
              aria-label="Cerrar detalle de traza"
              @click="emit('close')"
            >
              Cerrar
            </button>
          </div>
        </header>
        <div class="min-h-0 overflow-auto p-4">
          <p v-if="copyStatus" class="mb-3 text-sm text-[var(--color-fg-muted)]" role="status">
            {{ copyStatus }}
          </p>
          <pre class="max-w-full overflow-auto rounded-xl bg-black/5 p-3 text-xs whitespace-pre-wrap break-all dark:bg-white/5">{{ formatted }}</pre>
        </div>
      </section>
    </div>
  </Teleport>
</template>
