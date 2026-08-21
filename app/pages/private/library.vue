<script setup lang="ts">
definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()
const tab = ref<'active' | 'archived' | 'saved'>('active')

await Promise.all([sessions.loadSessions(), sessions.loadArchived(), studio.loadLibraryEntries()])

const list = computed(() =>
  tab.value === 'active'
    ? sessions.sessions
    : tab.value === 'archived'
      ? sessions.archivedSessions
      : []
)

async function restore(id: string) {
  await sessions.archive(id, false)
  tab.value = 'active'
}

async function archive(id: string) {
  await sessions.archive(id, true)
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="font-serif text-3xl">Biblioteca</h1>
        <p class="text-sm text-[var(--nsfw-muted)]">Sesiones, archivo y guardados del Hub.</p>
      </div>
      <NuxtLink to="/private/create" class="nsfw-btn-primary">Crear</NuxtLink>
    </header>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        class="nsfw-btn-ghost"
        :class="tab === 'active' ? 'text-[var(--nsfw-accent)]' : ''"
        @click="tab = 'active'"
      >
        Activas
      </button>
      <button
        type="button"
        class="nsfw-btn-ghost"
        :class="tab === 'archived' ? 'text-[var(--nsfw-accent)]' : ''"
        @click="tab = 'archived'"
      >
        Archivo
      </button>
      <button
        type="button"
        class="nsfw-btn-ghost"
        :class="tab === 'saved' ? 'text-[var(--nsfw-accent)]' : ''"
        @click="tab = 'saved'"
      >
        Guardadas del Hub
      </button>
    </div>

    <p v-if="tab === 'saved' && studio.libraryEntries.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      Aún no has añadido publicaciones del Hub.
    </p>
    <ul v-if="tab === 'saved'" class="mb-6 grid gap-3">
      <li v-for="entry in studio.libraryEntries" :key="entry.id" class="nsfw-card">
        <p class="text-xs uppercase text-[var(--nsfw-faint)]">{{ entry.resourceType }}</p>
        <p class="text-lg">{{ entry.title }}</p>
      </li>
    </ul>

    <p v-if="tab !== 'saved' && list.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      {{ tab === 'active' ? 'No hay historias activas.' : 'El archivo está vacío.' }}
    </p>

    <ul v-if="tab !== 'saved'" class="grid gap-3">
      <li v-for="session in list" :key="session.id" class="nsfw-card flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <NuxtLink
            :to="`/private/play/${session.format === 'chat' ? 'chat' : session.format === 'vn' ? 'vn' : 'story'}/${session.id}`"
            class="block truncate text-lg hover:text-[var(--nsfw-accent)]"
          >
            {{ session.title }}
          </NuxtLink>
          <p class="truncate text-sm text-[var(--nsfw-muted)]">
            {{ session.premise }}
            <span v-if="session.branchLabel"> · {{ session.branchLabel }}</span>
            <span v-if="session.sequelOfSessionId"> · Secuela</span>
          </p>
        </div>
        <button
          v-if="tab === 'active'"
          type="button"
          class="nsfw-btn-ghost"
          @click="archive(session.id)"
        >
          Archivar
        </button>
        <button
          v-else
          type="button"
          class="nsfw-btn-ghost"
          @click="restore(session.id)"
        >
          Restaurar
        </button>
      </li>
    </ul>
  </div>
</template>
