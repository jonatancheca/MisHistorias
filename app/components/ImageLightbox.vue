<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    imageClass?: string
    containerClass?: string
    imageStyle?: Record<string, string>
    downloadName?: string
  }>(),
  {
    imageClass: '',
    containerClass: '',
    imageStyle: undefined,
    downloadName: undefined
  }
)

const open = ref(false)

function close() {
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <button
    type="button"
    :class="['block max-w-full cursor-zoom-in rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500', containerClass]"
    :aria-label="`Ampliar ${alt || 'imagen'}`"
    @click="open = true"
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
          v-if="downloadName"
          :href="props.src"
          :download="downloadName"
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
      <img
        :src="props.src"
        :alt="props.alt"
        class="max-h-[90vh] max-w-[95vw] rounded-xl object-contain"
      >
    </div>
  </Teleport>
</template>
