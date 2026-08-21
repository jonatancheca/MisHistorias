<script setup lang="ts">
definePageMeta({ layout: 'private' })

const route = useRoute()
const id = String(route.params.id || '')
const busy = ref(false)
const error = ref<string | null>(null)
const { story } = await $fetch<{
  story: { id: string; title: string; messages: Array<{ role: string; text: string }> }
}>(`/api/private/legacy/${id}`)

async function revive() {
  busy.value = true
  error.value = null
  try {
    const result = await $fetch<{ session: { id: string; format: string } }>(
      `/api/private/legacy/${id}/revive`,
      { method: 'POST' }
    )
    await navigateTo(`/private/play/${result.session.format}/${result.session.id}`)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo iniciar la nueva versión'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Solo lectura</p>
        <h1 class="font-serif text-3xl">{{ story.title }}</h1>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/private/legacy" class="nsfw-btn-ghost">Volver</NuxtLink>
        <button type="button" class="nsfw-btn-primary" :disabled="busy" @click="revive">
          {{ busy ? 'Creando…' : 'Iniciar nueva versión' }}
        </button>
      </div>
    </header>
    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]">{{ error }}</p>
    <p class="mb-4 text-xs text-[var(--nsfw-faint)]">
      Copia premisa y reparto a una sesión envelope nueva. No convierte mensajes antiguos.
    </p>
    <article class="space-y-4">
      <p
        v-for="(message, index) in story.messages"
        :key="index"
        class="nsfw-card whitespace-pre-wrap text-sm"
        :class="message.role === 'user' ? 'border-[var(--nsfw-accent)]/40' : ''"
      >
        <span class="mb-1 block text-xs uppercase text-[var(--nsfw-faint)]">{{ message.role }}</span>
        {{ message.text }}
      </p>
    </article>
  </div>
</template>
