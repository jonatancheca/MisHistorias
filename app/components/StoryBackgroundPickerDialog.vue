<script setup lang="ts">
import { primaryTag } from '~/lib/tags'

const props = defineProps<{
  open: boolean
  backgroundIds: string[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  close: []
  select: [backgroundId: string | null]
}>()

const backgrounds = useBackgroundsStore()
const availableBackgrounds = computed(() => props.backgroundIds.flatMap((id) => {
  const background = backgrounds.byId(id)
  return background ? [background] : []
}))

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
      aria-labelledby="story-background-picker-title"
      @click.self="emit('close')"
    >
      <section class="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
        <header class="flex items-center justify-between border-b border-[var(--color-border-soft)] px-4 py-3">
          <div>
            <h2 id="story-background-picker-title" class="font-semibold">Seleccionar fondo inicial</h2>
            <p class="text-xs text-[var(--color-fg-muted)]">La selección se aplica al pulsarla.</p>
          </div>
          <button type="button" class="btn-ghost h-9 w-9 px-0 py-0" aria-label="Cerrar selector de fondo" @click="emit('close')">×</button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              class="rounded-xl border-2 p-3 text-left transition"
              :class="selectedId === null ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)] hover:border-brand-400'"
              aria-label="Que decida el LLM"
              :aria-pressed="selectedId === null"
              @click="emit('select', null)"
            >
              <span class="block font-medium">Que decida el LLM</span>
              <span class="block text-xs text-[var(--color-fg-muted)]">Elegirá un fondo al abrir la escena.</span>
            </button>

            <button
              v-for="background in availableBackgrounds"
              :key="background.id"
              type="button"
              class="flex items-center gap-3 rounded-xl border-2 p-3 text-left transition"
              :class="selectedId === background.id ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)] hover:border-brand-400'"
              :aria-label="`Elegir fondo ${primaryTag(background)}`"
              :aria-pressed="selectedId === background.id"
              @click="emit('select', background.id)"
            >
              <img :src="backgrounds.urlFor(background.id)!" alt="" class="h-16 w-24 shrink-0 rounded-lg object-contain">
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ primaryTag(background) }}</span>
                <span v-if="background.style" class="block truncate text-xs font-medium text-brand-600">
                  {{ background.style }}
                </span>
                <span class="line-clamp-2 block text-xs text-[var(--color-fg-muted)]">
                  {{ background.description || 'Sin descripción' }}
                </span>
              </span>
            </button>
          </div>

          <p v-if="!availableBackgrounds.length" class="mt-3 text-sm text-[var(--color-fg-muted)]">
            No hay fondos disponibles. El LLM decidirá el fondo inicial.
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>
