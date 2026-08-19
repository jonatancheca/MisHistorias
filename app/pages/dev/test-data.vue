<script setup lang="ts">
import type { TestDataResetResult } from '~/lib/testData'
import { DEFAULT_SOUND_VERSION } from '~/lib/defaultSounds'

if (!import.meta.dev) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const privacy = usePrivacyStore()
const settings = useSettingsStore()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const presets = usePresetsStore()

const running = ref(false)
const result = ref<TestDataResetResult | null>(null)
const error = ref<string | null>(null)

async function run(seed: boolean) {
  running.value = true
  result.value = null
  error.value = null

  try {
    if (privacy.isPrivate) throw new Error('Sal del modo privado antes de continuar.')
    const { resetNormalTestData } = await import('~/lib/testData')
    const next = await resetNormalTestData(seed)
    settings.settings.activePresetId = next.activePresetId
    settings.settings.defaultSoundVersion = seed ? 0 : DEFAULT_SOUND_VERSION

    await stories.resetForScope()
    characters.resetForScope()
    backgrounds.resetForScope()
    sounds.resetForScope()
    presets.resetForScope()

    if (seed) {
      await Promise.all([
        stories.load(true),
        characters.load(true),
        backgrounds.load(true),
        sounds.load(true),
        presets.load(true)
      ])
      const { countNormalTestData } = await import('~/lib/testData')
      next.counts = await countNormalTestData()
    }
    result.value = next
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudieron reiniciar los datos.'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-8">
    <h1 class="text-2xl font-bold">Datos de prueba</h1>
    <p class="mt-2 text-sm text-[var(--color-fg-muted)]">
      Solo colección normal. Ajustes y colección privada permanecen intactos.
    </p>

    <div class="mt-6 flex flex-wrap gap-3">
      <button type="button" class="btn-ghost" :disabled="running" @click="run(false)">
        Limpiar
      </button>
      <button type="button" class="btn-primary" :disabled="running" @click="run(true)">
        {{ running ? 'Procesando…' : 'Limpiar y cargar datos de prueba' }}
      </button>
      <NuxtLink to="/" class="btn-ghost">Volver a historias</NuxtLink>
    </div>

    <p v-if="error" role="alert" class="mt-5 text-sm text-red-500">{{ error }}</p>

    <section v-if="result" class="mt-6 rounded-lg border border-[var(--color-border)] p-4">
      <h2 class="font-semibold">
        {{ result.seeded ? 'Limpieza y semilla completadas' : 'Limpieza completada' }}
      </h2>
      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div v-for="(count, name) in result.counts" :key="name">
          <dt class="text-[var(--color-fg-muted)]">{{ name }}</dt>
          <dd class="font-semibold">{{ count }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
