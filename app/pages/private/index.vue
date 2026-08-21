<script setup lang="ts">
definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()

await Promise.all([sessions.loadSessions(), studio.loadExperiences().catch(() => null)])

const recent = computed(() => sessions.sessions.slice(0, 6))
const continueSession = computed(() => recent.value[0] || null)

function playPath(format: string, id: string) {
  if (format === 'chat') return `/private/play/chat/${id}`
  if (format === 'vn') return `/private/play/vn/${id}`
  return `/private/play/story/${id}`
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl overflow-x-hidden px-3 py-8 sm:px-6">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Inicio</p>
        <h1 class="font-serif text-4xl text-[var(--nsfw-ink)]">Tus historias</h1>
        <p class="mt-1 text-sm text-[var(--nsfw-muted)]">
          Continuar es el camino corto. Sin feed social.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <NuxtLink
          v-if="continueSession"
          :to="playPath(continueSession.format, continueSession.id)"
          class="nsfw-btn-primary"
        >
          Continuar
        </NuxtLink>
        <NuxtLink to="/private/create" class="nsfw-btn-ghost">Crear</NuxtLink>
      </div>
    </header>

    <section v-if="studio.experiences.length" class="mb-8">
      <h2 class="mb-3 text-sm font-medium text-[var(--nsfw-muted)]">Experiences</h2>
      <ul class="grid gap-3 sm:grid-cols-2">
        <li
          v-for="experience in studio.experiences.slice(0, 4)"
          :key="experience.id"
          class="nsfw-card"
        >
          <p class="text-lg">{{ experience.title }}</p>
          <p class="line-clamp-2 text-sm text-[var(--nsfw-muted)]">{{ experience.premise }}</p>
          <NuxtLink
            :to="`/private/create?experience=${experience.id}`"
            class="nsfw-btn-ghost mt-2 inline-flex"
          >
            Empezar
          </NuxtLink>
        </li>
      </ul>
    </section>

    <p v-if="recent.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      Todavía no hay sesiones. Crea la primera o elige una Experience.
    </p>

    <ul class="grid gap-3">
      <li
        v-for="session in recent"
        :key="session.id"
        class="nsfw-card flex flex-wrap items-center gap-3"
      >
        <div class="min-w-0 flex-1">
          <NuxtLink
            :to="playPath(session.format, session.id)"
            class="block truncate text-lg text-[var(--nsfw-ink)] hover:text-[var(--nsfw-accent)]"
          >
            {{ session.title }}
          </NuxtLink>
          <p class="truncate text-sm text-[var(--nsfw-muted)]">{{ session.premise }}</p>
        </div>
        <span class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">{{ session.format }}</span>
        <NuxtLink :to="playPath(session.format, session.id)" class="nsfw-btn-primary">
          Continuar
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
