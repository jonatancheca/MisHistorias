<script setup lang="ts">
import type { LlmDebugTrace, Message } from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'
import { primaryTag } from '~/lib/tags'

const props = defineProps<{
  message: Message
  editable?: boolean
  debugTrace?: LlmDebugTrace | null
  visualMode?: boolean
}>()
const emit = defineEmits<{
  edit: [string]
  remove: []
  regenerate: []
  resend: []
  debug: [LlmDebugTrace]
}>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const settings = useSettingsStore()
const editing = ref(false)
const buffer = ref('')

const userName = computed(() => settings.activeUserName)
const userColor = computed(() => normalizeColor(settings.settings.userColor, DEFAULT_USER_COLOR))

interface FlowRow {
  key: string
  background: boolean
  sound: boolean
  narration: boolean
  text: string
  name: string
  color: string
  tag: string | null
  imageUrl: string | null
  characterId: string | null
  soundUrl: string | null
}

function galleryItems(characterId: string | null) {
  if (!characterId) return undefined
  const characterName = characters.byId(characterId)?.name ?? 'Personaje'
  return characters.imagesFor(characterId).map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: `${characterName} ${primaryTag(image) ?? ''}`.trim()
  }))
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
        sound: false,
        narration: false,
        text: segment.text,
        name: 'Fondo',
        color: '',
        tag: primaryTag(background) ?? segment.tag,
        imageUrl: backgrounds.urlFor(background?.id),
        characterId: null,
        soundUrl: null
      }
    }
    if (segment.type === 'sound') {
      const sound = Object.prototype.hasOwnProperty.call(segment, 'soundId')
        ? sounds.byId(segment.soundId)
        : sounds.byTag(segment.tag)
      return {
        key: String(index),
        background: false,
        sound: true,
        narration: false,
        text: segment.text,
        name: 'Sonido',
        color: '',
        tag: sound?.tags[0] ?? segment.tag,
        inlineTag: null,
        imageUrl: null,
        characterId: null,
        soundUrl: sounds.urlFor(sound?.id)
      }
    }
    if (segment.type === 'protagonist-dialogue') {
      return {
        key: String(index),
        background: false,
        sound: false,
        narration: false,
        text: segment.text,
        name: userName.value,
        color: userColor.value,
        tag: null,
        imageUrl: null,
        characterId: null,
        soundUrl: null
      }
    }
    if (segment.type !== 'dialogue' || !segment.characterId) {
      return {
        key: String(index),
        background: false,
        sound: false,
        narration: true,
        text: segment.text,
        name: '',
        color: '',
        tag: null,
        imageUrl: null,
        characterId: null,
        soundUrl: null
      }
    }

    const requestedTags = segment.tags?.length ? segment.tags : segment.tag ? [segment.tag] : []
    const image = characters.resolveImage(segment.characterId, requestedTags, segment.imageId)
    const isNewImage = Boolean(image) && image!.id !== lastImageId
    if (image) lastImageId = image.id

    return {
      key: String(index),
      background: false,
      sound: false,
      narration: false,
      text: segment.text,
      name: characters.byId(segment.characterId)?.name ?? 'Personaje',
      color: characters.colorOf(segment.characterId),
      tag: primaryTag(image) ?? requestedTags[0] ?? null,
      imageUrl: isNewImage ? characters.urlFor(image!.id) : null,
      characterId: segment.characterId,
      soundUrl: null
    }
  }).filter((row) => !props.visualMode || !row.background)
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
      v-if="!editing && (editable || debugTrace)"
      class="flex w-8 shrink-0 flex-col gap-1 text-[var(--color-fg-muted)] opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
    >
      <button
        v-if="debugTrace"
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-amber-500/10 hover:text-amber-600"
        aria-label="Ver datos de debug de la llamada LLM"
        title="Debug LLM"
        @click="emit('debug', debugTrace)"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 2h8M9 2v3m6-3v3M4 13h3m10 0h3M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2" />
          <rect x="7" y="5" width="10" height="16" rx="5" />
          <path d="M9 11h6m-6 4h6" />
        </svg>
      </button>
      <button
        v-if="editable"
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
        v-if="editable"
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
        v-if="editable && message.role === 'assistant'"
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
      <button
        v-if="editable && message.role === 'user'"
        type="button"
        class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-brand-500/10 hover:text-brand-600"
        aria-label="Reenviar este mensaje"
        title="Reenviar desde aquí"
        @click="emit('resend')"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
        </svg>
      </button>
    </div>

    <div class="min-w-0 flex-1">
      <template v-if="editing">
        <form @submit.prevent="confirmEdit">
          <textarea v-model="buffer" autocomplete="off" class="field min-h-28" />
          <div class="mt-2 flex gap-2">
            <button type="submit" class="btn-primary">Guardar</button>
            <button type="button" class="btn-ghost" @click="editing = false">Cancelar</button>
          </div>
        </form>
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
              <ImageLightbox
                v-if="row.imageUrl"
                :src="row.imageUrl"
                :alt="`Fondo ${row.tag ?? ''}`"
                image-class="max-h-[28rem] w-full rounded-2xl bg-black/5 object-contain"
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
              v-else-if="row.sound"
              class="rounded-xl border border-[var(--color-border-soft)] p-3"
            >
              <span class="mb-2 block text-xs font-medium text-[var(--color-fg-muted)]">
                Sonido [{{ row.tag || 'sin etiqueta' }}]
              </span>
              <audio v-if="row.soundUrl" :src="row.soundUrl" controls preload="metadata" class="w-full" />
              <span v-else class="text-sm text-[var(--color-fg-muted)]">Sonido no disponible</span>
            </p>
            <p
              v-else-if="row.narration"
              class="text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--color-fg-muted)] italic"
            >
              {{ row.text }}
            </p>
            <template v-else>
              <p class="text-[15px] leading-relaxed">
                <span class="font-semibold" :style="{ color: row.color }">{{ row.name }}</span>
                <span class="font-semibold" :style="{ color: row.color }">:</span>
                <span class="ml-1 whitespace-pre-wrap" :style="{ color: row.color }">{{ row.text }}</span>
              </p>
              <figure v-if="row.imageUrl && !visualMode" class="mt-2 mb-3 w-40">
                <ImageLightbox
                  :src="row.imageUrl"
                  :alt="`${row.name} ${row.tag ?? ''}`"
                  container-class="w-40"
                  image-class="h-auto w-40 rounded-xl object-contain object-top"
                  :image-style="{ border: `2px solid ${row.color}` }"
                  :gallery-items="galleryItems(row.characterId)"
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
