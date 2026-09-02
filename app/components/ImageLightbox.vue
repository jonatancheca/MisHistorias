<script setup lang="ts">
import type { ImageGenerationMetadata } from '#shared/types'
interface GalleryItem {
  id?: string
  src: string
  alt: string
  downloadName?: string
  tags?: string[]
  generation?: ImageGenerationMetadata
}

const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    imageClass?: string
    containerClass?: string
    buttonClass?: string
    imageStyle?: Record<string, string>
    downloadName?: string
    galleryItems?: GalleryItem[]
    selectable?: boolean
  }>(),
  {
    imageClass: '',
    containerClass: '',
    buttonClass: '',
    imageStyle: undefined,
    downloadName: undefined,
    galleryItems: undefined,
    selectable: false
  }
)

const emit = defineEmits<{ select: [] }>()

const open = ref(false)
const activeIndex = ref(0)
const generationMetadataOpen = ref(false)
const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.5
const zoom = ref(MIN_ZOOM)
const viewport = ref<HTMLElement | null>(null)
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`)
const items = computed<GalleryItem[]>(() =>
  props.galleryItems?.length
    ? props.galleryItems
    : [{ src: props.src, alt: props.alt, downloadName: props.downloadName }]
)
const activeItem = computed(() => items.value[activeIndex.value] ?? items.value[0]!)
const canNavigate = computed(() => items.value.length > 1)

function show() {
  const index = items.value.findIndex((item) => item.src === props.src)
  activeIndex.value = index >= 0 ? index : 0
  generationMetadataOpen.value = false
  zoom.value = MIN_ZOOM
  open.value = true
  nextTick(resetViewport)
}

function activate() {
  if (props.selectable) emit('select')
  else show()
}

function close() {
  open.value = false
  generationMetadataOpen.value = false
  zoom.value = MIN_ZOOM
  resetViewport()
}

function move(offset: number) {
  if (!canNavigate.value) return
  activeIndex.value = (activeIndex.value + offset + items.value.length) % items.value.length
  generationMetadataOpen.value = false
  zoom.value = MIN_ZOOM
  nextTick(resetViewport)
}

function changeZoom(offset: number) {
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.value + offset))
  if (zoom.value === MIN_ZOOM) nextTick(resetViewport)
}

function resetZoom() {
  zoom.value = MIN_ZOOM
  nextTick(resetViewport)
}

function resetViewport() {
  if (!viewport.value) return
  viewport.value.scrollLeft = 0
  viewport.value.scrollTop = 0
}

function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey || zoom.value === MIN_ZOOM) {
    event.preventDefault()
    changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }
}

function toggleGenerationMetadata() {
  if (!activeItem.value.generation) return
  generationMetadataOpen.value = !generationMetadataOpen.value
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    move(1)
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    changeZoom(ZOOM_STEP)
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    changeZoom(-ZOOM_STEP)
  } else if (event.key === '0') {
    event.preventDefault()
    resetZoom()
  }
}

useDialogEscape(
  () => open.value,
  close
)

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div :class="['relative max-w-full', containerClass]">
    <button
      type="button"
      :class="[
        'block h-full w-full max-w-full rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500',
        selectable ? 'cursor-pointer' : 'cursor-zoom-in',
        buttonClass
      ]"
      :aria-label="`${selectable ? 'Cambiar' : 'Ampliar'} ${alt || 'imagen'}`"
      @click="activate"
    >
      <img :src="props.src" :alt="props.alt" :class="props.imageClass" :style="props.imageStyle">
    </button>
    <button
      v-if="selectable"
      type="button"
      class="absolute top-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/65 text-white shadow hover:bg-black/85 focus:outline-none focus:ring-2 focus:ring-brand-400"
      :aria-label="`Ampliar ${alt || 'imagen'}`"
      title="Ampliar imagen"
      @click.stop="show"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
      </svg>
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2"
      role="dialog"
      aria-modal="true"
      :aria-label="alt || 'Imagen ampliada'"
      @click.self="close"
    >
      <section
        class="flex max-h-[calc(100dvh-1rem)] w-full max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl lg:flex-row"
      >
        <div
          class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black/40"
        >
          <div
            ref="viewport"
            class="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6"
            data-testid="image-lightbox-viewport"
            role="region"
            aria-label="Desplazar imagen ampliada"
            @wheel="onWheel"
          >
            <img
              :src="activeItem.src"
              :alt="activeItem.alt"
              class="max-h-[calc(100dvh-2rem)] max-w-full shrink-0 rounded-xl object-contain transition-transform duration-200"
              :style="{ transform: `scale(${zoom})` }"
            >
          </div>
          <div
            class="absolute top-3 left-3 z-10 flex items-center gap-1 rounded-full bg-black/60 p-1 text-white"
            data-testid="image-lightbox-zoom"
            aria-label="Controles de zoom"
          >
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full text-xl hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Alejar imagen"
              title="Alejar imagen"
              :disabled="zoom <= MIN_ZOOM"
              @click="changeZoom(-ZOOM_STEP)"
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              class="min-w-14 rounded-full px-2 py-2 text-xs font-semibold hover:bg-white/15 disabled:cursor-default"
              aria-label="Restablecer zoom"
              title="Restablecer zoom"
              :disabled="zoom <= MIN_ZOOM"
              @click="resetZoom"
            >
              {{ zoomPercent }}
            </button>
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full text-xl hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Acercar imagen"
              title="Acercar imagen"
              :disabled="zoom >= MAX_ZOOM"
              @click="changeZoom(ZOOM_STEP)"
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <div class="absolute top-3 right-3 z-10 flex items-center gap-2">
            <a
              v-if="activeItem.downloadName"
              :href="activeItem.src"
              :download="activeItem.downloadName"
              class="rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white hover:bg-black/80"
            >
              Descargar
            </a>
            <button
              type="button"
              class="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-2xl text-white hover:bg-black/80"
              aria-label="Cerrar imagen"
              title="Cerrar"
              @click="close"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <button
            v-if="canNavigate"
            type="button"
            class="absolute left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
            aria-label="Imagen anterior"
            title="Imagen anterior"
            @click="move(-1)"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            v-if="activeItem.generation"
            type="button"
            class="absolute bottom-3 left-3 z-10 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow"
            :aria-label="generationMetadataOpen ? 'Ocultar metadatos de IA' : 'Mostrar metadatos de IA'"
            :aria-expanded="generationMetadataOpen"
            title="Metadatos de IA"
            @click.stop="toggleGenerationMetadata"
          >IA</button>
          <button
            v-if="canNavigate"
            type="button"
            class="absolute right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
            aria-label="Imagen siguiente"
            title="Imagen siguiente"
            @click="move(1)"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <aside
          v-if="$slots.details"
          class="max-h-[45dvh] w-full shrink-0 overflow-y-auto bg-[var(--color-surface)] p-4 text-[var(--color-fg)] lg:max-h-none lg:w-80"
          data-testid="image-lightbox-details"
        >
          <slot
            name="details"
            :item="activeItem"
            :index="activeIndex"
            :show-generation-metadata="generationMetadataOpen"
          />
        </aside>
      </section>
    </div>
  </Teleport>
</template>
