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
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl overflow-x-hidden px-3 py-8 sm:px-6">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Creador</p>
      <h1 class="font-serif text-3xl">{{ profile.username }}</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        {{ profile.counts.characters }} personajes · {{ profile.counts.places }} lugares ·
        {{ profile.counts.experiences }} experiences · {{ profile.counts.stories }} stories
      </p>
    </header>

    <p v-if="profile.publications.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      Sin publicaciones visibles.
    </p>
    <ul class="grid gap-3 md:grid-cols-2">
      <li v-for="item in profile.publications" :key="item.id" class="nsfw-card">
        <p class="text-xs uppercase text-[var(--nsfw-faint)]">{{ item.resourceType }}</p>
        <h2 class="text-xl">{{ item.title }}</h2>
        <p class="text-sm text-[var(--nsfw-muted)]">{{ item.summary }}</p>
        <NuxtLink :to="`/private/hub?publication=${item.id}`" class="nsfw-btn-ghost mt-2 inline-flex">
          Ver en Hub
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
