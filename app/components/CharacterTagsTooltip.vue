<script setup lang="ts">
defineProps<{
  tags: string[]
  label: string
}>()

const mobileOpen = ref(false)
const mobilePanelId = useId()
</script>

<template>
  <template v-if="tags.length">
    <span class="relative z-20 shrink-0">
      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500 sm:hidden"
        :aria-label="`${mobileOpen ? 'Ocultar' : 'Mostrar'} etiquetas de ${label}: ${tags.join(', ')}`"
        :aria-controls="mobilePanelId"
        :aria-expanded="mobileOpen"
        data-testid="character-tags-toggle"
        @click="mobileOpen = !mobileOpen"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.6 13.6 11 23l-9-9V3h11z" />
          <circle cx="7.5" cy="8.5" r="1.5" />
        </svg>
      </button>
      <span class="group relative hidden sm:inline-flex">
        <span
          class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500"
          tabindex="0"
          :aria-label="`Etiquetas de ${label}: ${tags.join(', ')}`"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.6 13.6 11 23l-9-9V3h11z" />
            <circle cx="7.5" cy="8.5" r="1.5" />
          </svg>
        </span>
        <span
          role="tooltip"
          class="pointer-events-none absolute top-full right-0 z-30 mt-2 hidden w-max max-w-64 flex-wrap gap-1 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] p-2 text-xs shadow-xl group-hover:flex group-focus-within:flex"
        >
          <span
            v-for="tag in tags"
            :key="tag"
            class="max-w-full rounded-full bg-brand-500/15 px-2 py-0.5"
          >{{ tag }}</span>
        </span>
      </span>
    </span>
    <span
      v-if="mobileOpen"
      :id="mobilePanelId"
      class="relative z-20 col-span-full flex min-w-0 flex-wrap gap-1.5 sm:hidden"
      data-testid="character-mobile-tags"
    >
      <span
        v-for="tag in tags"
        :key="tag"
        class="max-w-full break-words rounded-full bg-brand-500/15 px-2 py-0.5 text-xs"
      >{{ tag }}</span>
    </span>
  </template>
</template>
