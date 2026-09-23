<script setup lang="ts">
import type { ImageGenerationMetadata } from '#shared/types'
import { tagKey } from '~/lib/tags'

interface GenerationImageItem {
  id: string
  src: string
  alt: string
  downloadName: string
  tags: string[]
  generation?: ImageGenerationMetadata
}

const props = defineProps<{
  completed: number
  total: number
  currentPrompt: string
  images: GenerationImageItem[]
  selectedImageId: string | null
  tagSuggestions: string[]
  running: boolean
  cancelling: boolean
  resultMessage: string | null
  resultError: string | null
}>()

const emit = defineEmits<{
  cancel: []
  close: []
  select: [id: string]
  updateTags: [id: string, tags: string[]]
  delete: [id: string]
  tagEditStart: []
  tagEditEnd: []
}>()
const primaryButton = ref<HTMLButtonElement | null>(null)
const selectedIndex = computed(() => Math.max(0, props.images.findIndex(
  (image) => image.id === props.selectedImageId
)))
const selectedImage = computed(() => props.images[selectedIndex.value] ?? null)
const visibleTags = (tags: string[]) => tags.filter((tag) => tagKey(tag) !== 'neutral')

useDialogEscape(() => true, () => {
  if (props.running) emit('cancel')
  else emit('close')
})

onMounted(() => {
  primaryButton.value?.focus()
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

function move(offset: number) {
  const next = props.images[selectedIndex.value + offset]
  if (next) emit('select', next.id)
}

function onKeydown(event: KeyboardEvent) {
  if (document.querySelector('[role="alertdialog"]') ||
    document.querySelectorAll('[role="dialog"]').length > 1) return
  if (event.target instanceof HTMLElement &&
    event.target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    move(event.key === 'ArrowLeft' ? -1 : 1)
  }
}

function trapFocus(event: KeyboardEvent) {
  const dialog = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('[role="dialog"]')
  const controls = Array.from(dialog?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'
  ) ?? [])
  if (!controls.length) return
  const index = controls.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && index <= 0) {
    event.preventDefault()
    controls[controls.length - 1]?.focus()
  } else if (!event.shiftKey && index === controls.length - 1) {
    event.preventDefault()
    controls[0]?.focus()
  }
}

function onTagFocusOut(event: FocusEvent) {
  const wrapper = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget)) return
  if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest(
    '[data-testid="generation-image-delete"], [aria-label="Imagen anterior"], [aria-label="Imagen siguiente"]'
  )) return
  emit('tagEditEnd')
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6"
      @keydown.tab="trapFocus"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-generation-progress-title"
        class="flex max-h-[96vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[var(--color-surface)] shadow-2xl"
        data-testid="image-generation-progress-dialog"
      >
        <header class="border-b border-[var(--color-border-soft)] px-4 py-3">
          <h2 id="image-generation-progress-title" class="text-lg font-bold">
            {{ running ? 'Generando imágenes' : 'Imágenes generadas' }}
          </h2>
          <p role="status" class="text-sm text-[var(--color-fg-muted)]">
            Imagen {{ completed }} de {{ total }} completadas.
          </p>
        </header>

        <div class="grid min-h-0 gap-4 overflow-y-auto p-4">
          <div>
            <div class="mb-1 flex items-center justify-between gap-3 text-sm">
              <span>Prompt actual</span>
              <span>{{ Math.min(completed + 1, total) }} / {{ total }}</span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-brand-500/15"
              role="progressbar"
              aria-label="Progreso de generación"
              :aria-valuenow="completed"
              aria-valuemin="0"
              :aria-valuemax="total"
            >
              <div
                class="h-full rounded-full bg-brand-500 transition-[width]"
                :style="{ width: `${total ? (completed / total) * 100 : 0}%` }"
              />
            </div>
            <p class="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
              {{ currentPrompt }}
            </p>
          </div>

          <div v-if="selectedImage" class="grid min-w-0 gap-2">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Imagen {{ selectedIndex + 1 }} de {{ images.length }} del lote</h3>
              <span class="text-xs text-[var(--color-fg-muted)]">Pulsa para ampliar</span>
            </div>
            <div class="flex min-w-0 items-center gap-2">
              <button
                type="button"
                class="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Imagen anterior"
                :disabled="selectedIndex === 0"
                @click="move(-1)"
              >‹</button>
              <ImageLightbox
                :src="selectedImage.src"
                :alt="selectedImage.alt"
                :active-item-id="selectedImage.id"
                :gallery-items="images"
                :download-name="selectedImage.downloadName"
                navigation-mode="bounded"
                deletable
                container-class="min-w-0 flex-1"
                button-class="flex min-h-32 items-center justify-center overflow-hidden rounded-xl bg-black/10 p-2 dark:bg-white/10"
                image-class="max-h-80 max-w-full object-contain"
                @active-change="(item) => { if (item.id) emit('select', item.id) }"
                @delete="(item) => { if (item.id) emit('delete', item.id) }"
              >
                <template #details="{ item, showGenerationMetadata }">
                  <div v-if="item.id" class="grid gap-3">
                    <div>
                      <h3 class="font-semibold">Etiquetas de la imagen</h3>
                      <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
                        Pulsa una disponible o escribe una nueva.
                      </p>
                    </div>
                    <div @focusin="emit('tagEditStart')" @focusout="onTagFocusOut">
                      <TagInput
                        :model-value="visibleTags(item.tags ?? [])"
                        :suggestions="tagSuggestions"
                        show-all-suggestions
                        aria-label="Nueva etiqueta de imagen visualizada"
                        placeholder="Nueva etiqueta"
                        @update:model-value="emit('updateTags', item.id, $event)"
                      />
                    </div>
                    <ImageGenerationMetadataPanel
                      v-if="item.generation && showGenerationMetadata"
                      :generation="item.generation"
                    />
                    <button
                      type="button"
                      class="btn-danger justify-self-start"
                      data-testid="generation-image-delete"
                      @click="emit('delete', item.id)"
                    >
                      Borrar
                    </button>
                  </div>
                </template>
              </ImageLightbox>
              <button
                type="button"
                class="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Imagen siguiente"
                :disabled="selectedIndex >= images.length - 1"
                @click="move(1)"
              >›</button>
            </div>
          </div>
          <p v-else class="text-sm text-[var(--color-fg-muted)]">
            {{ completed ? 'No quedan imágenes guardadas de este lote.' : 'Todavía no hay imágenes generadas.' }}
          </p>
          <p v-if="resultError" class="text-sm text-red-500" role="alert">{{ resultError }}</p>
          <p v-else-if="resultMessage" class="text-sm text-green-600" role="status">{{ resultMessage }}</p>
        </div>

        <footer class="flex justify-end border-t border-[var(--color-border-soft)] p-3">
          <button
            ref="primaryButton"
            type="button"
            :class="running ? 'btn-danger' : 'btn-primary'"
            :disabled="cancelling"
            @click="running ? emit('cancel') : emit('close')"
          >
            {{ running ? (cancelling ? 'Cancelando…' : 'Cancelar generación') : 'Cerrar' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
