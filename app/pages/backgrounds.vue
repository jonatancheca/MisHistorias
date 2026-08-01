<script setup lang="ts">
const backgrounds = useBackgroundsStore()
const confirmDialog = useConfirmStore()

await backgrounds.load()

const tag = ref('')
const description = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

async function processFile(file: File) {
  if (busy.value) return
  busy.value = true
  error.value = null
  try {
    await backgrounds.addBackground(file, tag.value, description.value)
    tag.value = ''
    description.value = ''
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo procesar el fondo.'
  } finally {
    busy.value = false
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    await processFile(file)
  } finally {
    input.value = ''
  }
}

async function onPaste(event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.items ?? [])
    .find((item) => item.type.startsWith('image/'))
    ?.getAsFile()
  if (file) await processFile(file)
}

async function update(
  id: string,
  patch: { tag?: string; description?: string }
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
      El modelo usa la etiqueta para elegir escenario. Debe ser única.
    </p>

    <section class="card mb-6 grid gap-3 sm:grid-cols-[1fr_2fr_14rem] sm:items-end">
      <div>
        <label class="label" for="background-tag">Etiqueta</label>
        <input id="background-tag" v-model="tag" class="field" placeholder="taberna" />
      </div>
      <div>
        <label class="label" for="background-description">Descripción</label>
        <input
          id="background-description"
          v-model="description"
          class="field"
          placeholder="Taberna medieval cálida, de noche"
        />
      </div>
      <div
        tabindex="0"
        class="rounded-xl border border-dashed border-[var(--color-border-soft)] p-3 outline-none transition hover:border-brand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        aria-label="Pegar o seleccionar fondo"
        @paste.prevent="onPaste"
        @keydown.enter.prevent="fileInput?.click()"
        @keydown.space.prevent="fileInput?.click()"
      >
        <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFile" />
        <button type="button" class="btn-primary w-full" :disabled="busy" @click="fileInput?.click()">
          {{ busy ? 'Procesando…' : 'Añadir fondo' }}
        </button>
        <p class="mt-2 text-center text-xs text-[var(--color-fg-muted)]">O enfoca y pulsa Ctrl+V</p>
      </div>
      <p v-if="error" class="text-sm text-red-500 sm:col-span-3" role="alert">{{ error }}</p>
    </section>

    <p v-if="backgrounds.backgrounds.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      Sin fondos todavía.
    </p>

    <ul class="grid gap-4 md:grid-cols-2">
      <li v-for="background in backgrounds.backgrounds" :key="background.id" class="card">
        <img
          :src="backgrounds.urlFor(background.id)!"
          :alt="background.tag"
          class="mb-3 max-h-80 w-full rounded-xl bg-black/5 object-contain"
        />
        <div class="grid gap-2">
          <input
            class="field"
            :value="background.tag"
            aria-label="Etiqueta del fondo"
            @change="update(background.id, { tag: ($event.target as HTMLInputElement).value })"
          />
          <input
            class="field"
            :value="background.description"
            aria-label="Descripción del fondo"
            placeholder="Descripción"
            @change="update(background.id, { description: ($event.target as HTMLInputElement).value })"
          />
          <div class="flex justify-end">
            <button type="button" class="btn-danger" @click="remove(background.id)">Borrar</button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
