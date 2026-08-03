<script setup lang="ts">
import type { StoredBackground } from '~/lib/db'
import { primaryTag } from '~/lib/tags'

const backgrounds = useBackgroundsStore()
const confirmDialog = useConfirmStore()

await backgrounds.load()

const tags = ref<string[]>([])
const description = ref('')
const pendingFile = ref<File | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

function selectFile(files: File[]) {
  const file = files[0]
  if (!file) return
  error.value = null
  pendingFile.value = file
}

async function processFile(file: Blob) {
  if (busy.value) return
  pendingFile.value = null
  busy.value = true
  error.value = null
  try {
    await backgrounds.addBackground(file, tags.value, description.value)
    tags.value = []
    description.value = ''
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo procesar el fondo.'
  } finally {
    busy.value = false
  }
}

async function update(
  id: string,
  patch: Partial<Pick<StoredBackground, 'tags' | 'description'>>
) {
  error.value = null
  try {
    await backgrounds.updateBackground(id, patch)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar el fondo.'
    await backgrounds.load(true)
  }
}

async function remove(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar fondo',
    message: 'Se borrará la imagen. Las historias que la usaban mostrarán “fondo no disponible”.'
  })
  if (accepted) await backgrounds.removeBackground(id)
}
</script>

<template>
  <div class="mx-auto max-w-5xl p-4 sm:p-8">
    <h1 class="mb-2 text-2xl font-bold">Fondos</h1>
    <p class="mb-6 text-sm text-[var(--color-fg-muted)]">
      Modelo puede elegir fondo usando cualquiera de sus etiquetas. Cada etiqueta debe ser única.
    </p>

    <section class="card mb-6 grid gap-3 sm:grid-cols-[1fr_2fr_14rem] sm:items-end">
      <div>
        <label class="label" for="background-tags">Etiquetas</label>
        <TagInput id="background-tags" v-model="tags" placeholder="taberna" />
      </div>
      <div>
        <label class="label" for="background-description">Descripción</label>
        <input
          id="background-description"
          v-model="description"
          autocomplete="off"
          class="field"
          placeholder="Taberna medieval cálida, de noche"
        >
      </div>
      <ImageUploadDropZone
        :busy="busy"
        label="Añadir fondo"
        busy-label="Procesando…"
        zone-label="Arrastrar, pegar o seleccionar fondo"
        @select="selectFile"
        @error="error = $event"
      />
      <p v-if="error" class="text-sm text-red-500 sm:col-span-3" role="alert">{{ error }}</p>
    </section>

    <p v-if="backgrounds.backgrounds.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      Sin fondos todavía.
    </p>

    <ul class="grid gap-4 md:grid-cols-2">
      <li v-for="background in backgrounds.backgrounds" :key="background.id" class="card min-w-0">
        <ImageLightbox
          :src="backgrounds.urlFor(background.id)!"
          :alt="`Fondo ${primaryTag(background) ?? ''}`"
          container-class="mb-3 w-full"
          image-class="max-h-80 w-full rounded-xl bg-black/5 object-contain"
        />
        <div class="grid gap-2">
          <TagInput
            :model-value="background.tags"
            aria-label="Etiquetas del fondo"
            placeholder="neutral"
            @update:model-value="update(background.id, { tags: $event })"
          />
          <input
            class="field"
            :value="background.description"
            autocomplete="off"
            aria-label="Descripción del fondo"
            placeholder="Descripción"
            @change="update(background.id, { description: ($event.target as HTMLInputElement).value })"
          >
          <div class="flex justify-end">
            <button type="button" class="btn-danger" @click="remove(background.id)">Borrar</button>
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
  </div>
</template>
