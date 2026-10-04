<script setup lang="ts">
defineProps<{ visualMode: boolean }>()
</script>

<template>
  <div
    data-testid="story-notices"
    class="story-notices"
    :class="{ 'story-notices-visual': visualMode }"
  >
    <slot />
  </div>
</template>

<style scoped>
.story-notices {
  --notice-bottom: 1rem;
  position: absolute;
  inset: auto 0.75rem var(--notice-bottom);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  max-height: calc(100% - var(--notice-bottom) - 1rem);
  overflow-y: auto;
  pointer-events: none;
}

.story-notices-visual {
  /* El diálogo y las acciones de la escena conservan su espacio. */
  --notice-bottom: calc(6rem + 5rem);
}

.story-notices :deep(.story-notice) {
  flex: none;
  min-width: 0;
  max-width: min(100%, 40rem);
  margin: 0;
  padding: 0.5rem 1rem;
  border: 1px solid rgb(255 255 255 / 25%);
  border-radius: 1rem;
  background: rgb(2 6 23 / 92%);
  color: white;
  box-shadow: 0 4px 12px rgb(0 0 0 / 20%);
  overflow-wrap: anywhere;
  pointer-events: auto;
}

.story-notices :deep(.story-notice-error) {
  border-color: #f87171;
  color: #fecaca;
}

.story-notices :deep(.story-notice-warning) {
  border-color: #fbbf24;
  color: #fde68a;
}

@media (min-width: 640px) {
  .story-notices-visual {
    --notice-bottom: calc(120px + 5rem);
  }
}
</style>
