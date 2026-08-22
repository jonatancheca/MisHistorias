<script setup lang="ts">
/** Los tres gestos de intereses: predominante (estrella), excluir (tachado), si encaja (onda). */
withDefaults(
  defineProps<{
    kind: 'primary' | 'excluded' | 'contextual'
    filled?: boolean
    size?: number
  }>(),
  { filled: false, size: 15 }
)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="kind === 'primary' && filled ? 'currentColor' : 'none'"
    :stroke="kind === 'primary' && filled ? 'none' : 'currentColor'"
    stroke-width="1.6"
    stroke-linejoin="round"
    stroke-linecap="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-if="kind === 'primary'" d="m12 4.6 2.2 4.9 5.3.5-4 3.6 1.2 5.2-4.7-2.7-4.7 2.7 1.2-5.2-4-3.6 5.3-.5Z" />
    <template v-else-if="kind === 'excluded'">
      <circle cx="12" cy="12" r="7.6" />
      <path d="M6.8 17.2 17.2 6.8" />
    </template>
    <path v-else d="M4 14.2c2.3-4.5 4.7-4.5 7 0s4.7 4.5 7 0" />
  </svg>
</template>
