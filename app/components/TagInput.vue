<script setup lang="ts">
import { useId } from 'vue'
import { sanitizeTags, tagKey } from '~/lib/tags'

const props = defineProps<{
  id?: string
  modelValue: string[]
  placeholder?: string
  ariaLabel?: string
  suggestions?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const draft = ref('')
const suggestionsOpen = ref(false)
const activeSuggestion = ref(-1)
const listboxId = `tag-suggestions-${useId()}`

const filteredSuggestions = computed(() => {
  const query = tagKey(draft.value)
  const selected = new Set(props.modelValue.map(tagKey))
  return sanitizeTags(props.suggestions ?? [])
    .filter((tag) => !selected.has(tagKey(tag)) && (!query || tagKey(tag).includes(query)))
    .slice(0, 8)
})

const showSuggestions = computed(
  () => suggestionsOpen.value && filteredSuggestions.value.length > 0
)

watch(filteredSuggestions, (suggestions) => {
  if (activeSuggestion.value >= suggestions.length) activeSuggestion.value = -1
})

function commitDraft() {
  const additions = draft.value.split(',')
  const next = sanitizeTags([...props.modelValue, ...additions])
  draft.value = ''
  suggestionsOpen.value = false
  activeSuggestion.value = -1
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function selectSuggestion(tag: string) {
  const next = sanitizeTags([...props.modelValue, tag])
  draft.value = ''
  suggestionsOpen.value = false
  activeSuggestion.value = -1
  if (next.length !== props.modelValue.length) emit('update:modelValue', next)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' && filteredSuggestions.value.length) {
    event.preventDefault()
    suggestionsOpen.value = true
    activeSuggestion.value = (activeSuggestion.value + 1) % filteredSuggestions.value.length
    return
  }
  if (event.key === 'ArrowUp' && filteredSuggestions.value.length) {
    event.preventDefault()
    suggestionsOpen.value = true
    activeSuggestion.value =
      activeSuggestion.value <= 0
        ? filteredSuggestions.value.length - 1
        : activeSuggestion.value - 1
    return
  }
  if (
    (event.key === 'Enter' || event.key === 'Tab') &&
    activeSuggestion.value >= 0 &&
    filteredSuggestions.value[activeSuggestion.value]
  ) {
    if (event.key === 'Enter') event.preventDefault()
    selectSuggestion(filteredSuggestions.value[activeSuggestion.value]!)
    return
  }
  if (event.key === 'Escape') {
    suggestionsOpen.value = false
    activeSuggestion.value = -1
    return
  }
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
  <div class="field relative flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
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
      autocomplete="off"
      class="min-w-24 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-fg-muted)]"
      :placeholder="modelValue.length ? '' : placeholder"
      :aria-label="ariaLabel"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="showSuggestions"
      :aria-controls="listboxId"
      :aria-activedescendant="activeSuggestion >= 0 ? `${listboxId}-${activeSuggestion}` : undefined"
      @input="suggestionsOpen = true; activeSuggestion = -1"
      @focus="suggestionsOpen = true"
      @keydown="onKeydown"
      @blur="commitDraft"
    >
    <ul
      v-if="showSuggestions"
      :id="listboxId"
      role="listbox"
      class="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-1 shadow-lg"
    >
      <li v-for="(suggestion, index) in filteredSuggestions" :key="tagKey(suggestion)">
        <button
          :id="`${listboxId}-${index}`"
          type="button"
          role="option"
          :aria-selected="index === activeSuggestion"
          class="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-brand-500/15"
          :class="{ 'bg-brand-500/15': index === activeSuggestion }"
          @mousedown.prevent
          @click="selectSuggestion(suggestion)"
        >
          {{ suggestion }}
        </button>
      </li>
    </ul>
  </div>
</template>
