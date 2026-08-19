<script setup lang="ts">
const DISMISSED_KEY = 'mishistorias.dismissed-update.v1'
const appUpdate = useAppUpdate()
const dismissedVersion = ref<string | null>(null)

const visible = computed(() => Boolean(
  appUpdate.info.value?.updateAvailable &&
  appUpdate.info.value.latestVersion !== dismissedVersion.value
))

function dismiss() {
  const version = appUpdate.info.value?.latestVersion
  if (!version) return
  dismissedVersion.value = version
  localStorage.setItem(DISMISSED_KEY, version)
}

onMounted(() => {
  dismissedVersion.value = localStorage.getItem(DISMISSED_KEY)
  if (!appUpdate.checked.value) void appUpdate.check({ silent: true })
})
</script>

<template>
  <aside
    v-if="visible"
    data-testid="app-update-banner"
    class="fixed inset-x-3 top-3 z-50 rounded-xl border border-brand-400/50 bg-[var(--color-surface)] p-4 shadow-xl sm:right-5 sm:left-auto sm:max-w-lg"
    aria-label="Actualización disponible"
  >
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="font-semibold text-brand-600">Nueva versión disponible</p>
        <p class="mt-1 break-words text-sm text-[var(--color-fg-muted)]">
          {{ appUpdate.info.value?.latestVersion }}. Descarga el actualizador para instalarla.
        </p>
        <a
          v-if="appUpdate.info.value?.updaterUrl"
          class="btn-primary mt-3"
          :href="appUpdate.info.value.updaterUrl"
          rel="noopener noreferrer"
        >
          Descargar actualizador
        </a>
      </div>
      <button
        type="button"
        class="rounded p-1 text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        aria-label="Descartar actualización"
        @click="dismiss"
      >
        <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  </aside>
</template>
