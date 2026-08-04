<script setup lang="ts">
interface GalleryItem {
  src: string
  alt: string
  downloadName?: string
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
  }>(),
  {
    imageClass: '',
    containerClass: '',
    imageStyle: undefined,
    downloadName: undefined,
    galleryItems: undefined
  }
)

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

function close() {
  open.value = false
}

function move(offset: number) {
  if (!canNavigate.value) return
  activeIndex.value = (activeIndex.value + offset + items.value.length) % items.value.length
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value) return
  if (event.key === 'Escape') close()
  else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    move(1)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <button
    type="button"
    :class="['block max-w-full cursor-zoom-in rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500', containerClass]"
    :aria-label="`Ampliar ${alt || 'imagen'}`"
    @click="show"
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
      <div class="absolute top-4 right-4 flex items-center gap-2">
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
        class="absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
        aria-label="Imagen anterior"
        title="Imagen anterior"
        @click="move(-1)"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <img
        :src="activeItem.src"
        :alt="activeItem.alt"
        class="max-h-[90vh] max-w-[95vw] rounded-xl object-contain"
      >
      <button
        v-if="canNavigate"
        type="button"
        class="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-3xl text-white hover:bg-black/80"
        aria-label="Imagen siguiente"
        title="Imagen siguiente"
        @click="move(1)"
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  </Teleport>
</template>
