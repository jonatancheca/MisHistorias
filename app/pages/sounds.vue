<script setup lang="ts">
const sounds = useSoundsStore()
await sounds.load()

const refreshing = ref(false)
const refreshError = ref<string | null>(null)

async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  refreshError.value = null
  try {
    await sounds.load(true)
  } catch (caught) {
    refreshError.value = (caught as Error).message || 'No se pudieron recargar los sonidos.'
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="page-kicker">Paisaje sonoro</p>
        <h1 class="page-title">Sonidos</h1>
        <p class="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
          Sonidos sueltos disponibles para cualquier historia. Los asociados se añaden desde personajes o fondos.
        </p>
      </div>
      <button type="button" class="btn-ghost" :disabled="refreshing" @click="reload">
        <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 11a8 8 0 0 0-14.7-4L3 9m0 0V4m0 5h5M4 13a8 8 0 0 0 14.7 4L21 15m0 0v5m0-5h-5" />
        </svg>
        {{ refreshing ? 'Recargando…' : 'Recargar' }}
      </button>
    </header>

    <p v-if="refreshError" class="card mb-4 text-sm text-red-500" role="alert">
      {{ refreshError }}
    </p>
    <section class="card max-w-3xl">
      <SoundEditor title="Sonidos sueltos" />
    </section>
  </div>
</template>
