<script setup lang="ts">
import type { StoredImage } from '~/lib/db'
import { primaryTag, tagKey } from '~/lib/tags'
import { generateCharacterImagePrompt } from '~/lib/characterImagePrompt'
import { fetchSwarmCatalog, fetchSwarmImage, type SwarmCatalog } from '~/lib/swarm'

const props = defineProps<{ characterId: string }>()
const imageGenerationPreset = defineModel<string>('imageGenerationPreset', { required: true })

const characters = useCharactersStore()
const settings = useSettingsStore()
const confirmDialog = useConfirmStore()
await settings.load()
const pendingTags = ref<string[]>([])
const pendingFiles = ref<File[]>([])
const batchMode = ref<'original' | 'crop' | null>(null)
const batchTags = ref<string[]>([])
const processingCurrent = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const swarmCatalog = ref<SwarmCatalog | null>(null)
const catalogLoading = ref(false)
const generationTags = ref<string[]>([])
const generationNotes = ref('')
const generationPrompt = ref('')
const generationModel = ref('')
const promptBusy = ref(false)
const generationBusy = ref(false)
const generationError = ref<string | null>(null)
const generationNotice = ref<string | null>(null)
let addedCount = 0
let failedCount = 0
let skippedCount = 0

const images = computed(() => characters.imagesFor(props.characterId))
const galleryItems = computed(() => {
  const characterName = characters.byId(props.characterId)?.name ?? 'Personaje'
  return images.value.map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: `${characterName} ${primaryTag(image) ?? ''}`.trim(),
    downloadName: downloadName(image)
  }))
})
const imageTagSuggestions = computed(() =>
  characters.images.flatMap((image) => visibleImageTags(image.tags))
)
const pendingFile = computed(() => pendingFiles.value[0] ?? null)

async function loadSwarmCatalog() {
  catalogLoading.value = true
  generationError.value = null
  try {
    swarmCatalog.value = await fetchSwarmCatalog()
    if (!generationModel.value && swarmCatalog.value.models[0]) {
      generationModel.value = swarmCatalog.value.models[0]
    }
    return true
  } catch (caught) {
    generationError.value = (caught as Error).message || 'No se pudo conectar con SwarmUI.'
    return false
  } finally {
    catalogLoading.value = false
  }
}

async function createGenerationPrompt() {
  const character = characters.byId(props.characterId)
  if (!character || promptBusy.value) return
  promptBusy.value = true
  generationError.value = null
  generationNotice.value = null
  try {
    generationPrompt.value = await generateCharacterImagePrompt(
      {
        character,
        tags: generationTags.value,
        notes: generationNotes.value
      },
      {
        useChromeLlm: settings.activeUseChromeLlm,
        model: settings.settings.model,
        temperature: settings.settings.temperature
      }
    )
  } catch (caught) {
    generationError.value = (caught as Error).message || 'No se pudo crear el prompt.'
  } finally {
    promptBusy.value = false
  }
}

async function generateImage() {
  if (!generationPrompt.value.trim() || generationBusy.value) return
  generationBusy.value = true
  generationError.value = null
  generationNotice.value = null
  try {
    if (!swarmCatalog.value && !await loadSwarmCatalog()) return
    const preset = imageGenerationPreset.value.trim()
    const model = generationModel.value.trim()
    if (!preset && !model) throw new Error('Selecciona un preset o un modelo de SwarmUI.')
    const blob = await fetchSwarmImage({
      prompt: generationPrompt.value,
      ...(preset ? { preset } : { model })
    })
    await characters.addImage(props.characterId, blob, [])
    generationNotice.value = 'Imagen generada y guardada en la galería.'
  } catch (caught) {
    generationError.value = (caught as Error).message || 'No se pudo generar la imagen.'
  } finally {
    generationBusy.value = false
  }
}

function visibleImageTags(tags: string[]) {
  return tags.filter((tag) => tagKey(tag) !== 'neutral')
}

function selectFiles(files: File[]) {
  if (busy.value || files.length === 0) return
  error.value = null
  notice.value = null
  batchTags.value = [...pendingTags.value]
  pendingFiles.value = [...files]
  addedCount = 0
  failedCount = 0
  skippedCount = 0
  busy.value = true
  batchMode.value = files.length === 1 ? 'crop' : null
}

async function addPendingImage(file: Blob) {
  await characters.addImage(props.characterId, file, batchTags.value)
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
  patch: Partial<Pick<StoredImage, 'tags' | 'isDefault'>>
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
      Etiquetas indican al modelo qué imagen usar. Pulsa badges o escribe una etiqueta nueva.
      Imágenes se limitan a 1920px y se guardan en WebP.
    </p>

    <div class="card mb-4 grid min-w-0 gap-3" data-testid="character-swarm-generator">
      <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div>
          <h3 class="font-semibold">Generar imagen con SwarmUI</h3>
          <p class="text-xs text-[var(--color-fg-muted)]">
            Flujo manual: crea o edita el prompt y después genera una imagen.
          </p>
        </div>
        <button
          type="button"
          class="btn-ghost shrink-0"
          :disabled="catalogLoading"
          @click="loadSwarmCatalog"
        >
          {{ catalogLoading ? 'Cargando…' : 'Cargar catálogo SwarmUI' }}
        </button>
      </div>

      <div class="grid min-w-0 gap-3 sm:grid-cols-2">
        <div>
          <label class="label" for="character-swarm-preset">Preset SwarmUI</label>
          <input
            id="character-swarm-preset"
            v-model="imageGenerationPreset"
            list="character-swarm-presets"
            autocomplete="off"
            class="field min-w-0"
            placeholder="Vacío para usar un modelo"
          >
          <datalist id="character-swarm-presets">
            <option v-for="preset in swarmCatalog?.presets ?? []" :key="preset" :value="preset" />
          </datalist>
        </div>
        <div v-if="!imageGenerationPreset.trim()">
          <label class="label" for="character-swarm-model">Modelo SwarmUI</label>
          <select id="character-swarm-model" v-model="generationModel" class="field min-w-0">
            <option value="">Selecciona un modelo</option>
            <option v-for="model in swarmCatalog?.models ?? []" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
        </div>
      </div>

      <div>
        <label class="label" for="generation-tags">Etiquetas para el prompt</label>
        <TagInput
          id="generation-tags"
          v-model="generationTags"
          placeholder="plano entero, enfadada"
        />
      </div>
      <div>
        <label class="label" for="generation-notes">Notas para el prompt</label>
        <textarea
          id="generation-notes"
          v-model="generationNotes"
          autocomplete="off"
          class="field min-h-20"
          placeholder="Postura, ropa, emoción o detalles de esta imagen."
        />
      </div>
      <button
        type="button"
        class="btn-ghost justify-self-start"
        :disabled="promptBusy"
        @click="createGenerationPrompt"
      >
        {{ promptBusy ? 'Creando…' : 'Crear prompt con IA' }}
      </button>
      <div>
        <label class="label" for="generation-prompt">Prompt de imagen (inglés y editable)</label>
        <textarea
          id="generation-prompt"
          v-model="generationPrompt"
          autocomplete="off"
          class="field min-h-28"
          placeholder="Describe pose, clothing and emotion…"
        />
      </div>
      <button
        type="button"
        class="btn-primary justify-self-start"
        :disabled="generationBusy || !generationPrompt.trim()"
        @click="generateImage"
      >
        {{ generationBusy ? 'Generando…' : 'Generar imagen' }}
      </button>
      <p v-if="generationError" class="text-sm text-red-500" role="alert">
        {{ generationError }}
      </p>
      <p v-else-if="generationNotice" class="text-sm text-green-600" role="status">
        {{ generationNotice }}
      </p>
    </div>

    <div class="card mb-4 grid gap-3">
      <div>
        <label class="label" for="new-tags">Nueva etiqueta</label>
        <TagInput
          id="new-tags"
          v-model="pendingTags"
          :suggestions="imageTagSuggestions"
          show-all-suggestions
          placeholder="feliz"
        />
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
      <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>
      <p v-else-if="notice" class="text-sm text-green-600" role="status">{{ notice }}</p>
    </div>

    <p v-if="images.length === 0" class="text-sm text-[var(--color-fg-muted)]">
      Sin imágenes todavía.
    </p>

    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <li v-for="image in images" :key="image.id" class="card flex min-w-0 flex-col gap-3 sm:flex-row">
        <ImageLightbox
          :src="characters.urlFor(image.id)!"
          alt=""
          container-class="w-full shrink-0 sm:h-24 sm:w-24"
          image-class="max-h-56 w-full rounded-lg object-contain sm:h-24 sm:w-24"
          :download-name="downloadName(image)"
          :gallery-items="galleryItems"
        />
        <div class="min-w-0 flex-1 space-y-2">
          <TagInput
            :model-value="visibleImageTags(image.tags)"
            :suggestions="imageTagSuggestions"
            show-all-suggestions
            aria-label="Nueva etiqueta de imagen"
            placeholder="Nueva etiqueta"
            @update:model-value="updateImage(image.id, { tags: $event })"
          />
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
