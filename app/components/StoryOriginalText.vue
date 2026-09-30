<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <section
    data-testid="story-original-text"
    class="min-w-0 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-3 text-[var(--color-fg)] shadow-lg"
  >
    <h3 class="mb-2 text-xs font-semibold text-[var(--color-fg-muted)]">Texto original</h3>
    <pre class="max-h-64 overflow-y-auto font-sans text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{{ text }}</pre>
  </section>
</template>
