<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean; placement?: 'top' | 'bottom' }>(), {
  placement: 'bottom'
})

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panelId = useId()

function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function onOutside(event: Event) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close()
}

function onAction(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button')) close(true)
}

function onEscape(event: KeyboardEvent) {
  if (!open.value) return
  event.stopPropagation()
  event.preventDefault()
  close(true)
}

onMounted(() => {
  document.addEventListener('pointerdown', onOutside)
  document.addEventListener('focusin', onOutside)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside)
  document.removeEventListener('focusin', onOutside)
})
</script>

<template>
  <div ref="root" class="relative shrink-0" @keydown.esc="onEscape">
    <button
      ref="trigger"
      type="button"
      class="btn-ghost min-h-11 gap-2 px-3"
      data-testid="story-tools-toggle"
      :aria-controls="panelId"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
      </svg>
      Más opciones
      <span v-if="active" class="h-2 w-2 rounded-full bg-violet-500" aria-label="Debug activo" />
    </button>
    <div
      v-show="open"
      :id="panelId"
      class="story-tools-panel absolute right-0 z-40 grid max-h-[min(28rem,60dvh)] w-72 max-w-[calc(100vw-2rem)] gap-1 overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-2 shadow-xl"
      :class="placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'"
      data-testid="story-tools-panel"
      @click="onAction"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.story-tools-panel :deep(button) {
  min-height: 48px;
  width: 100%;
  justify-content: flex-start;
  border: 0;
  box-shadow: none;
  background-color: transparent;
  padding: 0.75rem;
  text-align: left;
  transform: none;
}

.story-tools-panel :deep(button:hover),
.story-tools-panel :deep(button[aria-pressed='true']) {
  background-color: var(--color-surface-alt);
}
</style>
