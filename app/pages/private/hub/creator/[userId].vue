<script setup lang="ts">
definePageMeta({ layout: 'private' })

const route = useRoute()
const userId = String(route.params.userId || '')
const { profile } = await $fetch<{
  profile: {
    username: string
    counts: Record<string, number>
    publications: Array<{
      id: string
      title: string
      summary: string
      resourceType: string
    }>
  }
}>(`/api/private/hub/creator/${userId}`)

const initial = computed(() => (profile.username || '?').slice(0, 1).toLocaleUpperCase('es-ES'))
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[58rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-9 flex items-center gap-4">
      <span class="nsfw-avatar is-gold h-14 w-14 text-2xl">{{ initial }}</span>
      <div>
        <p class="nsfw-eyebrow">Creador</p>
        <h1 class="font-serif text-3xl">{{ profile.username }}</h1>
        <p class="text-xs text-[var(--nsfw-faint)]">
          {{ profile.counts.characters }} personajes · {{ profile.counts.places }} lugares ·
          {{ profile.counts.experiences }} experiences · {{ profile.counts.stories }} stories
        </p>
      </div>
    </header>

    <p v-if="profile.publications.length === 0" class="py-8 text-sm text-[var(--nsfw-muted)]">
      Sin publicaciones visibles.
    </p>

    <div v-else class="nsfw-hairgrid md:grid-cols-2">
      <article v-for="item in profile.publications" :key="item.id" class="px-6 py-6">
        <p class="nsfw-eyebrow">{{ item.resourceType }}</p>
        <h2 class="mb-2 font-serif text-2xl leading-tight">{{ item.title }}</h2>
        <p class="mb-4 font-serif text-base italic leading-relaxed text-[var(--nsfw-muted)]">
          {{ item.summary }}
        </p>
        <NuxtLink
          :to="`/private/hub?publication=${item.id}`"
          class="nsfw-btn-text !text-[var(--nsfw-accent)]"
        >
          Ver en Hub →
        </NuxtLink>
      </article>
    </div>
  </div>
</template>
