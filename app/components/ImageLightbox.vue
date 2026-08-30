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
    imageStyle?: Record<string, string>
    downloadName?: string
    galleryItems?: GalleryItem[]
    selectable?: boolean
  }>(),
  {
    imageClass: '',
    containerClass: '',
    imageStyle: undefined,
    downloadName: undefined,
    galleryItems: undefined,
    selectable: false
  }
)

const emit = defineEmits<{ select: [] }>()

const open = ref(false)
const activeIndex = ref(0)
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
  open.value = true
}

function activate() {
  if (props.selectable) emit('select')
  else show()
}

function close() {
  open.value = false
}

function move(offset: number) {
  if (!canNavigate.value) return
  activeIndex.value = (activeIndex.value + offset + items.value.length) % items.value.length
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    move(1)
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
  <button
    type="button"
    :class="['block max-w-full cursor-zoom-in rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500', containerClass]"
    :aria-label="`${selectable ? 'Cambiar' : 'Ampliar'} ${alt || 'imagen'}`"
    @click="activate"
  >
    <img :src="props.src" :alt="props.alt" :class="props.imageClass" :style="props.imageStyle">
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="alt || 'Imagen ampliada'"
      @click.self="close"
    >
      <section
        class="flex max-h-[calc(100dvh-2rem)] w-full max-w-7xl flex-col overflow-hidden rounded-xl lg:flex-row"
      >
        <div class="relative flex min-h-0 min-w-0 flex-1 items-center justify-center bg-black/40 p-3 sm:p-6">
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
            class="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
            aria-label="Imagen anterior"
            title="Imagen anterior"
            @click="move(-1)"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <img
            :src="activeItem.src"
            :alt="activeItem.alt"
            class="max-h-[calc(100dvh-4rem)] max-w-full rounded-xl object-contain"
          >
          <span
            v-if="activeItem.generation"
            class="absolute bottom-3 left-3 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-bold text-white shadow"
            aria-label="Imagen generada con IA"
          >IA</span>
          <button
            v-if="canNavigate"
            type="button"
            class="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
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
          <slot name="details" :item="activeItem" :index="activeIndex" />
        </aside>
      </section>
    </div>
  </Teleport>
</template>
