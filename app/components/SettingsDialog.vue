<script setup lang="ts">
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  titleId: string
  size?: 'medium' | 'wide'
  busy?: boolean
}>(), {
  size: 'medium',
  busy: false
})

const emit = defineEmits<{
  close: []
}>()

const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null

function requestClose() {
  if (!props.busy) emit('close')
}

function focusableElements() {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  ) ?? []).filter(element => !element.hasAttribute('inert'))
}

function trapFocus(event: KeyboardEvent) {
  const focusable = focusableElements()
  if (!focusable.length) return
  const current = focusable.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? (current - 1 + focusable.length) % focusable.length
    : (current + 1) % focusable.length
  focusable[next]?.focus()
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      await nextTick()
      const preferred = panel.value?.querySelector<HTMLElement>('[data-dialog-autofocus]:not([disabled])')
      const target = preferred ?? closeButton.value
      target?.focus()
      return
    }
    if (previousFocus?.isConnected) previousFocus.focus()
    previousFocus = null
  }
)

useDialogEscape(
  () => props.open,
  requestClose,
  () => !props.busy
)
</script>

<template>
  <Teleport to="body">
    <div
      v-show="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4"
      @click.self="requestClose"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl"
        :class="size === 'wide' ? 'max-w-4xl' : 'max-w-3xl'"
      >
        <header class="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-border-soft)] p-4 sm:p-5">
          <h2 :id="titleId" class="text-lg font-bold">{{ title }}</h2>
          <button
            ref="closeButton"
            type="button"
            class="btn-ghost shrink-0"
            :disabled="busy"
            aria-label="Cerrar diálogo"
            @click="requestClose"
          >
            Cerrar
          </button>
        </header>
        <div class="min-h-0 overflow-y-auto p-4 sm:p-5">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>
