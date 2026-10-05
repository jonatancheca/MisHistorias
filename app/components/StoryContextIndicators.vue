<script setup lang="ts">
import type { StoryContextMeasurement } from '~/lib/contextBudget'

withDefaults(defineProps<{ placement?: 'top' | 'bottom' }>(), { placement: 'top' })
const emit = defineEmits<{ history: [] }>()

const stories = useStoriesStore()
const settings = useSettingsStore()
const privacy = usePrivacyStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const modelPreload = useLlmModelPreloadStore()
const compactionLabel = computed(() => {
  if (stories.debugTracesLoading) return 'Compactaciones: cargando…'
  if (stories.debugTracesError) return 'Compactaciones: no disponibles'
  return `Compactada ${stories.compactionCount} ${stories.compactionCount === 1 ? 'vez' : 'veces'}`
})
const measurement = shallowRef<StoryContextMeasurement | null>(null)
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null

const indicators = computed(() => {
  const current = measurement.value
  if (!current) return []
  const candidates = [
    { unit: 'tokens', label: 'Contexto (tokens)', count: current.tokens, limit: current.tokenLimit },
    { unit: 'characters', label: 'Contexto (caracteres)', count: current.characters, limit: current.characterLimit }
  ]
  return candidates.flatMap(({ unit, label, count, limit }) => {
    if (count === null || !Number.isFinite(count) || count < 0 || limit <= 0) return []
    const percent = count / limit * 100
    const format = (value: number) => value.toLocaleString('es-ES')
    const tooltip = `${label}: ${percent.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % ocupado · ${format(count)} / ${format(limit)} · ${compactionLabel.value}`
    return [{ unit, percent, tooltip }]
  })
})

function cancelMeasurement() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  controller?.abort()
  controller = null
}

function scheduleMeasurement() {
  cancelMeasurement()
  measurement.value = null
  if (!stories.activeStory || stories.activeStory.readOnly || privacy.switching ||
      stories.generating || stories.deletingCompaction ||
      (!settings.activeHistoryBudget && !settings.activeContextTokenBudget)) return
  // Agrupa cambios y deja disponibles la historia y el cuadro de escritura.
  timer = setTimeout(() => {
    timer = null
    const current = new AbortController()
    controller = current
    void stories.measureStoryContext(current.signal, true).then(result => {
      if (controller === current && !current.signal.aborted) measurement.value = result
    }).catch(() => {
      // Un indicador auxiliar fallido no debe convertirse en un aviso de generación.
    }).finally(() => {
      if (controller === current) controller = null
    })
  }, 120)
}

watch([
  () => stories.activeStory, () => stories.messages,
  () => settings.settings, () => privacy.mode, () => privacy.switching,
  () => stories.generating, () => stories.deletingCompaction,
  () => characters.characters, () => characters.images,
  () => backgrounds.backgrounds, () => sounds.sounds,
  () => modelPreload.currentAttempt?.status
], scheduleMeasurement, { deep: true, immediate: true })

onBeforeUnmount(cancelMeasurement)
</script>

<template>
  <div v-if="indicators.length" class="story-context-indicators" :class="{ 'story-context-indicators-below': placement === 'bottom' }" role="group" aria-label="Ocupación del contexto">
    <button
      v-for="indicator in indicators"
      :key="indicator.unit"
      type="button"
      class="story-context-indicator"
      :data-testid="`story-context-${indicator.unit}`"
      :aria-label="indicator.tooltip"
      :title="indicator.tooltip"
      aria-haspopup="dialog"
      @click="emit('history')"
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#cbd5e1" stroke-width="3" />
        <circle
          cx="10" cy="10" r="8" pathLength="100" stroke="#475569" stroke-width="3"
          :stroke-dasharray="`${Math.min(indicator.percent, 100)} 100`"
          transform="rotate(-90 10 10)"
        />
      </svg>
      <span class="story-context-tooltip" role="tooltip">{{ indicator.tooltip }}</span>
    </button>
  </div>
</template>

<style scoped>
.story-context-indicators { display: flex; align-items: center; gap: 0.75rem; }
.story-context-indicator { position: relative; display: flex; flex: 0 0 16px; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
.story-context-indicator:focus-visible { outline: 2px solid var(--color-brand-400); outline-offset: 3px; }
.story-context-tooltip {
  position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(100% + 0.75rem); z-index: 60;
  width: max-content; max-width: min(24rem, calc(100vw - 2rem)); padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-soft); border-radius: 0.5rem;
  background: var(--color-surface); color: var(--color-fg); box-shadow: 0 4px 16px #0002;
  font-size: 0.75rem; line-height: 1.5; white-space: normal; pointer-events: none;
  visibility: hidden; opacity: 0;
}
.story-context-indicator:hover .story-context-tooltip,
.story-context-indicator:focus .story-context-tooltip { visibility: visible; opacity: 1; }
.story-context-indicators-below .story-context-tooltip {
  top: calc(100% + 0.75rem); bottom: auto; left: auto; right: 0; transform: none;
  max-width: min(24rem, calc(100vw - 4rem));
}
</style>
