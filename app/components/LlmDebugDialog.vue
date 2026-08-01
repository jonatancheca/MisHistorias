<script setup lang="ts">
import type { LlmDebugTrace } from '#shared/types'

const props = defineProps<{ trace: LlmDebugTrace | null }>()
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)

const formattedRequest = computed(() => JSON.stringify(props.trace?.request ?? {}, null, 2))
const formattedResponse = computed(() => JSON.stringify(props.trace?.response ?? {}, null, 2))

watch(
  () => props.trace,
  async (trace) => {
    if (!trace) return
    await nextTick()
    closeButton.value?.focus()
  }
)

function keepFocus() {
  closeButton.value?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="trace"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
      @click.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
      @keydown.tab.prevent="keepFocus"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-debug-dialog-title"
        class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl min-w-0 flex-col rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-soft)] p-4">
          <div class="min-w-0">
            <h2 id="llm-debug-dialog-title" class="text-lg font-bold">Debug LLM</h2>
            <p class="truncate text-xs text-[var(--color-fg-muted)]">
              {{ trace.status === 'success' ? 'Respuesta recibida' : 'Llamada fallida' }}
            </p>
          </div>
          <button
            ref="closeButton"
            type="button"
            class="btn-ghost shrink-0"
            aria-label="Cerrar debug LLM"
            @click="emit('close')"
          >
            Cerrar
          </button>
        </header>

        <div class="min-h-0 overflow-y-auto p-4">
          <div class="grid min-w-0 gap-4 lg:grid-cols-2">
            <section class="min-w-0">
              <h3 class="mb-2 text-sm font-semibold">Enviado</h3>
              <pre class="max-h-[60dvh] overflow-auto rounded-xl bg-black/5 p-3 text-xs whitespace-pre-wrap break-words dark:bg-white/5">{{ formattedRequest }}</pre>
            </section>
            <section class="min-w-0">
              <h3 class="mb-2 text-sm font-semibold">Respuesta</h3>
              <pre class="max-h-[60dvh] overflow-auto rounded-xl bg-black/5 p-3 text-xs whitespace-pre-wrap break-words dark:bg-white/5">{{ formattedResponse }}</pre>
            </section>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
