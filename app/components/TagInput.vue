<script setup lang="ts">
import { useId } from 'vue'
import { sanitizeTags, tagKey } from '~/lib/tags'

const props = defineProps<{
  id?: string
  modelValue: string[]
  placeholder?: string
  ariaLabel?: string
  suggestions?: string[]
  showAllSuggestions?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const draft = ref('')
const suggestionsOpen = ref(false)
const activeSuggestion = ref(-1)
const listboxId = `tag-suggestions-${useId()}`

const suggestionBadges = computed(() =>
  sanitizeTags([...(props.suggestions ?? []), ...props.modelValue]).sort((left, right) =>
    left.localeCompare(right, 'es', { sensitivity: 'base' })
  )
)

const filteredSuggestions = computed(() => {
  const query = tagKey(draft.value)
  const selected = new Set(props.modelValue.map(tagKey))
  return sanitizeTags(props.suggestions ?? [])
    .filter((tag) => !selected.has(tagKey(tag)) && (!query || tagKey(tag).includes(query)))
    .slice(0, 8)
})

const showSuggestions = computed(
  () =>
    !props.showAllSuggestions &&
    suggestionsOpen.value &&
    filteredSuggestions.value.length > 0
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

function isSelected(tag: string) {
  const key = tagKey(tag)
  return props.modelValue.some((item) => tagKey(item) === key)
}

function toggleSuggestion(tag: string) {
  if (isSelected(tag)) {
    remove(tag)
    return
  }
  selectSuggestion(tag)
}

function onKeydown(event: KeyboardEvent) {
  if (!props.showAllSuggestions && event.key === 'ArrowDown' && filteredSuggestions.value.length) {
    event.preventDefault()
    suggestionsOpen.value = true
    activeSuggestion.value = (activeSuggestion.value + 1) % filteredSuggestions.value.length
    return
  }
  if (!props.showAllSuggestions && event.key === 'ArrowUp' && filteredSuggestions.value.length) {
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
      :role="showAllSuggestions ? undefined : 'combobox'"
      :aria-autocomplete="showAllSuggestions ? undefined : 'list'"
      :aria-expanded="showAllSuggestions ? undefined : showSuggestions"
      :aria-controls="showAllSuggestions ? undefined : listboxId"
      :aria-activedescendant="!showAllSuggestions && activeSuggestion >= 0 ? `${listboxId}-${activeSuggestion}` : undefined"
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
  <div
    v-if="showAllSuggestions && suggestionBadges.length"
    class="mt-2 flex min-w-0 flex-wrap gap-1.5"
    role="group"
    aria-label="Etiquetas disponibles"
  >
    <button
      v-for="suggestion in suggestionBadges"
      :key="tagKey(suggestion)"
      type="button"
      :aria-pressed="isSelected(suggestion)"
      class="inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
      :class="isSelected(suggestion)
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-[var(--color-border-soft)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:bg-brand-500/10'"
      @click="toggleSuggestion(suggestion)"
    >
      <span class="truncate">{{ suggestion }}</span>
    </button>
  </div>
</template>
