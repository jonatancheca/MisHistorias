<script setup lang="ts">
definePageMeta({ layout: 'private' })

const { stories } = await $fetch<{
  stories: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>
}>('/api/private/legacy')
</script>

<template>
  <div class="nsfw-page mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Legado privado</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        Solo lectura. El motor nuevo no reescribe estas historias.
      </p>
    </header>
    <p v-if="stories.length === 0" class="nsfw-card text-sm text-[var(--nsfw-muted)]">
      No hay historias en la colección privada lineal.
    </p>
    <ul class="grid gap-3">
      <li v-for="story in stories" :key="story.id" class="nsfw-card flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <NuxtLink :to="`/private/legacy/${story.id}`" class="text-lg hover:text-[var(--nsfw-accent)]">
            {{ story.title }}
          </NuxtLink>
          <p class="text-xs text-[var(--nsfw-faint)]">{{ story.messageCount }} mensajes</p>
        </div>
          <NuxtLink :to="`/private/legacy/${story.id}`" class="nsfw-btn-primary">
            Abrir / nueva versión
          </NuxtLink>
      </li>
    </ul>
  </div>
</template>
