<script setup lang="ts">
import type { StoryCharacterCustomization } from '#shared/types'

const props = defineProps<{
  customization: StoryCharacterCustomization | null
  originalName: string
  idPrefix: string
  suggestions: string[]
}>()

const emit = defineEmits<{
  close: []
  save: [customization: StoryCharacterCustomization]
}>()

const buffer = ref<StoryCharacterCustomization | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
let previousFocus: HTMLElement | null = null

const title = computed(() => {
  const name = buffer.value?.name.trim() || props.originalName || 'personaje'
  return `Editar ${name}`
})

watch(() => props.customization, async (customization) => {
  if (!customization) {
    previousFocus?.focus()
    buffer.value = null
    return
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  buffer.value = { ...customization, tags: [...customization.tags] }
  await nextTick()
  nameInput.value?.focus()
}, { immediate: true })

useDialogEscape(
  () => Boolean(props.customization),
  () => emit('close')
)

function save() {
  if (!buffer.value?.name.trim()) return
  emit('save', {
    ...buffer.value,
    name: buffer.value.name.trim(),
    tags: [...buffer.value.tags]
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="customization && buffer"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
      @click.self="emit('close')"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="story-character-edit-title"
        class="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
        @submit.prevent="save"
      >
        <h2 id="story-character-edit-title" class="text-lg font-bold">{{ title }}</h2>
        <p v-if="originalName && originalName !== buffer.name" class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Personaje global: {{ originalName }}
        </p>

        <div class="mt-4 grid gap-4">
          <div>
            <label class="label" :for="`${idPrefix}-name-${buffer.characterId}`">Nombre en esta historia</label>
            <input
              :id="`${idPrefix}-name-${buffer.characterId}`"
              ref="nameInput"
              v-model="buffer.name"
              autocomplete="off"
              class="field"
              required
            >
          </div>

          <div>
            <label class="label" :for="`${idPrefix}-color-${buffer.characterId}`">Color del texto</label>
            <CharacterColorPicker
              :id="`${idPrefix}-color-${buffer.characterId}`"
              v-model="buffer.color!"
            />
          </div>

          <div>
            <label class="label" :for="`${idPrefix}-prompt-${buffer.characterId}`">Prompt</label>
            <textarea
              :id="`${idPrefix}-prompt-${buffer.characterId}`"
              v-model="buffer.prompt"
              autocomplete="off"
              class="field min-h-32"
            />
          </div>

          <div>
            <label class="label" :for="`${idPrefix}-tags-${buffer.characterId}`">Etiquetas descriptivas</label>
            <TagInput
              :id="`${idPrefix}-tags-${buffer.characterId}`"
              v-model="buffer.tags"
              :suggestions="suggestions"
              show-all-suggestions
              placeholder="aventurera"
            />
          </div>
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" class="btn-ghost" @click="emit('close')">Cancelar</button>
          <button type="submit" class="btn-primary" :disabled="!buffer.name.trim()">Guardar personaje</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
