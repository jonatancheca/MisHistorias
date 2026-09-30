<script setup lang="ts">
defineProps<{
  expanded: boolean
  controls: string
}>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
    :class="expanded ? 'bg-brand-500/15 text-brand-500' : ''"
    data-testid="story-original-toggle"
    :aria-label="expanded ? 'Ocultar texto original' : 'Mostrar texto original'"
    :title="expanded ? 'Ocultar texto original' : 'Mostrar texto original'"
    :aria-pressed="expanded"
    :aria-controls="controls"
    @click="emit('toggle')"
  >
    <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      <path v-if="expanded" d="m3 3 18 18" />
    </svg>
  </button>
</template>
