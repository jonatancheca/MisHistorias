<script setup lang="ts">
defineProps<{ loading?: boolean; disabled?: boolean }>()
defineEmits<{ load: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex h-8 w-20 shrink-0 items-center justify-center rounded-lg text-xs hover:bg-brand-500/10 hover:text-brand-600 disabled:cursor-wait disabled:opacity-60"
    data-testid="story-model-load"
    :disabled="disabled || loading"
    :aria-label="loading ? 'Cargando IA' : 'load IA'"
    title="Cargar el modelo de historias en LM Studio"
    :aria-busy="loading === true"
    @click="$emit('load')"
  >{{ loading ? 'Cargando…' : 'load IA' }}</button>
</template>
