<script setup lang="ts">
import { activeDataScope, type StoredImage } from '~/lib/db'
import { createSwarmBatch, runSwarmBatch } from '~/lib/swarmBatch'
import { primaryTag, tagKey } from '~/lib/tags'
import { generateCharacterImagePrompt } from '~/lib/characterImagePrompt'
import { fetchSwarmCatalog, fetchSwarmImage, type SwarmCatalog } from '~/lib/swarm'

const props = defineProps<{ characterId: string }>()
const imageGenerationPreset = defineModel<string>('imageGenerationPreset', { required: true })
const imageGenerationLora = defineModel<string>('imageGenerationLora', { required: true })
const imageGenerationSeed = defineModel<string>('imageGenerationSeed', { required: true })
const imageGenerationPromptPrefix = defineModel<string>('imageGenerationPromptPrefix', {
  required: true
})

const characters = useCharactersStore()
const settings = useSettingsStore()
const swarmPrompts = useSwarmPromptsStore()
const confirmDialog = useConfirmStore()
await settings.load()
const pendingTags = ref<string[]>([])
const pendingFiles = ref<File[]>([])
const batchMode = ref<'original' | 'crop' | 'preview' | null>(null)
const batchTags = ref<string[]>([])
const processingCurrent = ref(false)
const busy = ref(false)
const editingImage = ref<StoredImage | null>(null)
const editingBusy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const swarmCatalog = ref<SwarmCatalog | null>(null)
const catalogLoading = ref(false)
const generationTags = ref<string[]>([])
const generationNotes = ref('')
const generationPrompt = ref('')
const generationCount = ref('1')
const generationCompleted = ref(0)
const generationTotal = ref(0)
const generationCurrentPrompt = ref('')
const generationLastImageUrl = ref<string | null>(null)
let generationController: AbortController | null = null
const swarmConfigured = computed(() => Boolean(settings.settings.swarmBaseUrl.trim()))
function cancelGeneration() { generationController?.abort() }
function revokeGenerationLastImage() {
  if (generationLastImageUrl.value) URL.revokeObjectURL(generationLastImageUrl.value)
  generationLastImageUrl.value = null
}
onBeforeUnmount(() => {
  cancelGeneration()
  revokeGenerationLastImage()
})
onBeforeRouteLeave(() => { cancelGeneration() })
watch(activeDataScope, cancelGeneration, { flush: 'sync' })
watch(swarmConfigured, (configured) => { if (!configured) { cancelGeneration(); generationOpen.value = false } })
const generationModel = ref('')
const promptBusy = ref(false)
const generationBusy = ref(false)
const generationProgressOpen = ref(false)
const generationError = ref<string | null>(null)
const generationNotice = ref<string | null>(null)
const generationOpen = ref(false)
let addedCount = 0
let failedCount = 0
let skippedCount = 0

const images = computed(() => characters.imagesFor(props.characterId))
const galleryItems = computed(() => {
  const characterName = characters.byId(props.characterId)?.name ?? 'Personaje'
  return images.value.map((image) => ({
    id: image.id,
    src: characters.urlFor(image.id)!,
    alt: characterName,
    downloadName: downloadName(image),
    tags: [...image.tags],
    generation: image.generation
  }))
})
const metadataOpenId = ref<string | null>(null)
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

async function toggleGeneration() {
  generationOpen.value = !generationOpen.value
  if (!generationOpen.value) return
  try {
    await Promise.all([
      swarmPrompts.load(true),
      !swarmCatalog.value ? loadSwarmCatalog() : Promise.resolve()
    ])
  } catch (caught) {
    generationError.value = (caught as Error).message || 'No se pudieron cargar los prompts SwarmUI.'
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
        model: settings.activeModel,
        temperature: settings.activeTemperature,
        maxTokens: settings.activeMaxTokens
      }
    )
  } catch (caught) {
    generationError.value = (caught as Error).message || 'No se pudo crear el prompt.'
  } finally {
    promptBusy.value = false
  }
}

async function generateImage(asSet = false) {
  if (!generationPrompt.value.trim() || generationBusy.value || !swarmConfigured.value) return
  generationBusy.value = true
  generationError.value = null
  generationNotice.value = null
  generationCompleted.value = 0
  generationTotal.value = 0
  generationCurrentPrompt.value = ''
  revokeGenerationLastImage()
  const scope = activeDataScope.value
  const characterId = props.characterId
  const controller = new AbortController()
  generationController = controller
  try {
    if (asSet) await swarmPrompts.load(true)
    const batch = createSwarmBatch({
      count: Number(generationCount.value), seed: imageGenerationSeed.value,
      prefix: imageGenerationPromptPrefix.value, prompt: generationPrompt.value,
      tags: generationTags.value, ...(asSet ? { prompts: swarmPrompts.prompts } : {})
    })
    generationTotal.value = batch.total
    const preset = imageGenerationPreset.value.trim()
    const lora = imageGenerationLora.value.trim()
    if (asSet && !await confirmDialog.ask({
      title: 'Crear conjunto de imágenes', confirmLabel: 'Crear conjunto',
      message: `${generationCount.value} imágenes × ${swarmPrompts.prompts.length} prompts = ${batch.total} imágenes. ¿Crear el conjunto?`
    })) return
    controller.signal.throwIfAborted()
    generationProgressOpen.value = true
    if (!swarmCatalog.value && !await loadSwarmCatalog()) {
      throw new Error(generationError.value || 'No se pudo cargar el catálogo SwarmUI.')
    }
    const model = generationModel.value.trim()
    if (!preset && !model) throw new Error('Selecciona un preset o un modelo de SwarmUI.')
    await runSwarmBatch({
      jobs: batch.jobs, signal: controller.signal,
      generate: (job) => {
        generationCurrentPrompt.value = job.prompt
        return fetchSwarmImage({
          prompt: job.prompt, ...(preset ? { preset } : {}), ...(model ? { model } : {}),
          ...(lora ? { lora } : {}), seed: String(job.generation.seed),
          variationSeed: job.generation.variationSeed,
          variationSeedStrength: job.generation.variationSeedStrength ?? 0,
          signal: controller.signal
        })
      },
      save: async (blob, job) => {
        await characters.addImage(characterId, blob, job.tags, undefined, {
          scope,
          generation: {
            ...job.generation,
            prompt: job.prompt,
            ...(lora ? { lora } : {}),
            ...(model ? { model } : {}),
            ...(preset ? { preset } : {})
          },
          signal: controller.signal
        })
        if (generationLastImageUrl.value) URL.revokeObjectURL(generationLastImageUrl.value)
        generationLastImageUrl.value = URL.createObjectURL(blob)
      },
      progress: (completed) => { generationCompleted.value = completed }
    })
    generationNotice.value = batch.total === 1 ? 'Imagen generada y guardada en la galería.' :
      `${batch.total} imágenes generadas y guardadas en la galería.`
  } catch (caught) {
    const summary = `${generationCompleted.value} guardadas; ${generationTotal.value - generationCompleted.value} pendientes.`
    if (controller.signal.aborted) generationNotice.value = `Generación cancelada. ${summary}`
    else generationError.value = `${(caught as Error).message || 'No se pudo generar la imagen.'} ${summary}`
  } finally {
    generationBusy.value = false
    generationProgressOpen.value = false
    generationController = null
    revokeGenerationLastImage()
  }
}

function visibleImageTags(tags: string[]) {
  return tags.filter((tag) => tagKey(tag) !== 'neutral')
}

function selectFiles(files: File[]) {
  if (busy.value || editingImage.value || editingBusy.value || files.length === 0) return
  error.value = null
  notice.value = null
  batchTags.value = [...pendingTags.value]
  pendingFiles.value = [...files]
  addedCount = 0
  failedCount = 0
  skippedCount = 0
  busy.value = true
  batchMode.value = files.length === 1 ? 'preview' : null
}

async function addPendingImage(file: Blob, originalFile?: Blob) {
  await characters.addImage(props.characterId, file, batchTags.value, originalFile)
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

async function processPendingImage(file: Blob) {
  if (processingCurrent.value || !pendingFile.value) return
  processingCurrent.value = true
  try {
    await addPendingImage(file, file !== pendingFile.value ? pendingFile.value : undefined)
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

function editCrop(image: StoredImage) {
  if (busy.value || editingBusy.value) return
  error.value = null
  notice.value = null
  editingImage.value = image
}

async function saveCrop(blob: Blob) {
  if (!editingImage.value || editingBusy.value) return
  editingBusy.value = true
  error.value = null
  try {
    await characters.cropImage(editingImage.value.id, blob)
    editingImage.value = null
    notice.value = 'Recorte guardado. Original conservada.'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar el recorte.'
  } finally {
    editingBusy.value = false
  }
}

async function restoreOriginal(image: StoredImage) {
  if (busy.value || editingBusy.value) return
  editingBusy.value = true
  error.value = null
  notice.value = null
  try {
    await characters.restoreImage(image.id)
    notice.value = 'Imagen original restaurada.'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo restaurar la original.'
  } finally {
    editingBusy.value = false
  }
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
      Pulsa una imagen para ampliarla y editar sus etiquetas.
      Imágenes se limitan a 1920px y se guardan en WebP.
    </p>

    <button
      v-if="swarmConfigured"
      type="button"
      class="btn-primary mb-4"
      data-testid="character-swarm-toggle"
      :aria-expanded="generationOpen"
      @click="toggleGeneration"
    >
      {{ generationOpen ? 'Ocultar creación de imagen' : 'Crear imagen con SwarmUI' }}
    </button>

    <div
      v-if="swarmConfigured && generationOpen"
      class="card mb-4 grid min-w-0 gap-3"
      data-testid="character-swarm-generator"
    >
      <fieldset :disabled="generationBusy" class="grid min-w-0 gap-3">
        <div class="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div>
            <h3 class="font-semibold">Generar imagen con SwarmUI</h3>
            <p class="text-xs text-[var(--color-fg-muted)]">
              Crea o edita el prompt y genera imágenes, solas o con todos los prompts predefinidos.
            </p>
          </div>
          <button
            type="button"
            class="btn-ghost shrink-0"
            :disabled="catalogLoading"
            @click="loadSwarmCatalog"
          >
            {{ catalogLoading ? 'Cargando…' : swarmCatalog ? 'Recargar catálogo SwarmUI' : 'Cargar catálogo SwarmUI' }}
          </button>
        </div>

        <div class="grid min-w-0 gap-3 md:grid-cols-3">
          <div>
            <label class="label" for="character-swarm-preset">Preset SwarmUI</label>
            <select
              id="character-swarm-preset"
              v-model="imageGenerationPreset"
              class="field min-w-0"
            >
              <option value="">Sin preset</option>
              <option
                v-if="imageGenerationPreset && !swarmCatalog?.presets.includes(imageGenerationPreset)"
                :value="imageGenerationPreset"
              >
                {{ imageGenerationPreset }} (no disponible)
              </option>
              <option v-for="preset in swarmCatalog?.presets ?? []" :key="preset" :value="preset">
                {{ preset }}
              </option>
            </select>
          </div>
          <div>
            <label class="label" for="character-swarm-model">Modelo SwarmUI</label>
            <select id="character-swarm-model" v-model="generationModel" class="field min-w-0">
              <option value="">Selecciona un modelo</option>
              <option v-for="model in swarmCatalog?.models ?? []" :key="model" :value="model">
                {{ model }}
              </option>
            </select>
          </div>
          <div>
            <label class="label" for="character-swarm-lora">LoRA SwarmUI</label>
            <select id="character-swarm-lora" v-model="imageGenerationLora" class="field min-w-0">
              <option value="">Sin LoRA</option>
              <option
                v-if="imageGenerationLora && !swarmCatalog?.loras.includes(imageGenerationLora)"
                :value="imageGenerationLora"
              >
                {{ imageGenerationLora }} (no disponible)
              </option>
              <option v-for="lora in swarmCatalog?.loras ?? []" :key="lora" :value="lora">
                {{ lora }}
              </option>
            </select>
          </div>
        </div>

        <div class="grid min-w-0 gap-3 md:grid-cols-2">
          <div>
            <label class="label" for="character-swarm-seed">Semilla SwarmUI</label>
            <input
              id="character-swarm-seed"
              v-model="imageGenerationSeed"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              class="field min-w-0"
              placeholder="Aleatoria"
            >
            <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Vacía usa una semilla aleatoria. Se recuerda para este personaje.
            </p>
          </div>
          <div>
            <label class="label" for="character-swarm-prompt-prefix">Prefijo del prompt</label>
            <textarea
              id="character-swarm-prompt-prefix"
              v-model="imageGenerationPromptPrefix"
              autocomplete="off"
              class="field min-h-20"
              placeholder="masterpiece, detailed character portrait"
            />
            <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Se antepone a prompts creados con IA o escritos manualmente.
            </p>
          </div>
        </div>

        <div>
          <label class="label" for="generation-tags">Etiquetas para el prompt</label>
          <TagInput
            id="generation-tags"
            v-model="generationTags"
            :suggestions="imageTagSuggestions"
            show-all-suggestions
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
        <div>
          <label class="label" for="generation-count">Número de imágenes</label>
          <input id="generation-count" v-model="generationCount" class="field" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off">
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="generationBusy || !generationPrompt.trim()"
            @click="generateImage(false)"
          >
            {{ generationBusy ? 'Generando…' : 'Generar imagen' }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="generationBusy || !generationPrompt.trim() || !swarmPrompts.prompts.length"
            @click="generateImage(true)"
          >
            Crear conjunto de imágenes
          </button>
          <NuxtLink v-if="swarmPrompts.prompts.length" to="/swarm-prompts" class="text-sm underline">
            Gestionar prompts SwarmUI
          </NuxtLink>
        </div>
        <p v-if="!swarmPrompts.prompts.length" class="text-sm text-[var(--color-fg-muted)]">
          Crea al menos un <NuxtLink to="/swarm-prompts" class="underline">prompt SwarmUI</NuxtLink> para generar un conjunto.
        </p>
        <p v-else-if="!generationPrompt.trim()" class="text-sm text-[var(--color-fg-muted)]">Indica el prompt base para crear el conjunto.</p>
      </fieldset>
      <ImageGenerationProgressDialog
        v-if="generationProgressOpen"
        :completed="generationCompleted"
        :total="generationTotal"
        :current-prompt="generationCurrentPrompt"
        :last-image-url="generationLastImageUrl"
        @cancel="cancelGeneration"
      />
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

    <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="image in images"
        :key="image.id"
        class="card flex min-w-0 flex-col gap-4"
        :class="{
          'border-amber-400 bg-amber-50/70 ring-2 ring-amber-300/60 dark:bg-amber-950/20':
            visibleImageTags(image.tags).length === 0 && !image.isDefault
        }"
        data-testid="character-image-card"
      >
        <div class="relative">
          <ImageLightbox
            :src="characters.urlFor(image.id)!"
            alt=""
            container-class="w-full shrink-0"
            image-class="h-56 w-full rounded-lg bg-black/5 object-contain sm:h-72"
            :download-name="downloadName(image)"
            :gallery-items="galleryItems"
          >
          <template #details="{ item }">
            <div v-if="item.id" class="grid gap-3">
              <div>
                <h3 class="font-semibold">Etiquetas de la imagen</h3>
                <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
                  Pulsa una disponible o escribe una nueva.
                </p>
              </div>
              <TagInput
                :model-value="visibleImageTags(item.tags ?? [])"
                :suggestions="imageTagSuggestions"
                show-all-suggestions
                aria-label="Nueva etiqueta de imagen visualizada"
                placeholder="Nueva etiqueta"
                @update:model-value="updateImage(item.id, { tags: $event })"
              />
              <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>
              <ImageGenerationMetadataPanel v-if="item.generation" :generation="item.generation" />
            </div>
          </template>
          </ImageLightbox>
          <button
            v-if="image.generation"
            type="button"
            class="absolute bottom-2 left-2 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow"
            aria-label="Mostrar metadatos de IA"
            @click.stop="metadataOpenId = metadataOpenId === image.id ? null : image.id"
          >IA</button>
        </div>
        <ImageGenerationMetadataPanel
          v-if="image.generation && metadataOpenId === image.id"
          :generation="image.generation"
        />
        <div class="min-w-0 flex-1 space-y-2">
          <div
            v-if="visibleImageTags(image.tags).length"
            class="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Etiquetas de la imagen"
            data-testid="character-image-tags"
          >
            <span
              v-for="tag in visibleImageTags(image.tags)"
              :key="tagKey(tag)"
              class="inline-flex max-w-full truncate rounded-full bg-brand-500/15 px-2 py-1 text-xs"
            >
              {{ tag }}
            </span>
          </div>
          <span
            v-if="visibleImageTags(image.tags).length === 0 && !image.isDefault"
            class="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
            data-testid="untagged-image-warning"
          >
            Sin etiqueta
          </span>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border-soft)] pt-3">
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
              <button type="button" class="btn-ghost" :disabled="busy || editingBusy" @click="editCrop(image)">
                Recortar
              </button>
              <button
                v-if="image.hasOriginal"
                type="button"
                class="btn-ghost"
                :disabled="busy || editingBusy"
                @click="restoreOriginal(image)"
              >
                Restaurar original
              </button>
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
      v-if="editingImage"
      :file="editingImage.blob"
      :saving="editingBusy"
      :save-error="error"
      :allow-original="false"
      @cancel="editingImage = null"
      @confirm="saveCrop"
    />

    <ImageCropDialog
      v-if="(batchMode === 'crop' || batchMode === 'preview') && pendingFile && !processingCurrent"
      :file="pendingFile"
      :start-cropping="batchMode === 'crop'"
      @cancel="skipCrop"
      @confirm="processPendingImage"
    />
  </section>
</template>
