<script setup lang="ts">
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const stories = useStoriesStore()
const privacy = usePrivacyStore()
const confirm = useConfirmStore()
const summary = ref('')
const initialSummary = ref('')
const busy = ref(false)
const confirming = ref(false)
const measuring = ref(false)
const error = ref<string | null>(null)
const preview = shallowRef<Awaited<ReturnType<typeof stories.previewWrittenSummary>> | null>(null)
const saved = shallowRef<Awaited<ReturnType<typeof stories.saveWrittenSummary>> | null>(null)
const dirty = computed(() => summary.value !== initialSummary.value)
let request: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let returnFocusTestId: string | null = null
const format = (value: number) => value.toLocaleString('es-ES')

function cancelPreview() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  request?.abort()
}

function updatePreview() {
  if (!props.open || busy.value || saved.value) return
  cancelPreview()
  preview.value = null
  error.value = null
  measuring.value = true
  const current = new AbortController()
  request = current
  timer = setTimeout(async () => {
    timer = null
    try {
      const result = await stories.previewWrittenSummary(summary.value, current.signal)
      if (!current.signal.aborted) preview.value = result
    } catch (caught) {
      if (!current.signal.aborted) error.value = (caught as Error).message
    } finally {
      if (request === current) measuring.value = false
    }
  }, 120)
}

async function canDiscard() {
  if (busy.value) return false
  if (!dirty.value) return true
  confirming.value = true
  try {
    return await confirm.ask({
      title: 'Descartar resumen sin guardar',
      message: 'Los cambios de este resumen se perderán. El resumen guardado de la historia se conservará.',
      confirmLabel: 'Descartar cambios'
    })
  } finally {
    confirming.value = false
  }
}

async function close() {
  if (!await canDiscard()) return
  cancelPreview()
  emit('close')
  await nextTick()
  if (returnFocusTestId) document.querySelector<HTMLElement>(`[data-testid="${returnFocusTestId}"]`)?.focus()
}

async function saveSummary() {
  if (busy.value || measuring.value || !preview.value?.canSummarize || !preview.value.fits || !summary.value.trim()) return
  cancelPreview()
  const current = new AbortController()
  request = current
  busy.value = true
  error.value = null
  try {
    const result = await stories.saveWrittenSummary(summary.value, current.signal)
    if (current.signal.aborted) return
    saved.value = result
    initialSummary.value = summary.value
  } catch (caught) {
    if (!current.signal.aborted) {
      const failure = caught as Error & { data?: { message?: string } }
      error.value = failure.data?.message ?? failure.message
    }
  } finally {
    if (request === current) busy.value = false
  }
}

watch([() => props.open, () => stories.activeStory?.id, () => privacy.mode], () => {
  cancelPreview()
  busy.value = false
  saved.value = null
  preview.value = null
  error.value = null
  if (!props.open) return
  returnFocusTestId = document.activeElement?.getAttribute('data-testid') ?? null
  initialSummary.value = stories.activeStory?.contextSummary ?? ''
  summary.value = initialSummary.value
  updatePreview()
}, { immediate: true })
watch(summary, updatePreview)
onBeforeRouteLeave(() => !props.open || canDiscard())
onBeforeUnmount(cancelPreview)
</script>

<template>
  <SettingsDialog :open="open && !confirming" title="Escribir resumen" title-id="story-written-summary-title" :busy="busy" @close="close">
    <p class="text-sm text-[var(--color-fg-muted)]">
      Incluye el planteamiento y un resumen acumulado de todo lo ocurrido hasta la última respuesta del Narrador.
      Parte del resumen vigente, si existe, y añade los hechos posteriores: al guardar sustituirá al planteamiento y al historial resumido, además del resumen anterior.
      Los mensajes originales, las intervenciones pendientes y el borrador se conservan.
    </p>
    <form class="mt-4 space-y-4" @submit.prevent="saveSummary">
      <div>
        <label for="written-story-summary" class="mb-2 block text-sm font-semibold">Resumen escrito a mano</label>
        <textarea
          id="written-story-summary"
          v-model="summary"
          class="field min-h-48 w-full resize-y"
          rows="8"
          :disabled="busy || Boolean(saved)"
          aria-describedby="written-summary-help"
          data-dialog-autofocus
        />
        <p id="written-summary-help" class="mt-2 text-xs text-[var(--color-fg-muted)]">
          No se genera texto con IA. Los tokens se comprueban al guardar si el modelo está disponible;
          si no pueden medirse, el resumen se guarda con «Tokens sin verificar».
        </p>
      </div>
      <p v-if="measuring" role="status" class="text-sm">Midiendo caracteres…</p>
      <div v-if="preview && !saved" class="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <p>Contexto actual: {{ format(preview.before.characters) }} caracteres.</p>
        <p>Con el resumen: {{ format(preview.after.characters) }} caracteres<template v-if="preview.after.characterLimit"> / {{ format(preview.after.characterLimit) }}</template>.</p>
      </div>
      <p v-if="preview && !preview.canSummarize" class="text-sm">No hay historial anterior que resumir.</p>
      <p v-else-if="preview && !preview.fits && !saved" role="alert" class="text-sm text-red-500">El contexto con este resumen supera el límite de caracteres. Acorta el resumen o aumenta el límite en Ajustes.</p>
      <p v-if="preview?.doesNotReduce && !saved" class="text-sm text-[var(--color-fg-muted)]">Este resumen no reduce el contexto. Puedes guardarlo para corregir o ampliar los hechos.</p>
      <p v-if="error" role="alert" class="break-words text-sm text-red-500">{{ error }}</p>
      <p v-if="busy" role="status" class="text-sm">Comprobando límites y guardando resumen…</p>
      <div v-if="saved" role="status" class="space-y-2 text-sm">
        <p>Resumen guardado. No se ha generado ninguna continuación.</p>
        <p>{{ format(saved.after.characters) }} caracteres de contexto. <template v-if="saved.after.tokens !== null">{{ format(saved.after.tokens) }} tokens.</template></p>
        <p v-if="!saved.tokensVerified">Tokens sin verificar. Se comprobarán los límites del modelo antes de generar una nueva respuesta.</p>
        <p v-if="saved.doesNotReduce">El resumen guardado no reduce el contexto.</p>
      </div>
      <div v-if="!saved" class="flex flex-wrap justify-end gap-2">
        <button type="submit" class="btn-primary" :disabled="busy || measuring || !summary.trim() || !preview?.canSummarize || !preview.fits">Guardar resumen</button>
      </div>
    </form>
  </SettingsDialog>
</template>
