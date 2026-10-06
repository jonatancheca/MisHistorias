<script setup lang="ts">
import { CompactionCapacityError, type StoryContextMeasurement } from '~/lib/contextBudget'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const stories = useStoriesStore()
const settings = useSettingsStore()
const privacy = usePrivacyStore()
const before = ref<StoryContextMeasurement | null>(null)
const after = ref<StoryContextMeasurement | null>(null)
const measuring = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const offerAlternatives = ref(false)
let request: AbortController | null = null
const format = (value: number) => value.toLocaleString('es-ES')
const tokenCount = (value: StoryContextMeasurement) => value.tokens === null ? 'Tokens no disponibles' : `${format(value.tokens)} tokens`

async function refresh() {
  request?.abort()
  const current = new AbortController()
  request = current
  measuring.value = true
  error.value = null
  before.value = null
  after.value = null
  offerAlternatives.value = false
  try {
    const result = await stories.measureStoryContext(current.signal)
    if (!current.signal.aborted) before.value = result
  } catch (caught) {
    if (!current.signal.aborted) error.value = (caught as Error).message
  } finally {
    if (request === current) measuring.value = false
  }
}

async function compact(blocks = false, allowOverCapacity = false) {
  if (busy.value || stories.generating || !before.value?.canCompact) return
  request?.abort()
  const current = new AbortController()
  request = current
  busy.value = true
  error.value = null
  try {
    const result = await stories.compactStory({ allowBlocks: blocks, allowOverCapacity }, current.signal)
    if (current.signal.aborted || !result) return
    before.value = result.before
    after.value = result.after
  } catch (caught) {
    if (current.signal.aborted) return
    error.value = (caught as Error).message
    offerAlternatives.value ||= caught instanceof CompactionCapacityError
  } finally {
    if (request === current) busy.value = false
  }
}

function cancel() {
  if (stories.compactionSaving) return
  request?.abort()
  busy.value = false
  error.value = 'Compactación cancelada. Se ha conservado el resumen anterior.'
}

watch([() => props.open, () => stories.activeStory?.id, () => privacy.mode], () => {
  request?.abort()
  busy.value = false
  measuring.value = false
  if (props.open && stories.activeStory && !stories.activeStory.readOnly) void refresh()
}, { immediate: true })
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <SettingsDialog :open="open" title="Compactar historia" title-id="story-compaction-title" :busy="busy" @close="emit('close')">
    <p class="text-sm text-[var(--color-fg-muted)]">
      Resume el historial sin continuar la historia. Conserva los mensajes originales y las intervenciones pendientes.
      Las medidas incluyen las instrucciones, el resumen y el historial del narrador, sin el borrador de escritura.
    </p>
    <p v-if="measuring" class="mt-4 text-sm" role="status">Midiendo contexto del narrador…</p>
    <div v-if="before" class="mt-4 grid min-w-0 gap-3 sm:grid-cols-2" aria-live="polite">
      <section class="min-w-0 rounded-xl border border-[var(--color-border-soft)] p-3" data-testid="manual-compaction-before">
        <h3 class="font-semibold">{{ after ? 'Antes' : 'Contexto actual' }}</h3>
        <p class="mt-2 break-words">{{ format(before.characters) }} caracteres</p>
        <p class="break-words">{{ tokenCount(before) }}</p>
      </section>
      <section v-if="after" class="min-w-0 rounded-xl border border-[var(--color-border-soft)] p-3" data-testid="manual-compaction-after">
        <h3 class="font-semibold">Después</h3>
        <p class="mt-2 break-words">{{ format(after.characters) }} caracteres</p>
        <p class="break-words">{{ tokenCount(after) }}</p>
        <p class="mt-2 text-sm text-[var(--color-fg-muted)]">
          Reducción: {{ format(before.characters - after.characters) }} caracteres<template v-if="before.tokens !== null && after.tokens !== null"> y {{ format(before.tokens - after.tokens) }} tokens</template>.
        </p>
      </section>
    </div>
    <p v-if="before?.tokenError && !after" class="mt-3 break-words text-sm text-[var(--color-fg-muted)]">
      {{ before.tokenError }}
    </p>
    <p v-if="settings.settings.mockMode" class="mt-3 text-sm">La compactación no está disponible en modo mock.</p>
    <p v-else-if="before && !before.canCompact && !before.tokenError" class="mt-3 text-sm">No hay historial anterior que compactar.</p>
    <p v-if="busy" class="mt-4 text-sm" role="status">{{ stories.compactionSaving ? 'Guardando compactación…' : 'El Narrador está compactando el historial…' }}</p>
    <p v-if="after" class="mt-4 text-sm" role="status">Historia compactada. No se ha generado ninguna continuación.</p>
    <p v-if="error" class="mt-4 break-words text-sm text-red-500" role="alert">{{ error }}</p>
    <p v-if="offerAlternatives && !busy && !after" class="mt-3 text-sm text-[var(--color-fg-muted)]">
      Al compactar igualmente, la petición puede superar la capacidad del modelo y fallar.
    </p>
    <div class="mt-5 flex flex-wrap justify-end gap-2">
      <button v-if="busy" type="button" class="btn-ghost" :disabled="stories.compactionSaving" @click="cancel">Cancelar compactación</button>
      <template v-else-if="!after">
        <button type="button" class="btn-ghost" :disabled="measuring || stories.generating" @click="refresh">Actualizar medidas</button>
        <template v-if="offerAlternatives">
          <button type="button" class="btn-primary" :disabled="measuring || stories.generating || !before?.canCompact" @click="compact(true)">Compactar por bloques</button>
          <button type="button" class="btn-ghost" :disabled="measuring || stories.generating || !before?.canCompact" @click="compact(false, true)">Compactar igualmente</button>
        </template>
        <button v-else type="button" class="btn-primary" :disabled="measuring || stories.generating || !before?.canCompact" data-dialog-autofocus @click="compact()">Compactar</button>
      </template>
    </div>
  </SettingsDialog>
</template>
