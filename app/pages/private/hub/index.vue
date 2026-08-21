<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const auth = useNsfwAuthStore()
const tab = ref<'all' | 'character' | 'place' | 'experience'>('all')
const q = ref('')
const message = ref<string | null>(null)
const collectionTitle = ref('Favoritos')
const collections = ref<Array<{ id: string; title: string }>>([])
const selectedCollection = ref('')

async function refresh() {
  await studio.loadHub({
    type: tab.value === 'all' ? undefined : tab.value,
    q: q.value || undefined
  })
  const result = await $fetch<{ collections: Array<{ id: string; title: string }> }>(
    '/api/private/hub/collections'
  )
  collections.value = result.collections
  if (!selectedCollection.value && collections.value[0]) {
    selectedCollection.value = collections.value[0].id
  }
}

await refresh()

async function add(publicationId: string) {
  await studio.addFromHub(publicationId)
  message.value = 'Añadido a tu biblioteca'
}

async function follow(ownerUserId: string) {
  if (ownerUserId === auth.user?.id) return
  await $fetch('/api/private/hub/follow', {
    method: 'POST',
    body: { userId: ownerUserId }
  })
  message.value = 'Siguiendo'
}

async function rate(publicationId: string, score: number) {
  await $fetch('/api/private/hub/engage', {
    method: 'POST',
    body: { action: 'rate', publicationId, score }
  })
  message.value = `Valoración ${score}/5`
}

async function comment(publicationId: string) {
  const body = window.prompt('Comentario (sin reseña libre larga)') || ''
  if (!body.trim()) return
  await $fetch('/api/private/hub/engage', {
    method: 'POST',
    body: { action: 'comment', publicationId, body }
  })
  message.value = 'Comentario publicado'
}

async function share(publicationId: string) {
  const result = await $fetch<{ path: string }>('/api/private/hub/engage', {
    method: 'POST',
    body: { action: 'share', publicationId }
  })
  await navigator.clipboard.writeText(`${window.location.origin}${result.path}`)
  message.value = 'Ruta interna copiada'
}

async function createCollection() {
  const result = await $fetch<{ collection: { id: string; title: string } }>(
    '/api/private/hub/collections',
    { method: 'POST', body: { title: collectionTitle.value } }
  )
  collections.value = [result.collection, ...collections.value]
  selectedCollection.value = result.collection.id
  message.value = 'Colección creada'
}

async function addToCollection(publicationId: string) {
  if (!selectedCollection.value) {
    await createCollection()
  }
  await $fetch('/api/private/hub/collections', {
    method: 'POST',
    body: {
      action: 'add',
      collectionId: selectedCollection.value,
      publicationId
    }
  })
  message.value = 'Añadido a colección'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-5xl overflow-x-hidden px-3 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Community Hub</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        Solo visible tras autenticarte. Portadas y fichas no filtran al SFW.
      </p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="option in [
          { id: 'all', label: 'Todo' },
          { id: 'character', label: 'Personajes' },
          { id: 'place', label: 'Lugares' },
          { id: 'experience', label: 'Experiences' }
        ]"
        :key="option.id"
        type="button"
        class="nsfw-btn-ghost"
        :class="tab === option.id ? 'text-[var(--nsfw-accent)]' : ''"
        @click="tab = option.id as typeof tab; refresh()"
      >
        {{ option.label }}
      </button>
      <input
        v-model="q"
        class="nsfw-input min-w-[10rem] flex-1"
        placeholder="Buscar"
        @keydown.enter="refresh"
      >
      <button type="button" class="nsfw-btn-ghost" @click="refresh">Buscar</button>
    </div>

    <div class="nsfw-card mb-4 flex flex-wrap items-center gap-2">
      <input v-model="collectionTitle" class="nsfw-input min-w-[8rem] flex-1" placeholder="Colección">
      <button type="button" class="nsfw-btn-ghost" @click="createCollection">Crear colección</button>
      <select v-if="collections.length" v-model="selectedCollection" class="nsfw-input">
        <option v-for="collection in collections" :key="collection.id" :value="collection.id">
          {{ collection.title }}
        </option>
      </select>
    </div>

    <p v-if="studio.hub.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      Aún no hay publicaciones. Crea en Studio y publica.
    </p>

    <ul class="grid gap-3 md:grid-cols-2">
      <li v-for="listing in studio.hub" :key="listing.id" class="nsfw-card space-y-2">
        <p class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">
          {{ listing.resourceType }} ·
          <NuxtLink
            :to="`/private/hub/creator/${listing.ownerUserId}`"
            class="underline decoration-dotted hover:text-[var(--nsfw-accent)]"
          >
            {{ listing.ownerUsername }}
          </NuxtLink>
        </p>
        <h2 class="text-xl">{{ listing.title }}</h2>
        <p class="text-sm text-[var(--nsfw-muted)]">{{ listing.summary }}</p>
        <p v-if="listing.tags.length" class="text-xs text-[var(--nsfw-faint)]">
          {{ listing.tags.join(' · ') }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="nsfw-btn-primary" @click="add(listing.id)">Add</button>
          <button type="button" class="nsfw-btn-ghost" @click="follow(listing.ownerUserId)">
            Seguir
          </button>
          <button type="button" class="nsfw-btn-ghost" @click="addToCollection(listing.id)">
            Colección
          </button>
          <button type="button" class="nsfw-btn-ghost" @click="share(listing.id)">Compartir</button>
          <button type="button" class="nsfw-btn-ghost" @click="comment(listing.id)">Comentar</button>
          <button
            v-for="score in 5"
            :key="score"
            type="button"
            class="nsfw-btn-ghost px-2"
            @click="rate(listing.id, score)"
          >
            {{ score }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
