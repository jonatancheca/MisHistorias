<script setup lang="ts">
import type { LlmDebugTrace } from '#shared/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
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
