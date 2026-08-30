<script setup lang="ts">
import ImageUploadDropZone from '~/components/ImageUploadDropZone.vue'
import { activeDataScope } from '~/lib/db'
import {
  createLoraZip,
  cleanLoraCaption,
  duplicateTextFilenames,
  finalLoraText,
  generateLoraCaption,
  isSupportedLoraImage,
  textFilename
} from '~/lib/loraAssistant'
import { fetchLlmModels } from '~/lib/llm'

type RowStatus = 'pending' | 'generating' | 'complete' | 'failed'
interface LoraRow {
  id: number
  file: File
  previewUrl: string
  status: RowStatus
  caption: string
  error: string | null
  debug: { messages: unknown[]; response: unknown } | null
}

const settings = useSettingsStore()
await settings.load()

const rows = ref<LoraRow[]>([])
const prefix = ref('')
const models = ref<string[]>([])
const model = ref(settings.activeModel)
const modelLoading = ref(false)
const running = ref(false)
const notice = ref<string | null>(null)
const error = ref<string | null>(null)
let nextId = 1
let controller: AbortController | null = null

const completeRows = computed(() => rows.value.filter((row) => row.status === 'complete'))
const failedRows = computed(() => rows.value.filter((row) => row.status === 'failed'))
const pendingRows = computed(() => rows.value.filter((row) => row.status === 'pending'))
const activeRows = computed(() => rows.value.filter((row) => row.status === 'pending' || row.status === 'failed'))
const generatedCount = computed(() => completeRows.value.length)
const progressLabel = computed(() => `${generatedCount.value} de ${rows.value.length} completadas`)

async function loadModels() {
  modelLoading.value = true
  error.value = null
  try {
    models.value = await fetchLlmModels(activeDataScope.value)
    if (!model.value || !models.value.includes(model.value)) model.value = models.value[0] ?? ''
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudieron cargar los modelos de LM Studio.'
  } finally {
    modelLoading.value = false
  }
}

function addFiles(files: File[]) {
  notice.value = null
  error.value = null
  const unsupported = files.filter((file) => !isSupportedLoraImage(file))
  const accepted = files.filter(isSupportedLoraImage)
  if (unsupported.length) {
    error.value = 'Solo se admiten imágenes JPEG, PNG o WebP.'
  }
  for (const file of accepted) {
    rows.value.push({
      id: nextId++, file, previewUrl: URL.createObjectURL(file), status: 'pending', caption: '', error: null, debug: null
    })
  }
  const duplicates = duplicateTextFilenames(rows.value.map((row) => row.file))
  if (duplicates.length) error.value = `Nombres TXT duplicados: ${duplicates.join(', ')}. Elimínalos antes de generar.`
}

function removeRow(row: LoraRow) {
  URL.revokeObjectURL(row.previewUrl)
  rows.value = rows.value.filter((item) => item !== row)
  if (!duplicateTextFilenames(rows.value.map((item) => item.file)).length) error.value = null
}

function clearRows() {
  controller?.abort()
  controller = null
  for (const row of rows.value) URL.revokeObjectURL(row.previewUrl)
  rows.value = []
  notice.value = null
  error.value = null
}

async function generate(targetRows = activeRows.value) {
  if (running.value || !targetRows.length) return
  const duplicates = duplicateTextFilenames(rows.value.map((row) => row.file))
  if (duplicates.length) {
    error.value = `Nombres TXT duplicados: ${duplicates.join(', ')}. Elimínalos antes de generar.`
    return
  }
  if (!model.value) {
    error.value = 'Selecciona un modelo visual de LM Studio.'
    return
  }
  running.value = true
  notice.value = null
  error.value = null
  const runController = new AbortController()
  controller = runController
  try {
    for (const row of targetRows) {
      if (runController.signal.aborted) break
      row.status = 'generating'
      row.error = null
      try {
        const result = await generateLoraCaption(row.file, {
          model: model.value,
          temperature: settings.activeTemperature,
          maxTokens: settings.activeMaxTokens,
          signal: runController.signal
        })
        row.caption = result.caption
        row.debug = { messages: result.messages, response: result.response }
        row.status = 'complete'
      } catch (caught) {
        row.status = 'failed'
        row.error = (caught as Error).message || 'No se pudo generar la descripción.'
        const failure = caught as { messages?: unknown[]; response?: unknown }
        row.debug = {
          messages: failure.messages ?? [],
          response: failure.response ?? { error: row.error }
        }
        if (runController.signal.aborted) row.status = 'pending'
      }
    }
    if (runController.signal.aborted) notice.value = `Generación cancelada. ${progressLabel.value}.`
    else if (failedRows.value.length) notice.value = `${generatedCount.value} completadas; ${failedRows.value.length} fallidas. Puedes reintentarlas.`
    else notice.value = `${generatedCount.value} descripciones generadas.`
  } finally {
    if (controller === runController) controller = null
    running.value = false
  }
}

function retryRow(row: LoraRow) {
  if (running.value || row.status !== 'failed') return
  void generate([row])
}

function cancel() {
  controller?.abort()
}

async function downloadZip() {
  error.value = null
  const entries = completeRows.value.map((row) => ({
    filename: textFilename(row.file.name),
    content: finalLoraText(prefix.value, row.caption)
  }))
  const duplicates = duplicateTextFilenames(completeRows.value.map((row) => row.file))
  if (!entries.length) {
    error.value = 'Genera al menos una descripción antes de descargar.'
    return
  }
  if (completeRows.value.some((row) => !cleanLoraCaption(row.caption))) {
    error.value = 'Todas las descripciones completadas deben tener contenido.'
    return
  }
  if (duplicates.length) {
    error.value = `Nombres TXT duplicados: ${duplicates.join(', ')}. Elimínalos antes de descargar.`
    return
  }
  const blob = await createLoraZip(entries)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'lora-captions.zip'
  link.click()
  URL.revokeObjectURL(url)
  notice.value = failedRows.value.length
    ? `ZIP descargado. ${failedRows.value.length} imagenes fallidas quedaron fuera.`
    : 'ZIP descargado.'
}

function debugText(row: LoraRow) {
  return row.debug ? JSON.stringify(row.debug, null, 2) : ''
}

watch(activeDataScope, () => {
  clearRows()
  prefix.value = ''
  model.value = settings.activeModel
  void loadModels()
}, { flush: 'sync' })
onBeforeUnmount(clearRows)
await loadModels()
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Asistente LoRA</h1>
        <p class="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
          Crea descripciones TXT desde tus imágenes para usarlas en un entrenamiento LoRA.
        </p>
      </div>
      <NuxtLink to="/settings" class="btn-ghost">Volver a Ajustes</NuxtLink>
    </div>

    <section class="mt-6 grid min-w-0 gap-4 rounded-xl border border-[var(--color-border-soft)] p-4 sm:grid-cols-2">
      <div class="min-w-0">
        <label class="label" for="lora-prefix">Prefijo común (opcional)</label>
        <input id="lora-prefix" v-model="prefix" class="field w-full" placeholder="nombre o token del personaje">
      </div>
      <div class="min-w-0">
        <label class="label" for="lora-model">Modelo visual LM Studio</label>
        <div class="flex min-w-0 gap-2">
          <select id="lora-model" v-model="model" class="field min-w-0 flex-1" :disabled="modelLoading || running">
            <option value="">Selecciona un modelo</option>
            <option v-for="availableModel in models" :key="availableModel" :value="availableModel">{{ availableModel }}</option>
          </select>
          <button type="button" class="btn-ghost shrink-0" :disabled="modelLoading || running" @click="loadModels">Actualizar</button>
        </div>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">Usa la conexión LM Studio del ámbito activo.</p>
      </div>
    </section>

    <section class="mt-4 rounded-xl border border-[var(--color-border-soft)] p-4">
      <ImageUploadDropZone
        :busy="running"
        label="Seleccionar imágenes"
        busy-label="Generando…"
        zone-label="Añadir imágenes para el asistente LoRA"
        multiple
        @select="addFiles"
        @error="error = $event"
      />
      <p v-if="error" role="alert" class="mt-3 text-sm text-red-500">{{ error }}</p>
      <p v-if="notice" role="status" class="mt-3 text-sm text-[var(--color-fg-muted)]">{{ notice }}</p>
    </section>

    <section v-if="rows.length" class="mt-4 min-w-0 rounded-xl border border-[var(--color-border-soft)] p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-semibold">Imágenes ({{ rows.length }})</h2>
          <p class="text-xs text-[var(--color-fg-muted)]">{{ progressLabel }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary" :disabled="running || !activeRows.length" @click="generate()">
            {{ failedRows.length ? 'Reintentar fallidas' : 'Generar descripciones' }}
          </button>
          <button v-if="running" type="button" class="btn-ghost" @click="cancel">Cancelar</button>
          <button type="button" class="btn-ghost" :disabled="running" @click="downloadZip">Descargar ZIP</button>
          <button type="button" class="btn-ghost" :disabled="running" @click="clearRows">Limpiar</button>
        </div>
      </div>

      <div class="mt-4 space-y-3">
        <article v-for="row in rows" :key="row.id" class="grid min-w-0 gap-3 rounded-lg border border-[var(--color-border-soft)] p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
          <img :src="row.previewUrl" :alt="row.file.name" class="h-20 w-20 rounded object-cover">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium" :title="row.file.name">{{ row.file.name }}</p>
            <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
              <span v-if="row.status === 'pending'">Pendiente</span>
              <span v-else-if="row.status === 'generating'">Generando…</span>
              <span v-else-if="row.status === 'complete'">Completada</span>
              <span v-else>Fallida</span>
            </p>
            <textarea v-if="row.status === 'complete'" v-model="row.caption" rows="3" class="field mt-2 w-full" aria-label="Descripción editable" />
            <p v-if="row.error" role="alert" class="mt-2 text-xs text-red-500">{{ row.error }}</p>
            <details v-if="row.debug" class="mt-2 text-xs">
              <summary class="cursor-pointer text-[var(--color-fg-muted)]">Ver debug de esta imagen</summary>
              <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/5 p-2 dark:bg-white/5">{{ debugText(row) }}</pre>
            </details>
          </div>
          <div class="flex gap-2 self-start">
            <button v-if="row.status === 'failed'" type="button" class="btn-ghost" :disabled="running" :aria-label="`Reintentar ${row.file.name}`" @click="retryRow(row)">Reintentar</button>
            <button type="button" class="btn-ghost" :disabled="running" :aria-label="`Quitar ${row.file.name}`" @click="removeRow(row)">Quitar</button>
          </div>
        </article>
      </div>
      <p v-if="pendingRows.length" class="mt-3 text-xs text-[var(--color-fg-muted)]">Las pendientes no se incluirán en el ZIP.</p>
    </section>
  </div>
</template>
