<script setup lang="ts">
interface PickerCharacter {
  id: string
  label: string
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
              class="grid min-w-0 gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-elevated)] p-3"
              data-testid="story-character-picker-card"
            >
              <header class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 flex-1 truncate font-semibold">{{ character.label }}</span>
                <CharacterTagsTooltip :tags="character.tags" :label="character.label" />
              </header>
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
            </article>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
