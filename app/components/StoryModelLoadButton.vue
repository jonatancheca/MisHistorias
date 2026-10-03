<script setup lang="ts">
defineProps<{ loading?: boolean; disabled?: boolean; compactOnMobile?: boolean }>()
defineEmits<{ load: [] }>()
</script>

<template>
  <button
    type="button"
    class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] px-2.5 text-xs font-semibold text-[var(--color-fg)] hover:border-brand-400 hover:text-brand-600 disabled:cursor-wait disabled:opacity-60"
    data-testid="story-model-load"
    :disabled="disabled || loading"
    :aria-label="loading ? 'Cargando IA' : 'Load IA'"
    title="Cargar el modelo de historias en LM Studio"
    :aria-busy="loading === true"
    @click="$emit('load')"
  >
    <svg v-if="loading" aria-hidden="true" class="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="9" class="opacity-25" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
    <svg v-else aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5M10 10h4v4h-4z" />
    </svg>
    <span :class="compactOnMobile ? 'hidden sm:inline' : ''">{{ loading ? 'Cargando…' : 'Load IA' }}</span>
  </button>
</template>
