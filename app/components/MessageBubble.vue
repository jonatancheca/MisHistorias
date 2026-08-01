<script setup lang="ts">
import type { Message } from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'

const props = defineProps<{ message: Message; editable?: boolean }>()
const emit = defineEmits<{ edit: [string]; remove: []; regenerate: [] }>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const settings = useSettingsStore()
const editing = ref(false)
const buffer = ref('')

const userName = computed(() => settings.settings.userName?.trim() || 'Protagonista')
const userColor = computed(() => normalizeColor(settings.settings.userColor, DEFAULT_USER_COLOR))

interface FlowRow {
  key: string
  background: boolean
  narration: boolean
  text: string
  name: string
  color: string
  tag: string | null
  imageUrl: string | null
}

/**
 * Convierte los segmentos en un flujo narrativo. La imagen solo se inserta
 * cuando cambia respecto a la anterior mostrada, para no repetirla en cada línea.
 */
const rows = computed<FlowRow[]>(() => {
  let lastImageId = ''
  return props.message.segments.map((segment, index) => {
    if (segment.type === 'background') {
      const background = Object.prototype.hasOwnProperty.call(segment, 'backgroundId')
        ? backgrounds.byId(segment.backgroundId)
        : backgrounds.byTag(segment.tag)
      return {
        key: String(index),
        background: true,
        narration: false,
        text: segment.text,
        name: 'Fondo',
        color: '',
        tag: background?.tag ?? segment.tag,
        imageUrl: backgrounds.urlFor(background?.id)
      }
    }
    if (segment.type !== 'dialogue' || !segment.characterId) {
      return {
        key: String(index),
        background: false,
        narration: true,
        text: segment.text,
        name: '',
        color: '',
        tag: null,
        imageUrl: null
      }
    }

    const image = characters.resolveImage(segment.characterId, segment.tag)
    const isNewImage = Boolean(image) && image!.id !== lastImageId
    if (image) lastImageId = image.id

    return {
      key: String(index),
      background: false,
      narration: false,
      text: segment.text,
      name: characters.byId(segment.characterId)?.name ?? 'Personaje',
      color: characters.colorOf(segment.characterId),
      tag: image?.tag ?? segment.tag,
      imageUrl: isNewImage ? characters.urlFor(image!.id) : null
    }
  })
})

function startEdit() {
  buffer.value = props.message.raw
  editing.value = true
}

function confirmEdit() {
  editing.value = false
  emit('edit', buffer.value)
}
</script>

<template>
  <div class="group flex min-w-0 items-start gap-2">
    <div
      v-if="editable && !editing"
      class="flex w-8 shrink-0 flex-col gap-1 text-[var(--color-fg-muted)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    >
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
        aria-label="Editar mensaje"
        title="Editar"
        @click="startEdit"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <button
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/10 hover:text-red-500"
        aria-label="Borrar mensaje"
        title="Borrar"
        @click="emit('remove')"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
        </svg>
      </button>
      <button
        v-if="message.role === 'assistant'"
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
        aria-label="Regenerar desde este mensaje"
        title="Regenerar desde aquí"
        @click="emit('regenerate')"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
        </svg>
      </button>
    </div>

    <div class="min-w-0 flex-1">
      <template v-if="editing">
        <textarea v-model="buffer" class="field min-h-28" />
        <div class="mt-2 flex gap-2">
          <button type="button" class="btn-primary" @click="confirmEdit">Guardar</button>
          <button type="button" class="btn-ghost" @click="editing = false">Cancelar</button>
        </div>
      </template>

      <template v-else-if="message.role === 'user'">
        <p class="text-[15px] leading-relaxed">
          <span class="font-semibold" :style="{ color: userColor }">{{ userName }}:</span>
          <span class="ml-1 whitespace-pre-wrap">{{ message.raw }}</span>
        </p>
      </template>

      <template v-else>
        <div class="space-y-2">
          <div v-for="row in rows" :key="row.key">
            <figure v-if="row.background" class="my-4 max-w-2xl">
              <img
                v-if="row.imageUrl"
                :src="row.imageUrl"
                :alt="`Fondo ${row.tag ?? ''}`"
                class="max-h-[28rem] w-full rounded-2xl bg-black/5 object-contain"
              />
              <div
                v-else
                class="rounded-xl border border-dashed border-[var(--color-border-soft)] p-4 text-sm text-[var(--color-fg-muted)]"
              >
                Fondo [{{ row.tag || 'sin etiqueta' }}] · fondo no disponible
              </div>
              <figcaption v-if="row.imageUrl" class="mt-1 text-xs text-[var(--color-fg-muted)]">
                Fondo<span v-if="row.tag"> · {{ row.tag }}</span>
                <span v-if="row.text"> · {{ row.text }}</span>
              </figcaption>
            </figure>
            <p
              v-else-if="row.narration"
              class="text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--color-fg-muted)] italic"
            >
              {{ row.text }}
            </p>
            <template v-else>
              <p class="text-[15px] leading-relaxed">
                <span class="font-semibold" :style="{ color: row.color }">{{ row.name }}</span>
                <span v-if="row.tag" class="text-xs text-[var(--color-fg-muted)]"> [{{ row.tag }}]</span>
                <span class="font-semibold" :style="{ color: row.color }">:</span>
                <span class="ml-1 whitespace-pre-wrap" :style="{ color: row.color }">{{ row.text }}</span>
              </p>
              <figure v-if="row.imageUrl" class="mt-2 mb-3 w-40">
                <img
                  :src="row.imageUrl"
                  :alt="`${row.name} ${row.tag ?? ''}`"
                  class="aspect-square w-40 rounded-xl object-cover"
                  :style="{ border: `2px solid ${row.color}` }"
                />
                <figcaption class="mt-1 text-xs text-[var(--color-fg-muted)]">
                  {{ row.name }}<span v-if="row.tag"> · {{ row.tag }}</span>
                </figcaption>
              </figure>
            </template>
          </div>
          <p v-if="message.segments.length === 0" class="text-sm text-[var(--color-fg-muted)]">…</p>
        </div>
      </template>
    </div>
  </div>
</template>
