<script setup lang="ts">
import { relativeTime } from '../../../lib/relativeTime.ts'

definePageMeta({ layout: 'private' })

const { stories } = await $fetch<{
  stories: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>
}>('/api/private/legacy')
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[52rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-8">
      <h1 class="font-serif text-4xl">Legado privado</h1>
      <p class="mt-1 text-xs text-[var(--nsfw-faint)]">
        Solo lectura. El motor nuevo no reescribe estas historias.
      </p>
    </header>

    <p v-if="stories.length === 0" class="py-8 text-sm text-[var(--nsfw-muted)]">
      No hay historias en la colección privada lineal.
    </p>

    <NuxtLink
      v-for="story in stories"
      :key="story.id"
      :to="`/private/legacy/${story.id}`"
      class="nsfw-row"
    >
      <span class="min-w-0 flex-1">
        <span class="nsfw-row-title block truncate">{{ story.title }}</span>
        <span class="nsfw-row-sub block">{{ story.messageCount }} mensajes</span>
      </span>
      <span class="nsfw-row-meta">{{ relativeTime(story.updatedAt) }}</span>
      <span class="nsfw-row-meta text-base" aria-hidden="true">→</span>
    </NuxtLink>
  </div>
</template>
