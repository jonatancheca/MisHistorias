<script setup lang="ts">
import { sanitizeTags, tagKey } from '~/lib/tags'

const props = defineProps<{
  id?: string
  modelValue: string[]
  placeholder?: string
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const draft = ref('')

function commitDraft() {
  const additions = draft.value.split(',')
  const next = sanitizeTags([...props.modelValue, ...additions])
  draft.value = ''
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault()
    commitDraft()
    return
  }
  if (event.key === 'Backspace' && !draft.value && props.modelValue.length) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

function remove(tag: string) {
  const key = tagKey(tag)
  emit('update:modelValue', props.modelValue.filter((item) => tagKey(item) !== key))
}
</script>

<template>
  <div class="field flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
    <span
      v-for="tag in modelValue"
      :key="tagKey(tag)"
      class="inline-flex max-w-full items-center gap-1 rounded-full bg-brand-500/15 px-2 py-1 text-xs"
    >
      <span class="truncate">{{ tag }}</span>
      <button
        type="button"
        class="shrink-0 rounded-full px-0.5 text-[var(--color-fg-muted)] hover:text-red-500"
        :aria-label="`Quitar etiqueta ${tag}`"
        @click="remove(tag)"
      >
        ×
      </button>
    </span>
    <input
      :id="id"
      v-model="draft"
      type="text"
      class="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-fg-muted)]"
      :placeholder="modelValue.length ? '' : placeholder"
      :aria-label="ariaLabel"
      @keydown="onKeydown"
      @blur="commitDraft"
    >
  </div>
</template>
