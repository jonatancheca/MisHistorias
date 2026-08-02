<script setup lang="ts">
const { notice: storagePersistenceNotice, requesting, requestPersistence } =
  useStoragePersistence()
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <div
      v-if="storagePersistenceNotice"
      role="alert"
      class="fixed top-3 right-3 left-3 z-50 flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm shadow-lg sm:left-auto sm:max-w-md sm:flex-nowrap"
      :class="
        storagePersistenceNotice.kind === 'success'
          ? 'border-emerald-400/60 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-50'
          : 'border-amber-400/60 bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-50'
      "
    >
      <p class="w-full sm:w-auto sm:flex-1">{{ storagePersistenceNotice.message }}</p>
      <button
        v-if="storagePersistenceNotice.kind === 'warning'"
        type="button"
        class="shrink-0 rounded px-2 py-1 font-semibold hover:bg-amber-500/15 disabled:opacity-60"
        :disabled="requesting"
        @click="requestPersistence()"
      >
        {{ requesting ? 'Solicitando…' : 'Volver a intentar' }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded px-2 py-1 font-semibold hover:bg-amber-500/15"
        aria-label="Cerrar aviso de almacenamiento"
        @click="storagePersistenceNotice = null"
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
