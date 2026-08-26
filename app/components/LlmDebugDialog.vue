<script setup lang="ts">
import type { LlmDebugTrace } from '#shared/types'

const props = defineProps<{ trace: LlmDebugTrace | null }>()
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)
const showRawRequest = ref(false)

const formattedRequest = computed(() => JSON.stringify(props.trace?.request ?? {}, null, 2))
const formattedResponse = computed(() => JSON.stringify(props.trace?.response ?? {}, null, 2))
const requestMessages = computed(() => props.trace?.request.messages ?? [])
const providerLabel = computed(() => {
  if (props.trace?.request.provider === 'lmstudio') return 'LM Studio'
  if (props.trace?.request.provider === 'chrome') return 'Chrome integrado'
  return 'No indicado'
})

const roleLabels = {
  system: 'Sistema',
  user: 'Usuario',
  assistant: 'Asistente'
} as const

watch(
  () => props.trace,
  async (trace) => {
    if (!trace) return
    showRawRequest.value = false
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
              <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 class="text-sm font-semibold">Enviado</h3>
                <button
                  type="button"
                  class="btn-ghost px-3 py-1.5 text-xs"
                  :aria-pressed="showRawRequest"
                  @click="showRawRequest = !showRawRequest"
                >
                  {{ showRawRequest ? 'Ver vista sencilla' : 'Ver JSON real' }}
                </button>
              </div>

              <pre
                v-if="showRawRequest"
                data-testid="llm-debug-request-json"
                class="max-h-[60dvh] overflow-auto rounded-xl bg-black/5 p-3 text-xs whitespace-pre-wrap break-words dark:bg-white/5"
              >{{ formattedRequest }}</pre>

              <div v-else data-testid="llm-debug-request-sections" class="space-y-3">
                <section class="rounded-xl border border-[var(--color-border-soft)] p-3">
                  <h4 class="mb-2 text-xs font-semibold tracking-wide text-[var(--color-fg-muted)] uppercase">
                    Datos de llamada
                  </h4>
                  <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div class="min-w-0">
                      <dt class="text-xs text-[var(--color-fg-muted)]">Proveedor</dt>
                      <dd class="truncate">{{ providerLabel }}</dd>
                    </div>
                    <div class="min-w-0">
                      <dt class="text-xs text-[var(--color-fg-muted)]">Modelo</dt>
                      <dd class="truncate">{{ trace.request.model || 'No indicado' }}</dd>
                    </div>
                    <div>
                      <dt class="text-xs text-[var(--color-fg-muted)]">Temperatura</dt>
                      <dd>{{ trace.request.temperature }}</dd>
                    </div>
                    <div>
                      <dt class="text-xs text-[var(--color-fg-muted)]">Tokens máximos</dt>
                      <dd>{{ trace.request.max_tokens }}</dd>
                    </div>
                  </dl>
                </section>

                <section
                  v-for="(message, index) in requestMessages"
                  :key="`${message.role}-${index}`"
                  class="min-w-0 rounded-xl border border-[var(--color-border-soft)] p-3"
                >
                  <h4 class="mb-2 text-xs font-semibold tracking-wide text-[var(--color-fg-muted)] uppercase">
                    {{ roleLabels[message.role] }} · Mensaje {{ index + 1 }}
                  </h4>
                  <pre class="overflow-x-auto text-xs whitespace-pre-wrap break-words">{{ message.content }}</pre>
                </section>

                <p v-if="!requestMessages.length" class="rounded-xl bg-black/5 p-3 text-sm text-[var(--color-fg-muted)] dark:bg-white/5">
                  No hay mensajes enviados.
                </p>
              </div>
            </section>
            <section class="min-w-0">
              <h3 class="mb-2 text-sm font-semibold">Respuesta</h3>
              <pre data-testid="llm-debug-response-json" class="max-h-[60dvh] overflow-auto rounded-xl bg-black/5 p-3 text-xs whitespace-pre-wrap break-words dark:bg-white/5">{{ formattedResponse }}</pre>
            </section>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
