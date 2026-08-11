<script setup lang="ts">
const stories = useStoriesStore()
const confirmDialog = useConfirmStore()

await stories.load()

async function remove(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar historia',
    message: 'Se borrarán la historia y todos sus mensajes. Esta acción no se puede deshacer.'
  })
  if (!accepted) return
  await stories.removeStory(id)
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Historias</h1>
        <p class="text-sm text-[var(--color-fg-muted)]">Cada sesión es una historia nueva.</p>
      </div>
      <NuxtLink to="/stories/new" class="btn-primary">Nueva historia</NuxtLink>
    </header>

    <p v-if="stories.stories.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      Todavía no hay historias. Crea personajes y empieza una.
    </p>

    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="story in stories.stories"
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
          <button type="button" class="btn-danger" @click="remove(story.id)">Borrar</button>
        </div>
      </li>
    </ul>
  </div>
</template>
