<script setup lang="ts">
import { activeDataScope } from '~/lib/db'
import {
  generateCharacterReferencePrompt,
  isSupportedCharacterReferenceImage
} from '~/lib/characterReferencePrompt'

const prompt = defineModel<string>({ required: true })

const settings = useSettingsStore()
await settings.load()

const referenceFile = ref<File | null>(null)
const referenceUrl = ref<string | null>(null)
const generating = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
let controller: AbortController | null = null

function revokeReferenceUrl() {
  if (referenceUrl.value) URL.revokeObjectURL(referenceUrl.value)
  referenceUrl.value = null
}

function clearReference() {
  if (generating.value) return
  referenceFile.value = null
  revokeReferenceUrl()
  error.value = null
  notice.value = null
}

function selectReference(files: File[]) {
  const file = files[0]
  if (!file || generating.value) return
  error.value = null
  notice.value = null
  if (!isSupportedCharacterReferenceImage(file)) {
    error.value = 'Solo se admiten fotos JPEG, PNG o WebP.'
    return
  }
  revokeReferenceUrl()
  referenceFile.value = file
  referenceUrl.value = URL.createObjectURL(file)
}

async function generatePrompt() {
  const file = referenceFile.value
  if (!file || generating.value) return
  generating.value = true
  error.value = null
  notice.value = null
  const runController = new AbortController()
  controller = runController
  try {
    const generated = await generateCharacterReferencePrompt(file, {
      model: settings.activeModel,
      temperature: settings.activeTemperature,
      maxTokens: settings.activeMaxTokens,
      systemPrompt: settings.effectiveCharacterReferencePrompt,
      scope: activeDataScope.value,
      signal: runController.signal
    })
    prompt.value = generated
    notice.value = 'Prompt visual base generado.'
  } catch (caught) {
    if (runController.signal.aborted) return
    error.value = (caught as Error).message || 'No se pudo generar el prompt visual.'
  } finally {
    if (controller === runController) controller = null
    generating.value = false
  }
}

function resetForScopeChange() {
  controller?.abort()
  controller = null
  generating.value = false
  referenceFile.value = null
  revokeReferenceUrl()
  error.value = null
  notice.value = null
}

watch(activeDataScope, resetForScopeChange, { flush: 'sync' })
onBeforeUnmount(resetForScopeChange)
</script>

<template>
  <section class="grid gap-4" data-testid="character-appearance-editor">
    <div>
      <h2 class="text-lg font-semibold">Apariencia</h2>
      <p class="mt-1 text-sm text-[var(--color-fg-muted)]">
        Define rasgos visuales reutilizables para crear imágenes del personaje.
      </p>
    </div>

    <div>
      <label class="label" for="character-visual-prompt">Prompt visual base</label>
      <textarea
        id="character-visual-prompt"
        v-model="prompt"
        autocomplete="off"
        class="field min-h-28"
        placeholder="young woman, red hair, green eyes, blue traveling coat"
      />
      <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
        Se antepone a prompts de imagen y conjuntos SwarmUI. Puedes escribirlo o generarlo desde una foto.
      </p>
    </div>

    <div class="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] p-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
      <div class="min-w-0">
        <ImageUploadDropZone
          :busy="generating"
          label="Seleccionar foto de referencia"
          busy-label="Analizando…"
          zone-label="Añadir foto de referencia"
          accept="image/jpeg,image/png,image/webp"
          @select="selectReference"
          @error="error = $event"
        />
      </div>
      <div v-if="referenceUrl" class="grid justify-items-center gap-2">
        <img
          :src="referenceUrl"
          alt="Vista previa de foto de referencia"
          class="h-28 w-28 rounded-lg bg-black/5 object-contain"
        >
        <button
          type="button"
          class="btn-ghost"
          :disabled="generating"
          @click="clearReference"
        >
          Quitar foto
        </button>
      </div>
    </div>

    <button
      type="button"
      class="btn-primary justify-self-start"
      :disabled="!referenceFile || generating"
      @click="generatePrompt"
    >
      {{ generating ? 'Generando…' : 'Generar prompt desde foto' }}
    </button>
    <p v-if="error" class="text-sm text-red-500" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="text-sm text-green-600" role="status">{{ notice }}</p>
  </section>
</template>
