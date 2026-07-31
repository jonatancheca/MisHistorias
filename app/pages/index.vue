<script setup lang="ts">
const stories = useStoriesStore()

await stories.load()

async function remove(id: string) {
  if (!confirm('¿Borrar la historia y todos sus mensajes?')) return
  await stories.removeStory(id)
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-8">
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

    <ul class="grid gap-2">
      <li v-for="story in stories.stories" :key="story.id" class="card flex items-center gap-4 py-3">
        <NuxtLink
          :to="`/stories/${story.id}`"
          class="min-w-0 flex-1 truncate text-lg font-semibold hover:text-brand-600"
        >
          {{ story.title }}
        </NuxtLink>
        <button type="button" class="btn-danger shrink-0" @click="remove(story.id)">Borrar</button>
      </li>
    </ul>
  </div>
</template>
