<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const name = ref('')
const setting = ref('Interior')
const era = ref('Contemporánea')
const message = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const creating = ref(false)

await studio.loadPlaces()
selectedId.value = studio.places[0]?.id || null

const selected = computed(() => studio.places.find((item) => item.id === selectedId.value) || null)

async function create() {
  const place = await studio.createPlace({
    name: name.value,
    setting: setting.value,
    era: era.value
  })
  name.value = ''
  selectedId.value = place.id
  creating.value = false
  message.value = 'Lugar creado'
}

async function publish(id: string) {
  await studio.publish({ resourceType: 'place', resourceId: id })
  await studio.loadPlaces()
  message.value = 'Publicado en el Hub'
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
  <div class="nsfw-page nsfw-studio">
    <div class="nsfw-studio-rail">
      <p class="nsfw-eyebrow px-6">Studio</p>
      <h1 class="mb-5 px-6 font-serif text-3xl">Lugares</h1>

      <button
        v-for="place in studio.places"
        :key="place.id"
        type="button"
        class="nsfw-studio-item"
        :class="selectedId === place.id && !creating ? 'is-active' : ''"
        @click="selectedId = place.id; creating = false"
      >
        <span class="min-w-0">
          <strong class="truncate">{{ place.name }}</strong>
          <small>{{ place.published ? 'publicado' : 'privado' }} · {{ place.setting }}</small>
        </span>
      </button>

      <button
        type="button"
        class="nsfw-studio-item text-[var(--nsfw-dim)]"
        :class="creating ? 'is-active' : ''"
        @click="creating = true"
      >
        <span class="text-base leading-none">+</span> Nuevo lugar
      </button>

      <div class="flex-1" />

      <div class="mx-4 flex flex-col gap-2.5 border-t border-[var(--nsfw-hair)] px-2 pt-4">
        <NuxtLink to="/private/studio/characters" class="nsfw-btn-text">Personajes</NuxtLink>
        <NuxtLink to="/private/studio/experiences" class="nsfw-btn-text">Experiences</NuxtLink>
      </div>
    </div>

    <div class="nsfw-studio-detail">
      <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>

      <section v-if="creating || !selected" class="max-w-lg">
        <h2 class="mb-2 font-serif text-3xl">Nuevo lugar</h2>
        <p class="mb-7 font-serif text-base italic text-[var(--nsfw-muted)]">
          Una escena, un fondo versionado. Sin zonas.
        </p>
        <div class="grid gap-6">
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Nombre</span>
            <input v-model="name" class="nsfw-underline" placeholder="Planta catorce">
          </label>
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Setting</span>
            <input v-model="setting" class="nsfw-underline" placeholder="Oficina abierta, interior">
          </label>
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Época</span>
            <input v-model="era" class="nsfw-underline">
          </label>
          <div>
            <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
          </div>
        </div>
      </section>

      <section v-else class="max-w-2xl">
        <div class="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 class="mb-1 font-serif text-3xl">{{ selected.name }}</h2>
            <p class="text-xs text-[var(--nsfw-dim)]">
              {{ selected.setting }} · {{ selected.era }}
            </p>
          </div>
          <div class="flex items-center gap-5">
            <span class="text-xs text-[var(--nsfw-faint)]">
              {{ selected.published ? 'Publicado en el Hub' : 'Privado' }}
            </span>
            <button
              v-if="!selected.published"
              type="button"
              class="nsfw-btn-text !text-[var(--nsfw-accent)]"
              @click="publish(selected.id)"
            >
              Publicar al Hub
            </button>
          </div>
        </div>

        <div class="nsfw-section-head">
          <h3>Fondo del lugar</h3>
        </div>
        <label class="block max-w-md">
          <span class="sr-only">Subir fondo</span>
          <input
            class="nsfw-input w-full"
            type="file"
            accept="image/png,image/webp,image/jpeg"
            @change="onBackground"
          >
        </label>
        <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-dim)]">
          PNG, WebP o JPEG. Reemplaza el fondo activo con una versión nueva; las anteriores se
          conservan.
        </p>
      </section>
    </div>
  </div>
</template>
