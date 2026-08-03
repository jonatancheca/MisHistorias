<script setup lang="ts">
import type { StoredImage } from '~/lib/db'
import { primaryTag } from '~/lib/tags'

const props = defineProps<{ characterId: string }>()

const characters = useCharactersStore()
const confirmDialog = useConfirmStore()
const pendingTags = ref<string[]>([])
const pendingDescription = ref('')
const pendingFiles = ref<File[]>([])
const batchMode = ref<'original' | 'crop' | null>(null)
const batchTags = ref<string[]>([])
const batchDescription = ref('')
const processingCurrent = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
let addedCount = 0
let failedCount = 0
let skippedCount = 0

const images = computed(() => characters.imagesFor(props.characterId))
const pendingFile = computed(() => pendingFiles.value[0] ?? null)

function selectFiles(files: File[]) {
  if (busy.value || files.length === 0) return
  error.value = null
  notice.value = null
  batchTags.value = [...pendingTags.value]
  batchDescription.value = pendingDescription.value
  pendingFiles.value = [...files]
  addedCount = 0
  failedCount = 0
  skippedCount = 0
  busy.value = true
  batchMode.value = files.length === 1 ? 'crop' : null
}

async function addPendingImage(file: Blob) {
  await characters.addImage(
    props.characterId,
    file,
    batchTags.value,
    batchDescription.value
  )
}

function finishBatch() {
  const parts: string[] = []
  if (addedCount) parts.push(`${addedCount} ${addedCount === 1 ? 'imagen añadida' : 'imágenes añadidas'}`)
  if (skippedCount) parts.push(`${skippedCount} ${skippedCount === 1 ? 'omitida' : 'omitidas'}`)
  if (failedCount) parts.push(`${failedCount} ${failedCount === 1 ? 'fallida' : 'fallidas'}`)

  const summary = `${parts.join(', ') || 'No se añadió ninguna imagen'}.`
  if (failedCount) error.value = summary
  else notice.value = summary
  if (addedCount) {
    pendingTags.value = []
    pendingDescription.value = ''
  }
  pendingFiles.value = []
  batchMode.value = null
  processingCurrent.value = false
  busy.value = false
}

function cancelBatch() {
  pendingFiles.value = []
  batchMode.value = null
  busy.value = false
}

async function chooseBatchMode(mode: 'original' | 'crop' | 'cancel') {
  if (mode === 'cancel') {
    cancelBatch()
    return
  }
  batchMode.value = mode
  if (mode !== 'original') return

  while (pendingFiles.value.length) {
    const file = pendingFiles.value[0]!
    pendingFiles.value = pendingFiles.value.slice(1)
    try {
      await addPendingImage(file)
      addedCount++
    } catch {
      failedCount++
    }
  }
  finishBatch()
}

async function processCrop(file: Blob) {
  if (processingCurrent.value || !pendingFile.value) return
  processingCurrent.value = true
  try {
    await addPendingImage(file)
    addedCount++
  } catch {
    failedCount++
  } finally {
    pendingFiles.value = pendingFiles.value.slice(1)
    processingCurrent.value = false
    if (pendingFiles.value.length === 0) finishBatch()
  }
}

function skipCrop() {
  if (processingCurrent.value || !pendingFile.value) return
  pendingFiles.value = pendingFiles.value.slice(1)
  skippedCount++
  if (pendingFiles.value.length === 0) finishBatch()
}

function downloadPart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'imagen'
}

function extensionFor(image: StoredImage) {
  const mimeType = image.mimeType || image.blob.type
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/svg+xml') return 'svg'
  return mimeType.startsWith('image/') ? (mimeType.slice(6).split('+')[0] || 'img') : 'img'
}

function downloadName(image: StoredImage) {
  const character = characters.byId(props.characterId)
  return [
    downloadPart(character?.name ?? 'personaje'),
    downloadPart(primaryTag(image) ?? 'imagen'),
    downloadPart(image.id)
  ].join('-') + `.${extensionFor(image)}`
}

async function updateImage(
  id: string,
  patch: Partial<Pick<StoredImage, 'tags' | 'description' | 'isDefault'>>
) {
  error.value = null
  try {
    await characters.updateImage(id, patch)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar la imagen.'
    await characters.load(true)
  }
}

async function remove(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar imagen',
    message: 'Esta imagen se borrará definitivamente.'
  })
  if (!accepted) return
  await characters.removeImage(id)
}
</script>

<template>
  <section>
    <h2 class="mb-1 text-lg font-semibold">Imágenes</h2>
    <p class="mb-4 text-sm text-[var(--color-fg-muted)]">
      Etiquetas indican al modelo qué imagen usar. Pulsa Enter o coma para añadir varias.
      Imágenes se limitan a 1920px y se guardan en WebP.
    </p>

    <div class="card mb-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <div>
        <label class="label" for="new-tags">Etiquetas</label>
        <TagInput id="new-tags" v-model="pendingTags" placeholder="feliz" />
      </div>
      <div>
        <label class="label" for="new-desc">Descripción</label>
        <input
          id="new-desc"
          v-model="pendingDescription"
          autocomplete="off"
          class="field"
          placeholder="Sonríe, relajada, mirando de frente"
        >
      </div>
      <ImageUploadDropZone
        :busy="busy"
        multiple
        label="Añadir imagen"
        busy-label="Procesando…"
        zone-label="Arrastrar, pegar o seleccionar imagen"
        @select="selectFiles"
        @error="error = $event"
      />
      <p v-if="error" class="text-sm text-red-500 sm:col-span-3" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="text-sm text-green-600 sm:col-span-3" role="status">{{ notice }}</p>
    </div>

    <p v-if="images.length === 0" class="text-sm text-[var(--color-fg-muted)]">
      Sin imágenes todavía.
    </p>

    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="image in images" :key="image.id" class="card flex min-w-0 flex-col gap-3 sm:flex-row">
        <ImageLightbox
          :src="characters.urlFor(image.id)!"
          alt=""
          container-class="w-full shrink-0 sm:h-24 sm:w-24"
          image-class="max-h-56 w-full rounded-lg object-contain sm:h-24 sm:w-24"
          :download-name="downloadName(image)"
        />
        <div class="min-w-0 flex-1 space-y-2">
          <TagInput
            :model-value="image.tags"
            aria-label="Etiquetas de imagen"
            placeholder="neutral"
            @update:model-value="updateImage(image.id, { tags: $event })"
          />
          <input
            class="field"
            :value="image.description"
            autocomplete="off"
            placeholder="descripción"
            @change="updateImage(image.id, { description: ($event.target as HTMLInputElement).value })"
          >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <input
                type="radio"
                autocomplete="off"
                :name="`default-${characterId}`"
                :checked="image.isDefault"
                class="accent-brand-500"
                @change="updateImage(image.id, { isDefault: true })"
              >
              Por defecto
            </label>
            <div class="flex flex-wrap gap-2">
              <a
                :href="characters.urlFor(image.id)!"
                :download="downloadName(image)"
                class="btn-ghost"
              >
                Descargar
              </a>
              <button type="button" class="btn-danger" @click="remove(image.id)">Borrar</button>
            </div>
          </div>
        </div>
      </li>
    </ul>

    <ImageBatchModeDialog
      v-if="busy && pendingFiles.length > 1 && batchMode === null"
      :count="pendingFiles.length"
      @choose="chooseBatchMode"
    />

    <ImageCropDialog
      v-if="batchMode === 'crop' && pendingFile && !processingCurrent"
      :file="pendingFile"
      @cancel="skipCrop"
      @confirm="processCrop"
    />
  </section>
</template>
