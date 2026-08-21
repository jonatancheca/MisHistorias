<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const name = ref('')
const setting = ref('Interior')
const era = ref('Contemporánea')
const message = ref<string | null>(null)
const selectedId = ref<string | null>(null)

await studio.loadPlaces()

async function create() {
  await studio.createPlace({ name: name.value, setting: setting.value, era: era.value })
  name.value = ''
  message.value = 'Lugar creado'
}

async function publish(id: string) {
  await studio.publish({ resourceType: 'place', resourceId: id })
  await studio.loadPlaces()
  message.value = 'Publicado'
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function onBackground(event: Event) {
  if (!selectedId.value) return
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  await studio.uploadPlaceBackground(selectedId.value, {
    mimeType: file.type || 'image/png',
    dataBase64: await fileToBase64(file)
  })
  message.value = 'Fondo subido (nueva versión activa)'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Studio</p>
      <h1 class="font-serif text-3xl">Lugares</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">Una escena, un fondo versionado. Sin Zone.</p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>

    <section class="nsfw-card mb-6 grid gap-3 md:grid-cols-4">
      <input v-model="name" class="nsfw-input" placeholder="Nombre">
      <input v-model="setting" class="nsfw-input" placeholder="Setting">
      <input v-model="era" class="nsfw-input" placeholder="Era">
      <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
    </section>

    <ul class="mb-6 grid gap-3">
      <li v-for="place in studio.places" :key="place.id" class="nsfw-card flex flex-wrap items-center gap-3">
        <button type="button" class="min-w-0 flex-1 text-left" @click="selectedId = place.id">
          <p class="text-lg">{{ place.name }}</p>
          <p class="text-sm text-[var(--nsfw-muted)]">{{ place.setting }} · {{ place.era }}</p>
        </button>
        <button
          v-if="!place.published"
          type="button"
          class="nsfw-btn-ghost"
          @click="publish(place.id)"
        >
          Publicar
        </button>
      </li>
    </ul>

    <section v-if="selectedId" class="nsfw-card space-y-3">
      <h2 class="text-sm text-[var(--nsfw-muted)]">Fondo del lugar seleccionado</h2>
      <input
        class="nsfw-input w-full"
        type="file"
        accept="image/png,image/webp,image/jpeg"
        @change="onBackground"
      >
      <p class="text-xs text-[var(--nsfw-faint)]">
        PNG/WebP/JPEG. Reemplaza el fondo activo con versión nueva.
      </p>
    </section>
  </div>
</template>
