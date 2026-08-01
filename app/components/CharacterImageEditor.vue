<script setup lang="ts">
import type { StoredImage } from '~/lib/db'

const props = defineProps<{ characterId: string }>()

const characters = useCharactersStore()
const confirmDialog = useConfirmStore()
const pendingTags = ref<string[]>([])
const pendingDescription = ref('')
const pendingFile = ref<File | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const images = computed(() => characters.imagesFor(props.characterId))

function selectFile(file: File) {
  error.value = null
  pendingFile.value = file
}

async function processFile(file: Blob) {
  if (busy.value) return
  pendingFile.value = null
  busy.value = true
  error.value = null
  try {
    await characters.addImage(
      props.characterId,
      file,
      pendingTags.value,
      pendingDescription.value
    )
    pendingTags.value = []
    pendingDescription.value = ''
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo procesar la imagen.'
  } finally {
    busy.value = false
  }
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
          class="field"
          placeholder="Sonríe, relajada, mirando de frente"
        >
      </div>
      <ImageUploadDropZone
        :busy="busy"
        label="Añadir imagen"
        busy-label="Procesando…"
        zone-label="Arrastrar, pegar o seleccionar imagen"
        @select="selectFile"
        @error="error = $event"
      />
      <p v-if="error" class="text-sm text-red-500 sm:col-span-3" role="alert">{{ error }}</p>
    </div>

    <p v-if="images.length === 0" class="text-sm text-[var(--color-fg-muted)]">
      Sin imágenes todavía.
    </p>

    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="image in images" :key="image.id" class="card flex min-w-0 flex-col gap-3 sm:flex-row">
        <img
          :src="characters.urlFor(image.id)!"
          alt=""
          class="max-h-56 w-full shrink-0 rounded-lg object-contain sm:h-24 sm:w-24"
        >
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
            placeholder="descripción"
            @change="updateImage(image.id, { description: ($event.target as HTMLInputElement).value })"
          >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
              <input
                type="radio"
                :name="`default-${characterId}`"
                :checked="image.isDefault"
                class="accent-brand-500"
                @change="updateImage(image.id, { isDefault: true })"
              >
              Por defecto
            </label>
            <button type="button" class="btn-danger" @click="remove(image.id)">Borrar</button>
          </div>
        </div>
      </li>
    </ul>

    <ImageCropDialog
      v-if="pendingFile"
      :file="pendingFile"
      @cancel="pendingFile = null"
      @confirm="processFile"
    />
  </section>
</template>
