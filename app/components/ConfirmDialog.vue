<script setup lang="ts">
const confirm = useConfirmStore()
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)

useDialogEscape(
  () => Boolean(confirm.dialog),
  () => confirm.respond(false)
)

watch(
  () => confirm.dialog,
  async (dialog) => {
    if (!dialog) return
    await nextTick()
    cancelButton.value?.focus()
  }
)

function trapFocus(event: KeyboardEvent) {
  const buttons = [cancelButton.value, confirmButton.value].filter(
    (button): button is HTMLButtonElement => Boolean(button)
  )
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.shiftKey
    ? (current - 1 + buttons.length) % buttons.length
    : (current + 1) % buttons.length
  buttons[next]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirm.dialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="confirm.respond(false)"
      @keydown.esc.stop.prevent="confirm.respond(false)"
      @keydown.tab.prevent="trapFocus"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        class="w-full max-w-md rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" class="text-lg font-bold">{{ confirm.dialog.title }}</h2>
        <p id="confirm-dialog-description" class="mt-2 text-sm text-[var(--color-fg-muted)]">
          {{ confirm.dialog.message }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button ref="cancelButton" type="button" class="btn-ghost" @click="confirm.respond(false)">
            Cancelar
          </button>
          <button ref="confirmButton" type="button" class="btn-danger" @click="confirm.respond(true)">
            {{ confirm.dialog.confirmLabel ?? 'Borrar' }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
