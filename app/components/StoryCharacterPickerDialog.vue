<script setup lang="ts">
interface PickerCharacter {
  id: string
  label: string
  prompt: string
  tags: string[]
  archived: boolean
  customized: boolean
}

const props = defineProps<{
  open: boolean
  characters: PickerCharacter[]
}>()

const emit = defineEmits<{
  close: []
  select: [characterId: string]
  forget: [characterId: string]
}>()

const mobilePromptCharacterId = ref<string | null>(null)
const promptIdPrefix = useId()

function promptDescriptionId(characterId: string, target: 'tooltip' | 'panel') {
  return `${promptIdPrefix}-${characterId}-${target}`
}

function toggleMobilePrompt(characterId: string) {
  mobilePromptCharacterId.value = mobilePromptCharacterId.value === characterId ? null : characterId
}

watch(() => props.open, (open) => {
  if (!open) mobilePromptCharacterId.value = null
})

useDialogEscape(
  () => props.open,
  () => emit('close')
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="story-character-picker-title"
      @click.self="emit('close')"
    >
      <section class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header class="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-4 py-3">
          <div class="min-w-0">
            <h2 id="story-character-picker-title" class="font-semibold">Añadir personaje</h2>
            <p class="text-xs text-[var(--color-fg-muted)]">Elige un personaje disponible para el elenco.</p>
          </div>
          <button type="button" class="btn-ghost h-9 w-9 shrink-0 px-0 py-0" aria-label="Cerrar galería de personajes" @click="emit('close')">×</button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <p v-if="!characters.length" class="empty-state rounded-xl border border-[var(--color-border-soft)] p-6 text-sm text-[var(--color-fg-muted)]">
            No quedan personajes disponibles.
          </p>
          <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <article
              v-for="character in characters"
              :key="character.id"
              class="story-character-picker-card relative grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] p-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
              data-testid="story-character-picker-card"
              tabindex="0"
              :aria-describedby="character.prompt.trim() ? promptDescriptionId(character.id, 'tooltip') : undefined"
            >
              <header class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-semibold">{{ character.label }}</span>
                <button
                  v-if="character.prompt.trim()"
                  type="button"
                  class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-border-soft)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500 sm:hidden"
                  :aria-label="`${mobilePromptCharacterId === character.id ? 'Ocultar' : 'Mostrar'} prompt de ${character.label}`"
                  :aria-controls="promptDescriptionId(character.id, 'panel')"
                  :aria-expanded="mobilePromptCharacterId === character.id"
                  data-testid="character-prompt-toggle"
                  @click="toggleMobilePrompt(character.id)"
                >
                  <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v6M12 7h.01" />
                  </svg>
                </button>
                <CharacterTagsTooltip :tags="character.tags" :label="character.label" />
              </header>
              <p
                v-if="character.prompt.trim() && mobilePromptCharacterId === character.id"
                :id="promptDescriptionId(character.id, 'panel')"
                class="whitespace-pre-wrap break-words rounded-lg bg-brand-500/10 p-3 text-sm text-[var(--color-fg-muted)] sm:hidden"
                data-testid="character-mobile-prompt"
              >
                {{ character.prompt }}
              </p>
              <div class="flex min-w-0 gap-2">
                <CharacterImageCarousel
                  :character-id="character.id"
                  :alt="character.label"
                  class="h-64 min-w-0 flex-1 sm:h-72"
                />
                <div class="flex w-10 shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    class="btn-primary h-10 w-10 px-0"
                    :aria-label="`Añadir ${character.label} al elenco`"
                    title="Añadir al elenco"
                    @click="emit('select', character.id)"
                  >
                    <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </button>
                  <button
                    v-if="character.customized"
                    type="button"
                    class="btn-ghost h-10 w-10 px-0 text-red-500"
                    :aria-label="`Olvidar personalización de ${character.label}`"
                    title="Olvidar personalización"
                    @click="emit('forget', character.id)"
                  >
                    <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18m-4 0v-2H7v2m2 5v6m6-6v6M5 6l1 15h12l1-15" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="flex flex-wrap gap-1 text-[0.68rem] text-[var(--color-fg-muted)]">
                <span v-if="character.archived" class="rounded-full border border-[var(--color-border-soft)] px-1.5 py-0.5">Archivado</span>
                <span v-if="character.customized" class="rounded-full border border-[var(--color-border-soft)] px-1.5 py-0.5">Personalización guardada</span>
              </div>
              <p
                v-if="character.prompt.trim()"
                :id="promptDescriptionId(character.id, 'tooltip')"
                role="tooltip"
                class="character-prompt-tooltip pointer-events-none invisible absolute top-12 right-3 left-3 z-30 hidden whitespace-pre-wrap break-words rounded-xl bg-slate-950 px-3 py-2 text-sm leading-snug text-white opacity-0 shadow-xl transition sm:block"
                data-testid="story-character-prompt-tooltip"
              >
                {{ character.prompt }}
              </p>
            </article>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.story-character-picker-card:hover .character-prompt-tooltip,
.story-character-picker-card:focus-within .character-prompt-tooltip {
  visibility: visible;
  opacity: 1;
}
</style>
