<script setup lang="ts">
const props = defineProps<{
  characterId: string
  alt: string
}>()

const characters = useCharactersStore()
const track = ref<HTMLElement | null>(null)
const activeIndex = ref(0)

const images = computed(() => characters.imagesFor(props.characterId))
const galleryItems = computed(() => images.value.flatMap((image) => {
  const src = characters.urlFor(image.id)
  return src ? [{ id: image.id, src, alt: props.alt, tags: [...image.tags] }] : []
}))
const hasMultiple = computed(() => images.value.length > 1)

function onScroll() {
  const element = track.value
  if (!element?.clientWidth) return
  activeIndex.value = Math.max(0, Math.min(
    images.value.length - 1,
    Math.round(element.scrollLeft / element.clientWidth)
  ))
}

function move(offset: number) {
  const element = track.value
  if (!element || !hasMultiple.value) return
  const next = (activeIndex.value + offset + images.value.length) % images.value.length
  activeIndex.value = next
  element.scrollTo({ left: next * element.clientWidth, behavior: 'smooth' })
}

watch(images, () => {
  activeIndex.value = 0
  if (track.value) track.value.scrollLeft = 0
})
</script>

<template>
  <div
    class="relative min-h-0 min-w-0 overflow-hidden rounded-xl bg-black/5"
    data-testid="character-image-carousel"
    :data-active-index="activeIndex"
  >
    <div
      v-if="images.length"
      ref="track"
      class="character-image-track flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain touch-pan-x"
      :aria-label="`Imágenes de ${alt}`"
      @scroll.passive="onScroll"
    >
      <div
        v-for="image in images"
        :key="image.id"
        class="h-full min-w-full snap-center"
        :data-character-image-id="image.id"
      >
        <ImageLightbox
          :src="characters.urlFor(image.id)!"
          :alt="alt"
          container-class="h-full w-full"
          image-class="h-full w-full rounded-xl object-contain"
          :gallery-items="galleryItems"
        />
      </div>
    </div>
    <div v-else class="h-full w-full bg-brand-500/20" role="img" :aria-label="`${alt} sin imágenes`" />

    <template v-if="hasMultiple">
      <button
        type="button"
        class="absolute left-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow hover:bg-black/80 sm:flex"
        :aria-label="`Imagen anterior de ${alt}`"
        @click="move(-1)"
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        class="absolute right-2 top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-2xl text-white shadow hover:bg-black/80 sm:flex"
        :aria-label="`Imagen siguiente de ${alt}`"
        @click="move(1)"
      >
        <span aria-hidden="true">›</span>
      </button>
      <span class="absolute right-2 bottom-2 rounded-full bg-black/65 px-2 py-1 text-[0.68rem] font-semibold text-white">
        {{ activeIndex + 1 }} / {{ images.length }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.character-image-track {
  scrollbar-width: none;
}

.character-image-track::-webkit-scrollbar {
  display: none;
}
</style>
