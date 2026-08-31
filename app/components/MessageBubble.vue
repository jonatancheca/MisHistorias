<script setup lang="ts">
import type { LlmDebugTrace, Message } from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'
import { isAiInstruction } from '~/lib/chatInstructions'
import { primaryTag, tagKey } from '~/lib/tags'

const props = defineProps<{
  message: Message
  editable?: boolean
  debugTrace?: LlmDebugTrace | null
  compactionTrace?: LlmDebugTrace | null
  visualMode?: boolean
  characterNames?: Record<string, string>
  characterColors?: Record<string, string>
}>()
const emit = defineEmits<{
  edit: [string]
  remove: []
  regenerate: []
  resend: []
  debug: [LlmDebugTrace]
  selectImage: [target: { characterId: string; messageId: string; segmentIndex: number; imageId: string | null }]
}>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const settings = useSettingsStore()
const editing = ref(false)
const buffer = ref('')
const expandedImageTags = ref<Record<string, boolean>>({})

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
  imageTags: string[]
  requestedTags: string[]
  imageUrl: string | null
  characterId: string | null
  soundUrl: string | null
  segmentIndex?: number
  imageId?: string | null
}

function galleryItems(characterId: string | null) {
  if (!characterId) return undefined
  const characterName = props.characterNames?.[characterId] ?? characters.byId(characterId)?.name ?? 'Personaje'
  return characters.imagesFor(characterId).map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: `${characterName} ${primaryTag(image) ?? ''}`.trim()
  }))
}

function sameTags(left: string[], right: string[]) {
  const leftKeys = new Set(left.map(tagKey).filter(Boolean))
  const rightKeys = new Set(right.map(tagKey).filter(Boolean))
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key))
}

function toggleImageTags(rowKey: string) {
  expandedImageTags.value = {
    ...expandedImageTags.value,
    [rowKey]: !expandedImageTags.value[rowKey]
  }
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
        imageTags: [],
        requestedTags: [],
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
        imageTags: [],
        requestedTags: [],
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
        imageTags: [],
        requestedTags: [],
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
        imageTags: [],
        requestedTags: [],
        imageUrl: null,
        characterId: null,
        soundUrl: null
      }
    }

    const requestedTags = segment.tags?.length ? segment.tags : segment.tag ? [segment.tag] : []
    const image = characters.resolveImage(
      segment.characterId,
      requestedTags,
      segment.imageId,
      '',
      segment.imageIdOverride === true
    )
    const isNewImage = Boolean(image) && image!.id !== lastImageId
    if (image) lastImageId = image.id

    return {
      key: String(index),
      background: false,
      sound: false,
      narration: false,
      text: segment.text,
      name: props.characterNames?.[segment.characterId] ?? characters.byId(segment.characterId)?.name ?? 'Personaje',
      color: props.characterColors?.[segment.characterId] ?? characters.colorOf(segment.characterId),
      tag: primaryTag(image) ?? requestedTags[0] ?? null,
      imageTags: image?.tags ? [...image.tags] : [],
      requestedTags: [...requestedTags],
      imageUrl: isNewImage ? characters.urlFor(image!.id) : null,
      characterId: segment.characterId,
      soundUrl: null,
      segmentIndex: index,
      imageId: image?.id ?? null
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
  <div
    v-if="!isAiInstruction(message.raw)"
    class="group flex min-w-0 items-start gap-2"
    :data-story-message-id="message.id"
  >
    <MessageActions
      v-if="!message.swarmError && !editing && (editable || debugTrace || compactionTrace)"
      :message="message"
      :editable="editable"
      :debug-trace="debugTrace"
      :compaction-trace="compactionTrace"
      class="w-8 flex-col text-[var(--color-fg-muted)] opacity-100 transition max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      @edit="startEdit"
      @remove="emit('remove')"
      @regenerate="emit('regenerate')"
      @resend="emit('resend')"
      @debug="emit('debug', $event)"
    />

    <div class="min-w-0 flex-1">
      <SwarmErrorMessage v-if="message.swarmError" :error="message.swarmError" />
      <template v-else-if="editing">
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
              <figure v-if="row.imageUrl && !visualMode" class="group/image mt-2 mb-3 w-40">
                <ImageLightbox
                  :src="row.imageUrl"
                  :alt="`${row.name} ${row.tag ?? ''}`"
                  container-class="w-40"
                  image-class="h-auto w-40 rounded-xl object-contain object-top"
                  :image-style="{ border: `2px solid ${row.color}` }"
                  :gallery-items="galleryItems(row.characterId)"
                  selectable
                  @select="row.characterId && row.segmentIndex !== undefined && emit('selectImage', { characterId: row.characterId, messageId: message.id, segmentIndex: row.segmentIndex, imageId: row.imageId ?? null })"
                />
                <figcaption
                  class="mt-1 text-xs text-[var(--color-fg-muted)] opacity-100 transition sm:opacity-0 sm:group-hover/image:opacity-100 sm:group-focus-within/image:opacity-100"
                >
                  <button
                    type="button"
                    class="text-left hover:text-[var(--color-fg)] focus:outline-none focus-visible:underline"
                    :aria-expanded="expandedImageTags[row.key] === true"
                    :aria-label="`Ver tags LLM de ${row.name}`"
                    @click="row.requestedTags.length && !sameTags(row.imageTags, row.requestedTags) && toggleImageTags(row.key)"
                  >
                    {{ row.name }}<span v-if="row.imageTags.length"> · {{ row.imageTags.join(' · ') }}</span>
                    <span
                      v-if="row.requestedTags.length && !sameTags(row.imageTags, row.requestedTags)"
                      :class="expandedImageTags[row.key] ? 'inline' : 'hidden sm:inline'"
                    >
                      · LLM: {{ row.requestedTags.join(' · ') }}
                    </span>
                  </button>
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
