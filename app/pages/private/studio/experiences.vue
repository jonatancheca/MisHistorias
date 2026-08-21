<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const title = ref('')
const premise = ref('')
const message = ref<string | null>(null)

await studio.loadExperiences()

async function create() {
  await studio.createExperience({ title: title.value, premise: premise.value })
  title.value = ''
  premise.value = ''
  message.value = 'Experience creada'
}

async function publish(id: string) {
  await studio.publish({ resourceType: 'experience', resourceId: id })
  await studio.loadExperiences()
  message.value = 'Publicada'
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Studio</p>
      <h1 class="font-serif text-3xl">Experiences</h1>
      <p class="text-sm text-[var(--nsfw-muted)]">Premisa, slots y perfil. La sesión no muta la plantilla.</p>
    </header>
    <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]">{{ message }}</p>

    <section class="nsfw-card mb-6 space-y-3">
      <input v-model="title" class="nsfw-input w-full" placeholder="Título">
      <textarea v-model="premise" class="nsfw-input min-h-24 w-full" placeholder="Premisa" />
      <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
    </section>

    <ul class="grid gap-3">
      <li
        v-for="experience in studio.experiences"
        :key="experience.id"
        class="nsfw-card flex flex-wrap items-center gap-3"
      >
        <div class="min-w-0 flex-1">
          <p class="text-lg">{{ experience.title }}</p>
          <p class="truncate text-sm text-[var(--nsfw-muted)]">{{ experience.premise }}</p>
        </div>
        <button
          v-if="!experience.published"
          type="button"
          class="nsfw-btn-ghost"
          @click="publish(experience.id)"
        >
          Publicar
        </button>
      </li>
    </ul>
  </div>
</template>
