<script setup lang="ts">
const storagePersistenceWarning = useState<string | null>(
  'storage-persistence-warning',
  () => null
)
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <div
      v-if="storagePersistenceWarning"
      role="alert"
      class="fixed top-3 right-3 left-3 z-50 flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg sm:left-auto sm:max-w-md dark:bg-amber-950 dark:text-amber-50"
    >
      <p class="flex-1">{{ storagePersistenceWarning }}</p>
      <button
        type="button"
        class="shrink-0 rounded px-2 py-1 font-semibold hover:bg-amber-500/15"
        aria-label="Cerrar aviso de almacenamiento"
        @click="storagePersistenceWarning = null"
      >
        Cerrar
      </button>
    </div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ConfirmDialog />
  </div>
</template>
