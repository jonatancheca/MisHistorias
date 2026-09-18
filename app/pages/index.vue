<script setup lang="ts">
const stories = useStoriesStore()
const confirmDialog = useConfirmStore()

await stories.load()

const showArchived = ref(false)
const visibleStories = computed(() =>
  stories.stories.filter((story) => story.archived === showArchived.value)
)
const emptyMessage = computed(() => {
  if (showArchived.value) return 'No hay historias archivadas.'
  return stories.stories.length
    ? 'No hay historias activas.'
    : 'Todavía no hay historias. Crea personajes y empieza una.'
})

async function remove(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar historia',
    message: 'Se borrarán la historia y todos sus mensajes. Esta acción no se puede deshacer.'
  })
  if (!accepted) return
  await stories.removeStory(id)
}

async function setArchived(id: string, archived: boolean) {
  await stories.setArchived(id, archived)
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">Historias</h1>
        <p class="text-sm text-[var(--color-fg-muted)]">Cada sesión es una historia nueva.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn-ghost"
          :aria-pressed="showArchived"
          @click="showArchived = !showArchived"
        >
          <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
          </svg>
          {{ showArchived ? 'Ver activas' : 'Ver archivadas' }}
        </button>
        <NuxtLink to="/stories/new" class="btn-primary">Nueva historia</NuxtLink>
      </div>
    </header>

    <p v-if="visibleStories.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      {{ emptyMessage }}
    </p>

    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="story in visibleStories"
        :key="story.id"
        class="card flex flex-wrap items-center gap-2 py-3"
      >
        <NuxtLink
          :to="`/stories/${story.id}`"
          class="min-w-0 flex-1 basis-full truncate text-lg font-semibold hover:text-brand-600 sm:basis-auto"
        >
          {{ story.title }}
        </NuxtLink>
        <div class="ml-auto flex shrink-0 gap-2">
          <NuxtLink
            :to="{ path: '/stories/new', query: { copyFrom: story.id } }"
            class="btn-ghost"
          >
            Copiar
          </NuxtLink>
          <button
            type="button"
            class="btn-ghost inline-flex shrink-0 items-center px-2"
            :aria-label="story.archived ? 'Desarchivar' : 'Archivar'"
            :title="story.archived ? 'Desarchivar' : 'Archivar'"
            @click="setArchived(story.id, !story.archived)"
          >
            <svg v-if="story.archived" aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16v13H4zM3 3h18v4H3zM12 16v-5m0 0-3 3m3-3 3 3" />
            </svg>
            <svg v-else aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
            </svg>
          </button>
          <button type="button" class="btn-danger" @click="remove(story.id)">Borrar</button>
        </div>
      </li>
    </ul>
  </div>
</template>
