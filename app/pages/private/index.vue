<script setup lang="ts">
import { FORMAT_BADGES, QUICK_PRESETS, sessionPlayPath } from '../../../shared/lib/nsfwCreatorConfig.ts'
import { relativeTime } from '../../lib/relativeTime.ts'

definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()

await Promise.all([sessions.loadSessions(), studio.loadExperiences().catch(() => null)])

/** El saludo usa el nombre de escena, nunca la cuenta (puede ser un email). */
const profile = await $fetch<{ profile: { displayName: string } | null }>(
  '/api/private/profile/self-insert'
).catch(() => ({ profile: null }))
const sceneName = (profile.profile?.displayName || '').trim()

const now = new Date()
const today = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
const greeting =
  now.getHours() < 6
    ? 'Buenas noches'
    : now.getHours() < 13
      ? 'Buenos días'
      : now.getHours() < 21
        ? 'Buenas tardes'
        : 'Buenas noches'

const resume = computed(() => sessions.sessions[0] || null)
const inProgress = computed(() => sessions.sessions.slice(resume.value ? 1 : 0, 6))

/** Una celda coral («Desde cero») y tres arranques ya resueltos. */
const starters = computed(() => {
  const fromStudio = studio.experiences.slice(0, 2).map((item) => ({
    key: `exp-${item.id}`,
    title: item.title,
    hint: item.premise,
    to: `/private/create?experience=${item.id}`,
    color: 'var(--nsfw-azure)'
  }))
  const fromPresets = QUICK_PRESETS.map((preset) => ({
    key: `preset-${preset.id}`,
    title: preset.title,
    hint: preset.description,
    to: `/private/create?preset=${preset.id}`,
    color: 'var(--nsfw-gold)'
  }))
  return [...fromStudio, ...fromPresets].slice(0, 3)
})

function badge(format: string) {
  return FORMAT_BADGES[format as keyof typeof FORMAT_BADGES] || FORMAT_BADGES.story
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[57rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-10 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p class="nsfw-eyebrow first-letter:uppercase">{{ today }}</p>
        <h1 class="font-serif text-4xl leading-tight sm:text-[2.4rem]">
          {{ sceneName ? `${greeting}, ${sceneName}` : greeting }}
        </h1>
      </div>
      <NuxtLink to="/private/create" class="nsfw-btn-primary min-h-13">
        <span aria-hidden="true" class="text-lg leading-none">+</span>
        Crear historia
      </NuxtLink>
    </header>

    <!-- Donde lo dejaste: la prosa manda, sin tarjeta. -->
    <section v-if="resume" class="nsfw-block mb-11">
      <p class="nsfw-eyebrow mb-4">Donde lo dejaste · {{ relativeTime(resume.updatedAt) }}</p>
      <h2 class="mb-1 font-serif text-[2rem] leading-tight">{{ resume.title }}</h2>
      <p class="mb-4 text-xs text-[var(--nsfw-faint)]">
        {{ badge(resume.format).short }}
        <template v-if="resume.branchLabel"> · {{ resume.branchLabel }}</template>
        <template v-if="resume.sequelOfSessionId"> · secuela</template>
        · {{ resume.modelAlias }}
        <template v-if="resume.finalizedAt"> · finalizada</template>
      </p>
      <p
        class="mb-6 max-w-[56ch] font-serif text-[1.15rem] italic leading-[1.66] text-[var(--nsfw-muted)]"
      >
        «{{ resume.premise }}»
      </p>
      <div class="flex flex-wrap items-center gap-5">
        <NuxtLink :to="sessionPlayPath(resume.format, resume.id)" class="nsfw-btn-primary">
          Seguir leyendo
        </NuxtLink>
        <NuxtLink to="/private/library" class="nsfw-btn-text">Toda la biblioteca</NuxtLink>
      </div>
    </section>

    <!-- Empezar algo nuevo -->
    <section class="mb-11">
      <div class="nsfw-section-head">
        <h3>Empezar algo nuevo</h3>
        <NuxtLink to="/private/studio/experiences" class="nsfw-btn-text">
          Todas las Experiences
        </NuxtLink>
      </div>
      <div class="nsfw-hairgrid sm:grid-cols-2 lg:grid-cols-4">
        <NuxtLink to="/private/create" class="nsfw-cell selected">
          <span
            aria-hidden="true"
            class="mb-1 text-xl leading-none text-[var(--nsfw-accent)]"
          >+</span>
          <strong>Desde cero</strong>
          <span>Tres pasos: origen, forma de contarla e intereses.</span>
          <span class="mt-2 text-[var(--nsfw-accent)]">Crear historia →</span>
        </NuxtLink>
        <NuxtLink v-for="item in starters" :key="item.key" :to="item.to" class="nsfw-cell">
          <span
            aria-hidden="true"
            class="mb-1 block h-[5px] w-[5px] rounded-full"
            :style="{ background: item.color }"
          />
          <strong class="!text-xl">{{ item.title }}</strong>
          <span class="line-clamp-2">{{ item.hint }}</span>
        </NuxtLink>
      </div>
    </section>

    <!-- En curso -->
    <section>
      <div class="nsfw-section-head !mb-0">
        <h3>En curso</h3>
        <NuxtLink to="/private/library" class="nsfw-btn-text">Toda la biblioteca</NuxtLink>
      </div>

      <p v-if="!resume" class="py-6 text-sm text-[var(--nsfw-muted)]">
        Todavía no hay sesiones. Crea la primera o elige una Experience.
      </p>

      <NuxtLink
        v-for="session in inProgress"
        :key="session.id"
        :to="sessionPlayPath(session.format, session.id)"
        class="nsfw-row"
      >
        <span class="nsfw-row-kind" :style="{ color: badge(session.format).color }">
          {{ badge(session.format).short }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="nsfw-row-title block truncate">{{ session.title }}</span>
          <span class="nsfw-row-sub block">{{ session.premise }}</span>
        </span>
        <span class="nsfw-row-meta">{{ relativeTime(session.updatedAt) }}</span>
        <span class="nsfw-row-meta text-base" aria-hidden="true">→</span>
      </NuxtLink>
    </section>
  </div>
</template>
