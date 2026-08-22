<script setup lang="ts">
import { FORMAT_BADGES, sessionPlayPath } from '../../../shared/lib/nsfwCreatorConfig.ts'
import { relativeTime } from '../../lib/relativeTime.ts'

definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()
const tab = ref<'active' | 'finished' | 'archived' | 'saved'>('active')
const formatFilter = ref<'all' | 'story' | 'chat' | 'vn'>('all')
const order = ref<'recent' | 'title'>('recent')

await Promise.all([sessions.loadSessions(), sessions.loadArchived(), studio.loadLibraryEntries()])

const active = computed(() => sessions.sessions.filter((item) => !item.finalizedAt))
const finished = computed(() => sessions.sessions.filter((item) => item.finalizedAt))

const list = computed(() => {
  const base =
    tab.value === 'active'
      ? active.value
      : tab.value === 'finished'
        ? finished.value
        : tab.value === 'archived'
          ? sessions.archivedSessions
          : []
  const filtered =
    formatFilter.value === 'all'
      ? base
      : base.filter((item) => item.format === formatFilter.value)
  return [...filtered].sort((a, b) =>
    order.value === 'title' ? a.title.localeCompare(b.title, 'es-ES') : b.updatedAt - a.updatedAt
  )
})

const tabs = computed(() => [
  { id: 'active' as const, label: 'En curso', count: active.value.length },
  { id: 'finished' as const, label: 'Terminadas', count: finished.value.length },
  { id: 'archived' as const, label: 'Archivo', count: sessions.archivedSessions.length },
  { id: 'saved' as const, label: 'Guardadas del Hub', count: studio.libraryEntries.length }
])

function badge(format: string) {
  return FORMAT_BADGES[format as keyof typeof FORMAT_BADGES] || FORMAT_BADGES.story
}

async function restore(id: string) {
  await sessions.archive(id, false)
  tab.value = 'active'
}

async function archive(id: string) {
  await sessions.archive(id, true)
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[58rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-8 flex flex-wrap items-baseline justify-between gap-4">
      <h1 class="font-serif text-4xl">Biblioteca</h1>
      <NuxtLink to="/private/create" class="nsfw-btn-ghost">
        <span aria-hidden="true">+</span> Nueva historia
      </NuxtLink>
    </header>

    <div class="nsfw-tabs mb-1">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        class="nsfw-tab"
        :class="tab === item.id ? 'is-active' : ''"
        @click="tab = item.id"
      >
        {{ item.label }} <small>{{ item.count }}</small>
      </button>
      <span class="flex-1" />
      <label class="pb-2.5 text-xs text-[var(--nsfw-dim)]">
        <span class="sr-only">Formato</span>
        <select
          v-model="formatFilter"
          class="border-0 bg-transparent text-xs text-[var(--nsfw-dim)] outline-none"
        >
          <option value="all">Formato</option>
          <option value="story">Story</option>
          <option value="chat">Chat</option>
          <option value="vn">VN</option>
        </select>
      </label>
      <label class="pb-2.5 text-xs text-[var(--nsfw-dim)]">
        <span class="sr-only">Orden</span>
        <select
          v-model="order"
          class="border-0 bg-transparent text-xs text-[var(--nsfw-dim)] outline-none"
        >
          <option value="recent">Recientes</option>
          <option value="title">Título</option>
        </select>
      </label>
    </div>

    <template v-if="tab === 'saved'">
      <p v-if="!studio.libraryEntries.length" class="py-8 text-sm text-[var(--nsfw-muted)]">
        Aún no has añadido publicaciones del Hub.
      </p>
      <div v-for="entry in studio.libraryEntries" :key="entry.id" class="nsfw-row cursor-default">
        <span class="nsfw-row-kind text-[var(--nsfw-muted)]">{{ entry.resourceType }}</span>
        <span class="min-w-0 flex-1">
          <span class="nsfw-row-title block truncate">{{ entry.title }}</span>
        </span>
      </div>
    </template>

    <template v-else>
      <p v-if="!list.length" class="py-8 text-sm text-[var(--nsfw-muted)]">
        {{ tab === 'archived' ? 'El archivo está vacío.' : 'No hay historias aquí todavía.' }}
      </p>

      <div v-for="session in list" :key="session.id" class="nsfw-row cursor-default">
        <span class="nsfw-row-kind" :style="{ color: badge(session.format).color }">
          {{ badge(session.format).short }}
        </span>
        <NuxtLink
          :to="sessionPlayPath(session.format, session.id)"
          class="min-w-0 flex-1"
        >
          <span class="nsfw-row-title block truncate">
            {{ session.title }}
            <span
              v-if="session.branchLabel"
              class="ml-2 font-sans text-[0.7rem] uppercase tracking-[0.08em] text-[var(--nsfw-azure)]"
            >
              {{ session.branchLabel }}
            </span>
            <span
              v-else-if="session.sequelOfSessionId"
              class="ml-2 font-sans text-[0.7rem] uppercase tracking-[0.08em] text-[var(--nsfw-faint)]"
            >
              secuela
            </span>
          </span>
          <span class="nsfw-row-sub block">{{ session.premise }}</span>
        </NuxtLink>
        <span class="nsfw-row-meta w-14 text-right">{{ relativeTime(session.updatedAt) }}</span>
        <button
          v-if="tab === 'archived'"
          type="button"
          class="nsfw-btn-text shrink-0"
          @click="restore(session.id)"
        >
          Restaurar
        </button>
        <button
          v-else
          type="button"
          class="nsfw-btn-text shrink-0"
          @click="archive(session.id)"
        >
          Archivar
        </button>
      </div>
    </template>
  </div>
</template>
