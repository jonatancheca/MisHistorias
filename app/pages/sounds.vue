<script setup lang="ts">
const sounds = useSoundsStore()
await sounds.load()
</script>

<template>
  <div class="page-shell">
    <h1 class="mb-2 text-2xl font-bold">Sonidos</h1>
    <p class="mb-6 text-sm text-[var(--color-fg-muted)]">
      Sonidos sueltos disponibles para cualquier historia. Los asociados se añaden desde personajes o fondos.
    </p>
    <section class="card max-w-3xl">
      <SoundEditor title="Sonidos sueltos" />
    </section>
  </div>
</template>
