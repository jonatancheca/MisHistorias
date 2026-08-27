<script setup lang="ts">
import type { LlmDebugTrace, Message } from '#shared/types'

defineProps<{
  message: Message
  editable?: boolean
  debugTrace?: LlmDebugTrace | null
  compactionTrace?: LlmDebugTrace | null
}>()
const emit = defineEmits<{
  edit: []
  remove: []
  regenerate: []
  resend: []
  debug: [LlmDebugTrace]
}>()
</script>

<template>
  <div v-if="editable || debugTrace || compactionTrace" class="flex shrink-0 gap-1">
    <button
      v-if="debugTrace"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-amber-500/10 hover:text-amber-600"
      aria-label="Ver datos de debug de la llamada LLM"
      title="Debug LLM"
      @click="emit('debug', debugTrace)"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 2h8M9 2v3m6-3v3M4 13h3m10 0h3M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2" />
        <rect x="7" y="5" width="10" height="16" rx="5" />
        <path d="M9 11h6m-6 4h6" />
      </svg>
    </button>
    <button
      v-if="compactionTrace"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-violet-500/10 hover:text-violet-600"
      aria-label="Ver datos de debug de la compactación"
      title="Debug compactación"
      @click="emit('debug', compactionTrace)"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 8h16M7 4h10M7 12h10M9 16h6M11 20h2" />
      </svg>
    </button>
    <button
      v-if="editable"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
      aria-label="Editar mensaje"
      title="Editar"
      @click="emit('edit')"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
    <button
      v-if="editable"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/10 hover:text-red-500"
      aria-label="Borrar mensaje"
      title="Borrar"
      @click="emit('remove')"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
      </svg>
    </button>
    <button
      v-if="editable && message.role === 'assistant'"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
      aria-label="Regenerar desde este mensaje"
      title="Regenerar desde aquí"
      @click="emit('regenerate')"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
      </svg>
    </button>
    <button
      v-if="editable && message.role === 'user'"
      type="button"
      class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
      aria-label="Reenviar este mensaje"
      title="Reenviar desde aquí"
      @click="emit('resend')"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
      </svg>
    </button>
  </div>
</template>
