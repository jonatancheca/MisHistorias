<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const name = ref('')
const tags = ref('neutral, standing')
const selectedId = ref<string | null>(null)
const creating = ref(false)
const spriteLabel = ref('Base')
const spriteFacets = ref('neutral, standing, clothed')
const message = ref<string | null>(null)
const spriteFile = ref<File | null>(null)
const sprites = ref<Array<{ id: string; label: string; mimeType: string }>>([])

await studio.loadCharacters()
selectedId.value = studio.characters[0]?.id || null

const selected = computed(() => studio.characters.find((item) => item.id === selectedId.value) || null)

async function create() {
  message.value = null
  const character = await studio.createCharacter({
    name: name.value,
    tags: tags.value.split(',').map((item) => item.trim()).filter(Boolean)
  })
  name.value = ''
  selectedId.value = character.id
  creating.value = false
  message.value = 'Personaje creado'
}

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
}, { immediate: true })

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
  selectedId.value = selectedId.value || studio.characters[0]?.id || null
  message.value = `Semilla: ${result.totals.characters} pers. / ${result.totals.places} lugares / ${result.totals.experiences} exp.`
}
</script>

<template>
  <div class="nsfw-page nsfw-studio">
    <div class="nsfw-studio-rail">
      <p class="nsfw-eyebrow px-6">Studio</p>
      <h1 class="mb-5 px-6 font-serif text-3xl">Personajes</h1>

      <button
        v-for="character in studio.characters"
        :key="character.id"
        type="button"
        class="nsfw-studio-item"
        :class="selectedId === character.id && !creating ? 'is-active' : ''"
        @click="selectedId = character.id; creating = false"
      >
        <span
          class="h-11 w-9 shrink-0 rounded-t-full rounded-b bg-gradient-to-b from-[rgba(58,45,48,0.3)] to-[rgba(58,45,48,0.85)]"
          :class="character.published ? 'border border-[color-mix(in_srgb,var(--nsfw-gold)_25%,transparent)]' : 'border border-[var(--nsfw-hair)]'"
        />
        <span class="min-w-0">
          <strong class="truncate">{{ character.name }}</strong>
          <small>{{ character.published ? 'publicado' : 'privado' }}</small>
        </span>
      </button>

      <button
        type="button"
        class="nsfw-studio-item text-[var(--nsfw-dim)]"
        :class="creating ? 'is-active' : ''"
        @click="creating = true"
      >
        <span class="text-base leading-none">+</span> Crear personaje
      </button>

      <div class="flex-1" />

      <div class="mx-4 flex flex-col gap-2.5 border-t border-[var(--nsfw-hair)] px-2 pt-4">
        <NuxtLink to="/private/studio/places" class="nsfw-btn-text">Lugares</NuxtLink>
        <NuxtLink to="/private/studio/experiences" class="nsfw-btn-text">Experiences</NuxtLink>
        <button type="button" class="nsfw-btn-text" @click="seed">Sembrar catálogo</button>
      </div>
    </div>

    <div class="nsfw-studio-detail">
      <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>

      <section v-if="creating || !selected" class="max-w-lg">
        <h2 class="mb-2 font-serif text-3xl">Crear personaje</h2>
        <p class="mb-7 font-serif text-base italic text-[var(--nsfw-muted)]">
          Sin biografía canónica. Cada historia inventa su pasado.
        </p>
        <div class="grid gap-6">
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Nombre</span>
            <input v-model="name" class="nsfw-underline" placeholder="Irene Sanz">
          </label>
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Etiquetas de personalidad</span>
            <input v-model="tags" class="nsfw-underline" placeholder="dominante, verbal, irónica">
          </label>
          <div>
            <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
          </div>
        </div>
      </section>

      <section v-else>
        <div class="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 class="mb-1 font-serif text-3xl">{{ selected.name }}</h2>
            <p class="text-xs text-[var(--nsfw-dim)]">
              Sin biografía canónica. Cada historia inventa su pasado.
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

        <div class="mb-9">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim">Etiquetas de personalidad</p>
          <div class="custom-pills">
            <span v-for="tag in selected.tags" :key="tag" class="pill !min-h-8 !py-1 !text-xs">
              {{ tag }}
            </span>
            <span v-if="!selected.tags.length" class="text-xs text-[var(--nsfw-dim)]">Sin tags.</span>
          </div>
        </div>

        <div class="nsfw-section-head">
          <h3>Sprites y facetas</h3>
          <span class="text-xs text-[var(--nsfw-dim)]">{{ sprites.length }} en el catálogo</span>
        </div>

        <div class="mb-8 flex flex-wrap gap-4">
          <figure v-for="sprite in sprites" :key="sprite.id" class="w-20 text-center">
            <img
              :src="`/api/private/studio/sprites/${sprite.id}`"
              :alt="sprite.label"
              class="mx-auto h-24 w-full rounded-t-2xl border border-[var(--nsfw-hair)] object-contain"
            >
            <figcaption class="mt-1.5 truncate text-[0.66rem] text-[var(--nsfw-faint)]">
              {{ sprite.label }}
            </figcaption>
          </figure>
          <p v-if="!sprites.length" class="text-sm text-[var(--nsfw-muted)]">
            Sin sprites: la VN usará el fallback neutral.
          </p>
        </div>

        <div class="grid max-w-2xl gap-5 sm:grid-cols-2">
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Etiqueta</span>
            <input v-model="spriteLabel" class="nsfw-underline">
          </label>
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Facetas</span>
            <input v-model="spriteFacets" class="nsfw-underline">
          </label>
          <label class="block sm:col-span-2">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Archivo</span>
            <input
              class="nsfw-input w-full"
              type="file"
              accept="image/png,image/webp,image/jpeg,image/svg+xml"
              @change="spriteFile = ($event.target as HTMLInputElement).files?.[0] || null"
            >
          </label>
          <div class="sm:col-span-2">
            <button type="button" class="nsfw-btn-primary" @click="addSprite">Añadir sprite</button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
