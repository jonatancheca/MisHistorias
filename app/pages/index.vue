<script setup lang="ts">
const stories = useStoriesStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()

await stories.load()

const showArchived = ref(false)
const refreshing = ref(false)
const refreshError = ref<string | null>(null)
const catalogStories = computed(() =>
  privacy.isDemo
    ? stories.stories.filter((story) => story.visibleInDemo)
    : stories.stories
)
const visibleStories = computed(() =>
  catalogStories.value.filter((story) => story.archived === showArchived.value)
)
const activeCount = computed(() => catalogStories.value.filter((story) => !story.archived).length)
const archivedCount = computed(() => catalogStories.value.filter((story) => story.archived).length)
const dateFormatter = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})
const emptyMessage = computed(() => {
  if (showArchived.value) return 'No hay historias archivadas.'
  return catalogStories.value.length
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

async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    await stories.load(true)
  } catch (caught) {
    refreshError.value = (caught as Error).message || 'No se pudieron recargar las historias.'
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <header class="library-hero mb-7 flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:p-9">
      <div class="relative z-10 max-w-2xl">
        <p class="page-kicker">Biblioteca narrativa</p>
        <h1 class="page-title">Tus historias, siempre listas para continuar</h1>
        <p class="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-fg-muted)] sm:text-base">
          Crea mundos, reúne personajes y retoma cada aventura exactamente donde la dejaste.
        </p>
        <div class="mt-5 flex flex-wrap gap-2.5 text-xs font-semibold text-[var(--color-fg-muted)]">
          <span class="rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] px-3 py-1.5">
            {{ activeCount }} {{ activeCount === 1 ? 'historia activa' : 'historias activas' }}
          </span>
          <span class="rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] px-3 py-1.5">
            {{ archivedCount }} {{ archivedCount === 1 ? 'archivada' : 'archivadas' }}
          </span>
        </div>
      </div>
      <div class="relative z-10 flex flex-wrap gap-2">
        <button type="button" class="btn-ghost" :disabled="refreshing" @click="reload">
          <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 11a8 8 0 0 0-14.7-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.7 4L21 15m0 0v5m0-5h-5" />
          </svg>
          {{ refreshing ? 'Recargando…' : 'Recargar' }}
        </button>
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
        <NuxtLink to="/stories/new" class="btn-primary">
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nueva historia
        </NuxtLink>
      </div>
    </header>

    <p v-if="refreshError" class="card mb-4 text-sm text-red-500" role="alert">
      {{ refreshError }}
    </p>

    <p v-if="visibleStories.length === 0" class="empty-state card py-12 text-sm text-[var(--color-fg-muted)]">
      <span class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-600">
        <svg aria-hidden="true" class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M4 5a3 3 0 0 1 3-3h13v18H7a3 3 0 0 0-3 3V5Z" />
          <path d="M8 7h8m-8 4h5" />
        </svg>
      </span>
      <span class="block font-semibold text-[var(--color-fg)]">{{ emptyMessage }}</span>
      <span v-if="!showArchived" class="mt-1 block">Tu próxima aventura puede empezar aquí.</span>
    </p>

    <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="(story, index) in visibleStories"
        :key="story.id"
        class="story-card card flex min-h-48 flex-col gap-5 pl-6"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span class="story-index">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="min-w-0 flex-1 pt-0.5">
            <p class="text-[0.65rem] font-bold tracking-[0.12em] text-brand-600 uppercase">
              {{ story.archived ? 'Historia archivada' : 'Historia en curso' }}
            </p>
            <NuxtLink
              :to="`/stories/${story.id}`"
              class="mt-1 block truncate text-xl font-bold tracking-[-0.025em] hover:text-brand-600"
            >
              {{ story.title }}
            </NuxtLink>
            <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--color-fg-muted)]">
              {{ story.premise || 'Una historia esperando su siguiente capítulo.' }}
            </p>
          </div>
        </div>

        <div class="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--color-border-soft)] pt-4">
          <span class="mr-auto text-xs text-[var(--color-fg-muted)]">
            Editada {{ dateFormatter.format(story.updatedAt) }}
          </span>
          <NuxtLink
            :to="{ path: '/stories/new', query: { copyFrom: story.id } }"
            class="btn-ghost min-h-9 px-2.5 py-1.5"
          >
            Copiar
          </NuxtLink>
          <button
            type="button"
            class="btn-ghost inline-flex min-h-9 shrink-0 items-center px-2.5 py-1.5"
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
          <button type="button" class="btn-danger min-h-9 px-2.5 py-1.5" @click="remove(story.id)">Borrar</button>
        </div>
      </li>
    </ul>
  </div>
</template>
