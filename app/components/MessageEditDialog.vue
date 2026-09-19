<script setup lang="ts">
import type { Message } from '#shared/types'

const props = defineProps<{ message: Message | null; disabled?: boolean }>()
const emit = defineEmits<{ close: []; save: [id: string, raw: string] }>()
const buffer = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null

useDialogEscape(
  () => Boolean(props.message),
  () => emit('close')
)

watch(() => props.message, async (message) => {
  if (!message) {
    previousFocus?.focus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  buffer.value = message.raw
  await nextTick()
  textarea.value?.focus()
})

function save() {
  if (!props.message || props.disabled) return
  emit('save', props.message.id, buffer.value)
}

function onSaveShortcut(event: KeyboardEvent) {
  if (event.repeat || event.isComposing) return
  event.preventDefault()
  save()
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="message"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      @click.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
      @keydown.stop
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-edit-title"
        class="w-full max-w-2xl rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
        @submit.prevent="save"
      >
        <h2 id="message-edit-title" class="mb-3 text-lg font-bold">Editar mensaje</h2>
        <label class="label" for="message-edit-text">Texto completo del mensaje</label>
        <textarea
          id="message-edit-text"
          ref="textarea"
          v-model="buffer"
          autocomplete="off"
          class="field min-h-40 max-h-[60dvh] resize-y"
          :disabled="disabled"
          @keydown.ctrl.enter.exact="onSaveShortcut"
          @keydown.shift.tab.prevent="cancelButton?.focus()"
        />
        <div class="mt-3 flex justify-end gap-2">
          <button
            type="submit"
            class="btn-primary gap-2"
            :disabled="disabled"
            aria-keyshortcuts="Control+Enter"
            title="Guardar (Ctrl+Enter)"
          >
            <span>Guardar</span>
            <kbd
              aria-hidden="true"
              class="rounded border border-white/30 px-1.5 py-0.5 text-[11px] font-medium leading-none"
            >Ctrl+Enter</kbd>
          </button>
          <button
            ref="cancelButton"
            type="button"
            class="btn-ghost"
            @click="emit('close')"
            @keydown.tab.exact.prevent="textarea?.focus()"
          >Cancelar</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
