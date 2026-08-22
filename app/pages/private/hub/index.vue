<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const auth = useNsfwAuthStore()
const tab = ref<'all' | 'character' | 'place' | 'experience' | 'collections'>('all')
const q = ref('')
const message = ref<string | null>(null)
const collectionTitle = ref('Favoritos')
const collections = ref<Array<{ id: string; title: string }>>([])
const selectedCollection = ref('')

const TABS = [
  { id: 'all', label: 'Todo' },
  { id: 'experience', label: 'Experiences' },
  { id: 'character', label: 'Personajes' },
  { id: 'place', label: 'Lugares' },
  { id: 'collections', label: 'Colecciones' }
] as const

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  experience: { label: 'Experience', color: 'var(--nsfw-gold)' },
  character: { label: 'Personaje', color: 'var(--nsfw-azure)' },
  place: { label: 'Lugar', color: 'var(--nsfw-muted)' }
}

async function refresh() {
  if (tab.value !== 'collections') {
    await studio.loadHub({
      type: tab.value === 'all' ? undefined : tab.value,
      q: q.value || undefined
    })
  }
  const result = await $fetch<{ collections: Array<{ id: string; title: string }> }>(
    '/api/private/hub/collections'
  )
  collections.value = result.collections
  if (!selectedCollection.value && collections.value[0]) {
    selectedCollection.value = collections.value[0].id
  }
}

await refresh()

function typeMeta(resourceType: string) {
  return TYPE_LABEL[resourceType] || { label: resourceType, color: 'var(--nsfw-muted)' }
}

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

async function selectTab(next: typeof tab.value) {
  tab.value = next
  await refresh()
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[58rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-2 flex flex-wrap items-baseline justify-between gap-4">
      <h1 class="font-serif text-4xl">Hub</h1>
      <label class="min-w-[16rem] flex-1 sm:max-w-xs">
        <span class="sr-only">Buscar</span>
        <input
          v-model="q"
          class="nsfw-underline !font-sans !text-sm"
          placeholder="Buscar historias, personajes, lugares…"
          @keydown.enter="refresh"
        >
      </label>
    </header>
    <p class="mb-8 text-xs text-[var(--nsfw-faint)]">
      Solo dentro de la sesión privada. Nada de esto llega al modo público.
    </p>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>

    <div class="nsfw-tabs mb-7">
      <button
        v-for="option in TABS"
        :key="option.id"
        type="button"
        class="nsfw-tab"
        :class="tab === option.id ? 'is-active' : ''"
        @click="selectTab(option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <section v-if="tab === 'collections'" class="space-y-6">
      <div class="flex flex-wrap items-end gap-4">
        <label class="min-w-[12rem] flex-1">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Nueva colección</span>
          <input v-model="collectionTitle" class="nsfw-underline" placeholder="Favoritos">
        </label>
        <button type="button" class="nsfw-btn-ghost" @click="createCollection">Crear</button>
      </div>
      <p v-if="!collections.length" class="text-sm text-[var(--nsfw-muted)]">
        Todavía no tienes colecciones.
      </p>
      <div v-for="collection in collections" :key="collection.id" class="nsfw-row cursor-default">
        <span class="nsfw-row-title flex-1">{{ collection.title }}</span>
        <button
          type="button"
          class="nsfw-btn-text"
          :class="selectedCollection === collection.id ? 'text-[var(--nsfw-accent)]' : ''"
          @click="selectedCollection = collection.id"
        >
          {{ selectedCollection === collection.id ? 'Activa' : 'Usar' }}
        </button>
      </div>
      <p class="text-xs text-[var(--nsfw-faint)]">
        La colección activa recibe lo que guardes desde las fichas.
      </p>
    </section>

    <template v-else>
      <p v-if="studio.hub.length === 0" class="py-8 text-sm text-[var(--nsfw-muted)]">
        Aún no hay publicaciones. Crea en Studio y publica.
      </p>

      <div v-else class="nsfw-hairgrid md:grid-cols-2">
        <article v-for="listing in studio.hub" :key="listing.id" class="px-6 py-6">
          <div class="mb-3.5 flex items-center justify-between gap-3">
            <span
              class="text-[0.62rem] uppercase tracking-[0.18em]"
              :style="{ color: typeMeta(listing.resourceType).color }"
            >
              {{ typeMeta(listing.resourceType).label }}
            </span>
            <NuxtLink
              :to="`/private/hub/creator/${listing.ownerUserId}`"
              class="text-xs text-[var(--nsfw-dim)] hover:text-[var(--nsfw-ink)]"
            >
              {{ listing.ownerUsername }}
            </NuxtLink>
          </div>

          <h2 class="mb-2 font-serif text-2xl leading-tight">{{ listing.title }}</h2>
          <p
            v-if="listing.summary"
            class="mb-4 font-serif text-[1rem] italic leading-relaxed text-[var(--nsfw-muted)]"
          >
            {{ listing.summary }}
          </p>
          <p v-if="listing.tags.length" class="mb-4 text-xs text-[var(--nsfw-dim)]">
            {{ listing.tags.join(' · ') }}
          </p>

          <div
            class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--nsfw-hair)] pt-3.5"
          >
            <div class="flex items-center gap-2" role="group" aria-label="Valorar">
              <button
                v-for="score in 5"
                :key="score"
                type="button"
                class="h-[7px] w-[7px] cursor-pointer rounded-full border-0 bg-[rgba(238,224,212,0.14)] p-0 transition hover:bg-[var(--nsfw-gold)]"
                :title="`Valorar ${score}/5`"
                :aria-label="`Valorar ${score} de 5`"
                @click="rate(listing.id, score)"
              />
            </div>
            <div class="flex flex-wrap items-center gap-4">
              <button type="button" class="nsfw-btn-text" @click="follow(listing.ownerUserId)">
                Seguir
              </button>
              <button type="button" class="nsfw-btn-text" @click="comment(listing.id)">
                Comentar
              </button>
              <button type="button" class="nsfw-btn-text" @click="share(listing.id)">
                Compartir
              </button>
              <button type="button" class="nsfw-btn-text" @click="addToCollection(listing.id)">
                Colección
              </button>
              <button type="button" class="nsfw-btn-text" @click="add(listing.id)">Guardar</button>
              <NuxtLink
                v-if="listing.resourceType === 'experience'"
                :to="`/private/create?experience=${listing.id}`"
                class="nsfw-btn-text !text-[var(--nsfw-accent)]"
              >
                Jugar →
              </NuxtLink>
            </div>
          </div>
        </article>
      </div>
    </template>
  </div>
</template>
