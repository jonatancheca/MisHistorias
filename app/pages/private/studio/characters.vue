<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const name = ref('')
const tags = ref('neutral, standing')
const selectedId = ref<string | null>(null)
const spriteLabel = ref('Base')
const spriteFacets = ref('neutral, standing, clothed')
const message = ref<string | null>(null)

await studio.loadCharacters()

async function create() {
  message.value = null
  const character = await studio.createCharacter({
    name: name.value,
    tags: tags.value.split(',').map((item) => item.trim()).filter(Boolean)
  })
  name.value = ''
  selectedId.value = character.id
  message.value = 'Personaje creado'
}

const spriteFile = ref<File | null>(null)
const sprites = ref<Array<{ id: string; label: string; mimeType: string }>>([])

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function refreshSprites() {
  if (!selectedId.value) {
    sprites.value = []
    return
  }
  sprites.value = await studio.loadSprites(selectedId.value)
}

watch(selectedId, () => {
  void refreshSprites()
})

async function addSprite() {
  if (!selectedId.value) return
  const payload: {
    label: string
    facets: string[]
    mimeType?: string
    dataBase64?: string
  } = {
    label: spriteLabel.value,
    facets: spriteFacets.value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  if (spriteFile.value) {
    payload.mimeType = spriteFile.value.type || 'image/png'
    payload.dataBase64 = await fileToBase64(spriteFile.value)
  }
  await studio.addSprite(selectedId.value, payload)
  spriteFile.value = null
  await refreshSprites()
  message.value = payload.dataBase64 ? 'Sprite PNG/WebP subido' : 'Sprite placeholder añadido'
}

async function publish(id: string) {
  await studio.publish({ resourceType: 'character', resourceId: id })
  await studio.loadCharacters()
  message.value = 'Publicado en el Hub'
}

async function seed() {
  const result = await $fetch<{
    totals: { characters: number; places: number; experiences: number }
  }>('/api/private/studio/seed', { method: 'POST' })
  await studio.loadCharacters()
  message.value = `Semilla: ${result.totals.characters} pers. / ${result.totals.places} lugares / ${result.totals.experiences} exp.`
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Studio</p>
      <h1 class="font-serif text-3xl">Personajes</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">Sin biografía canónica. Sprites con facetas.</p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>

    <section class="nsfw-card mb-6 grid gap-3 md:grid-cols-4">
      <input v-model="name" class="nsfw-input" placeholder="Nombre">
      <input v-model="tags" class="nsfw-input" placeholder="Tags">
      <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
      <button type="button" class="nsfw-btn-ghost" @click="seed">Sembrar catálogo</button>
    </section>

    <ul class="mb-8 grid gap-3">
      <li
        v-for="character in studio.characters"
        :key="character.id"
        class="nsfw-card flex flex-wrap items-center gap-3"
      >
        <button type="button" class="min-w-0 flex-1 text-left" @click="selectedId = character.id">
          <p class="text-lg">{{ character.name }}</p>
          <p class="text-sm text-[var(--nsfw-muted)]">{{ character.tags.join(', ') || 'sin tags' }}</p>
        </button>
        <span class="text-xs text-[var(--nsfw-faint)]">
          {{ character.published ? 'Publicado' : 'Privado' }}
        </span>
        <button
          v-if="!character.published"
          type="button"
          class="nsfw-btn-ghost"
          @click="publish(character.id)"
        >
          Publicar
        </button>
      </li>
    </ul>

    <section v-if="selectedId" class="nsfw-card grid gap-3 md:grid-cols-3">
      <h2 class="md:col-span-3 text-sm text-[var(--nsfw-muted)]">Sprite para personaje seleccionado</h2>
      <input v-model="spriteLabel" class="nsfw-input" placeholder="Etiqueta">
      <input v-model="spriteFacets" class="nsfw-input" placeholder="Facets">
      <input
        class="nsfw-input"
        type="file"
        accept="image/png,image/webp,image/jpeg,image/svg+xml"
        @change="spriteFile = ($event.target as HTMLInputElement).files?.[0] || null"
      >
      <button type="button" class="nsfw-btn-primary md:col-span-3" @click="addSprite">
        Añadir sprite
      </button>
      <ul v-if="sprites.length" class="md:col-span-3 flex flex-wrap gap-3">
        <li v-for="sprite in sprites" :key="sprite.id" class="text-center text-xs">
          <img
            :src="`/api/private/studio/sprites/${sprite.id}`"
            :alt="sprite.label"
            class="mx-auto h-24 w-auto object-contain"
          >
          <p>{{ sprite.label }} · {{ sprite.mimeType }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
