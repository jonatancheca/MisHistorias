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
  <div class="nsfw-page mx-auto max-w-[52rem] px-5 py-10 sm:px-12 sm:py-14">
    <header class="mb-8 flex flex-wrap items-end justify-between gap-5">
      <div>
        <p class="nsfw-eyebrow">Solo lectura</p>
        <h1 class="font-serif text-4xl">{{ story.title }}</h1>
      </div>
      <div class="flex items-center gap-5">
        <NuxtLink to="/private/legacy" class="nsfw-btn-text">Volver</NuxtLink>
        <button type="button" class="nsfw-btn-primary" :disabled="busy" @click="revive">
          {{ busy ? 'Creando…' : 'Iniciar nueva versión' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]">{{ error }}</p>
    <p class="mb-8 max-w-[62ch] text-xs leading-relaxed text-[var(--nsfw-dim)]">
      Copia premisa y reparto a una sesión envelope nueva. No convierte mensajes antiguos.
    </p>

    <article class="nsfw-prose">
      <p
        v-for="(message, index) in story.messages"
        :key="index"
        class="whitespace-pre-wrap"
        :class="message.role === 'user' ? 'is-dialogue' : ''"
      >
        <span v-if="message.role === 'user'" class="nsfw-speaker">Tú</span>
        {{ message.text }}
      </p>
    </article>
  </div>
</template>
