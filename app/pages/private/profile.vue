<script setup lang="ts">
definePageMeta({ layout: 'private' })

const displayName = ref('')
const pronouns = ref('')
const appearance = ref('')
const boundaries = ref('')
const message = ref<string | null>(null)

const { profile } = await $fetch<{
  profile: {
    displayName: string
    pronouns: string
    appearance: string
    boundaries: string[]
  } | null
}>('/api/private/profile/self-insert')

if (profile) {
  displayName.value = profile.displayName
  pronouns.value = profile.pronouns
  appearance.value = profile.appearance
  boundaries.value = profile.boundaries.join(', ')
}

async function save() {
  await $fetch('/api/private/profile/self-insert', {
    method: 'POST',
    body: {
      displayName: displayName.value,
      pronouns: pronouns.value,
      appearance: appearance.value,
      boundaries: boundaries.value.split(',').map((item) => item.trim()).filter(Boolean)
    }
  })
  message.value = 'Perfil guardado'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-2xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <h1 class="font-serif text-3xl">Self-insert</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">
        Cómo te representan las sesiones. No copia avatares de sistema.
      </p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>
    <form class="nsfw-card space-y-3" @submit.prevent="save">
      <input v-model="displayName" class="nsfw-input w-full" placeholder="Nombre en escena">
      <input v-model="pronouns" class="nsfw-input w-full" placeholder="Pronombres">
      <textarea v-model="appearance" class="nsfw-input min-h-24 w-full" placeholder="Apariencia" />
      <input v-model="boundaries" class="nsfw-input w-full" placeholder="Límites (coma)">
      <button type="submit" class="nsfw-btn-primary">Guardar</button>
    </form>
  </div>
</template>
