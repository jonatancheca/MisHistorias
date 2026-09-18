<script setup lang="ts">
import type { StoredBackground } from '~/lib/db'
import { primaryTag } from '~/lib/tags'

const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const confirmDialog = useConfirmStore()
const privacy = usePrivacyStore()

await Promise.all([backgrounds.load(), sounds.load()])

const tags = ref<string[]>([])
const description = ref('')
const pendingFile = ref<File | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const refreshing = ref(false)
const refreshError = ref<string | null>(null)
const copyingId = ref<string | null>(null)
const visibleBackgrounds = computed(() =>
  privacy.isDemo
    ? backgrounds.backgrounds.filter((background) => background.visibleInDemo)
    : backgrounds.backgrounds
)

async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    await Promise.all([backgrounds.load(true), sounds.load(true)])
  } catch (caught) {
    refreshError.value = (caught as Error).message || 'No se pudieron recargar los fondos.'
  } finally {
    refreshing.value = false
  }
}

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

async function copyBackground(id: string) {
  if (copyingId.value) return
  copyingId.value = id
  error.value = null
  try {
    await backgrounds.copyBackground(id)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo copiar el fondo.'
  } finally {
    copyingId.value = null
  }
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="page-kicker">Escenografía</p>
        <h1 class="page-title">Fondos</h1>
        <p class="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
          Modelo puede elegir fondo usando cualquiera de sus etiquetas. Cada etiqueta debe ser única.
        </p>
      </div>
      <button type="button" class="btn-ghost" :disabled="refreshing" @click="reload">
        <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 11a8 8 0 0 0-14.7-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.7 4L21 15m0 0v5m0-5h-5" />
        </svg>
        {{ refreshing ? 'Recargando…' : 'Recargar' }}
      </button>
    </header>

    <p v-if="refreshError" class="card mb-4 text-sm text-red-500" role="alert">
      {{ refreshError }}
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

    <p v-if="visibleBackgrounds.length === 0" class="empty-state card py-10 text-sm text-[var(--color-fg-muted)]">
      Sin fondos todavía.
    </p>

    <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <li v-for="background in visibleBackgrounds" :key="background.id" class="card min-w-0">
        <ImageLightbox
          :src="backgrounds.urlFor(background.id)!"
          :alt="`Fondo ${primaryTag(background) ?? ''}`"
          container-class="mb-3 w-full"
          image-class="max-h-80 w-full rounded-xl bg-black/5 object-contain"
        />
        <div class="grid gap-2">
          <template v-if="background.readOnly">
            <p class="text-xs font-semibold text-brand-600">Fondo demo compartido · solo lectura</p>
            <div class="flex flex-wrap gap-1">
              <span
                v-for="tag in background.tags"
                :key="tag"
                class="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs"
              >{{ tag }}</span>
            </div>
            <p class="text-sm text-[var(--color-fg-muted)]">{{ background.description }}</p>
            <div class="flex justify-end">
              <button
                type="button"
                class="btn-primary"
                :disabled="copyingId !== null"
                @click="copyBackground(background.id)"
              >
                {{ copyingId === background.id ? 'Copiando…' : 'Copiar a mi colección privada' }}
              </button>
            </div>
          </template>
          <template v-else>
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
              @input="background.description = ($event.target as HTMLInputElement).value"
              @change="update(background.id, { description: ($event.target as HTMLInputElement).value })"
            >
            <SoundEditor :background-id="background.id" title="Sonidos del fondo" />
            <label v-if="privacy.isPrivateMode" class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                class="h-4 w-4 accent-[var(--color-brand-500)]"
                :checked="background.visibleInDemo"
                @change="update(background.id, { visibleInDemo: ($event.target as HTMLInputElement).checked })"
              >
              Visible en modo demo
            </label>
            <div class="flex justify-end">
              <button type="button" class="btn-danger" @click="remove(background.id)">Borrar</button>
            </div>
          </template>
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
