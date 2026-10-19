<script setup lang="ts">
import type { LlmDebugTrace } from '#shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; compact: [] }>()
const stories = useStoriesStore()
const settings = useSettingsStore()
const selectedTrace = shallowRef<LlmDebugTrace | null>(null)
const traces = computed(() => [...stories.compactionTraces].sort((a, b) => b.createdAt - a.createdAt))
let previousFocus: HTMLElement | null = null

watch(() => props.open, (open) => {
  selectedTrace.value = null
  if (open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
})

async function closeHistory() {
  emit('close')
  await nextTick()
  if (previousFocus?.isConnected) previousFocus.focus()
  previousFocus = null
}

async function compactHistory() {
  await closeHistory()
  emit('compact')
}

const formatDate = (date: number) => new Date(date).toLocaleString('es-ES')
</script>

<template>
  <SettingsDialog
    :open="open && !selectedTrace"
    title="Compactaciones de la historia"
    title-id="story-compaction-history-title"
    @close="closeHistory"
  >
    <template v-if="open">
      <div v-if="stories.activeStory && !stories.activeStory.readOnly" class="mb-4 flex justify-end">
        <button
          type="button"
          class="btn-primary"
          :disabled="stories.generating || stories.deletingCompaction || settings.settings.mockMode"
          aria-haspopup="dialog"
          @click="compactHistory"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16h4" />
          </svg>
          Compactar historia
        </button>
      </div>
      <p v-if="stories.debugTracesLoading" role="status">Cargando compactaciones…</p>
      <p v-else-if="stories.debugTracesError" role="alert">
        No se pudieron cargar las compactaciones. Vuelve a abrir la historia para reintentar.
      </p>
      <template v-else>
        <p v-if="!traces.length" class="text-sm">No hay compactaciones conservadas en esta historia.</p>
        <template v-else>
          <p class="mb-4 text-sm text-[var(--color-fg-muted)]">
            {{ stories.compactionCount }} {{ stories.compactionCount === 1 ? 'compactación correcta conservada' : 'compactaciones correctas conservadas' }}.
            Las fallidas no cuentan. Más recientes primero.
          </p>
          <ol class="space-y-3" aria-label="Historial de compactaciones">
            <li v-for="trace in traces" :key="trace.id" :data-compaction-trace-id="trace.id">
              <time :datetime="new Date(trace.createdAt).toISOString()" class="mb-1 block text-xs text-[var(--color-fg-muted)]">
                {{ formatDate(trace.createdAt) }}
              </time>
              <StoryCompactionMarker :trace="trace" @inspect="selectedTrace = $event" />
            </li>
          </ol>
        </template>
      </template>
    </template>
  </SettingsDialog>
  <LlmDebugDialog
    :trace="selectedTrace"
    :history-budget="settings.activeHistoryBudget"
    @close="selectedTrace = null"
  />
</template>
