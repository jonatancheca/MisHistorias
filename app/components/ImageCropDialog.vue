<script setup lang="ts">
import Cropper from 'cropperjs'

const props = defineProps<{
  file: File
}>()

const emit = defineEmits<{
  cancel: []
  confirm: [file: Blob]
}>()

const MAX_SIDE = 1920
const QUALITY = 0.9
const cropperContainer = ref<HTMLElement | null>(null)
const sourceImage = ref<HTMLImageElement | null>(null)
const objectUrl = ref('')
const busy = ref(false)
const ready = ref(false)
const error = ref<string | null>(null)
let cropper: Cropper | null = null

const CROPPER_TEMPLATE = `
  <cropper-canvas background>
    <cropper-image></cropper-image>
    <cropper-shade hidden></cropper-shade>
    <cropper-selection movable resizable outlined keyboard>
      <cropper-grid role="grid" bordered covered></cropper-grid>
      <cropper-crosshair centered></cropper-crosshair>
      <cropper-handle action="move" theme-color="rgba(255, 255, 255, 0.35)"></cropper-handle>
      <cropper-handle action="n-resize"></cropper-handle>
      <cropper-handle action="e-resize"></cropper-handle>
      <cropper-handle action="s-resize"></cropper-handle>
      <cropper-handle action="w-resize"></cropper-handle>
      <cropper-handle action="ne-resize"></cropper-handle>
      <cropper-handle action="nw-resize"></cropper-handle>
      <cropper-handle action="se-resize"></cropper-handle>
      <cropper-handle action="sw-resize"></cropper-handle>
    </cropper-selection>
  </cropper-canvas>
`

function selectionBounds() {
  const canvas = cropper?.getCropperCanvas()
  const image = cropper?.getCropperImage()
  if (!canvas || !image) return null
  const canvasRect = canvas.getBoundingClientRect()
  const imageRect = image.getBoundingClientRect()
  return {
    x: imageRect.left - canvasRect.left,
    y: imageRect.top - canvasRect.top,
    width: imageRect.width,
    height: imageRect.height
  }
}

function keepSelectionInsideImage(event: Event) {
  const bounds = selectionBounds()
  if (!bounds) return
  const detail = (event as CustomEvent<{ x: number; y: number; width: number; height: number }>).detail
  if (
    detail.x < bounds.x ||
    detail.y < bounds.y ||
    detail.x + detail.width > bounds.x + bounds.width ||
    detail.y + detail.height > bounds.y + bounds.height
  ) {
    event.preventDefault()
  }
}

function initializeSelection() {
  const selection = cropper?.getCropperSelection()
  const bounds = selectionBounds()
  if (!selection || !bounds || bounds.width <= 0 || bounds.height <= 0) return false
  const coverage = 0.85
  const width = bounds.width * coverage
  const height = bounds.height * coverage
  selection.$change(
    bounds.x + (bounds.width - width) / 2,
    bounds.y + (bounds.height - height) / 2,
    width,
    height
  )
  selection.addEventListener('change', keepSelectionInsideImage)
  return true
}

onMounted(async () => {
  objectUrl.value = URL.createObjectURL(props.file)
  await nextTick()
  if (!sourceImage.value || !cropperContainer.value) return
  try {
    await sourceImage.value.decode()
    cropper = new Cropper(sourceImage.value, {
      container: cropperContainer.value,
      template: CROPPER_TEMPLATE
    })
    await cropper.getCropperImage()?.$ready()
    requestAnimationFrame(() => {
      ready.value = Boolean(initializeSelection())
      if (!ready.value) error.value = 'No se pudo preparar el área de recorte.'
    })
  } catch {
    error.value = 'No se pudo abrir la imagen para recortarla.'
  }
})

onUnmounted(() => {
  cropper?.destroy()
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value)
})

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo crear el recorte.'))),
      'image/webp',
      QUALITY
    )
  })
}

async function crop() {
  const selection = cropper?.getCropperSelection()
  const image = cropper?.getCropperImage()
  if (!selection || !image || !sourceImage.value) {
    error.value = 'Selecciona una zona válida.'
    return
  }
  busy.value = true
  error.value = null
  try {
    const imageRect = image.getBoundingClientRect()
    const sourceScale = sourceImage.value.naturalWidth / imageRect.width
    const naturalWidth = Math.max(1, selection.width * sourceScale)
    const naturalHeight = Math.max(1, selection.height * sourceScale)
    const outputScale = Math.min(1, MAX_SIDE / Math.max(naturalWidth, naturalHeight))
    const canvas = await selection.$toCanvas({
      width: Math.max(1, Math.round(naturalWidth * outputScale)),
      height: Math.max(1, Math.round(naturalHeight * outputScale))
    })
    emit('confirm', await canvasToBlob(canvas))
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo crear el recorte.'
  } finally {
    busy.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !busy.value) emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-title"
      @keydown="onKeydown"
    >
      <section class="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl">
        <header class="border-b border-[var(--color-border-soft)] px-4 py-3">
          <h2 id="crop-title" class="text-lg font-bold">Recortar imagen</h2>
          <p class="text-xs text-[var(--color-fg-muted)]">Mueve y redimensiona selección. Recorte libre.</p>
        </header>

        <div ref="cropperContainer" class="min-h-0 flex-1 bg-black">
          <img ref="sourceImage" :src="objectUrl" alt="Imagen para recortar" class="hidden">
        </div>

        <p v-if="error" class="px-4 pt-3 text-sm text-red-500" role="alert">{{ error }}</p>
        <footer class="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-soft)] p-3">
          <button type="button" class="btn-ghost" :disabled="busy" @click="emit('cancel')">Cancelar</button>
          <button type="button" class="btn-ghost" :disabled="busy" @click="emit('confirm', file)">
            Usar original
          </button>
          <button type="button" class="btn-primary" :disabled="busy || !ready || Boolean(error)" @click="crop">
            {{ busy ? 'Recortando…' : 'Guardar recorte' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
:deep(cropper-canvas) {
  display: block;
  height: min(65vh, 36rem);
  width: 100%;
}
</style>
