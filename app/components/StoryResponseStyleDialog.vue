<script setup lang="ts">
import type { ResponseStyleAmount } from '#shared/types'

const props = defineProps<{
  open: boolean
  dialogue: ResponseStyleAmount
  narration: ResponseStyleAmount
}>()

const emit = defineEmits<{
  close: []
  save: [value: { dialogue: ResponseStyleAmount; narration: ResponseStyleAmount }]
}>()

const bufferDialogue = ref<ResponseStyleAmount>('unspecified')
const bufferNarration = ref<ResponseStyleAmount>('unspecified')
const dialogElement = ref<HTMLFormElement | null>(null)
let previousFocus: HTMLElement | null = null

watch(() => props.open, async (open) => {
  if (!open) {
    previousFocus?.focus()
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  bufferDialogue.value = props.dialogue
  bufferNarration.value = props.narration
  await nextTick()
  dialogElement.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
})

useDialogEscape(
  () => props.open,
  () => emit('close')
)

function save() {
  emit('save', { dialogue: bufferDialogue.value, narration: bufferNarration.value })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
      @click.self="emit('close')"
    >
      <form
        ref="dialogElement"
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-response-style-title"
        class="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
        @submit.prevent="save"
      >
        <h2 id="story-response-style-title" class="text-lg font-bold">Estilo respuesta</h2>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Orienta el número de cuadros de cada respuesta. La escena puede omitir diálogo o narración.
        </p>

        <div class="mt-5 grid gap-5">
          <fieldset>
            <legend class="label">Diálogo</legend>
            <div class="grid gap-2">
              <label
                v-for="option in [
                { value: 'unspecified', label: 'Sin indicar' },
                { value: 'few', label: 'Pocas (1-2 cuadros)' },
                { value: 'many', label: 'Muchas (3 o más cuadros)' }
              ]"
                :key="option.value"
                class="flex items-center gap-3 rounded-xl border border-[var(--color-border-soft)] p-3 text-sm"
              >
                <input
                  v-model="bufferDialogue"
                  type="radio"
                  name="dialogue-style"
                  :value="option.value"
                  class="h-4 w-4 accent-[var(--color-brand-500)]"
                >
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend class="label">Narración</legend>
            <div class="grid gap-2">
              <label
                v-for="option in [
                { value: 'unspecified', label: 'Sin indicar' },
                { value: 'few', label: 'Poca (1-2 cuadros)' },
                { value: 'many', label: 'Mucha narración' }
              ]"
                :key="option.value"
                class="flex items-center gap-3 rounded-xl border border-[var(--color-border-soft)] p-3 text-sm"
              >
                <input
                  v-model="bufferNarration"
                  type="radio"
                  name="narration-style"
                  :value="option.value"
                  class="h-4 w-4 accent-[var(--color-brand-500)]"
                >
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="submit" class="btn-primary">Aplicar estilo</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
