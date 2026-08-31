<script setup lang="ts">
import { primaryTag, tagKey } from '~/lib/tags'
import { visualNovelCharacterCapacity } from '~/lib/visualNovelFrames'

interface CharacterVisualState {
  characterId: string
  tag: string | null
  tags?: string[]
  imageId: string | null
  imageIdOverride: boolean
  sourceMessageId: string
  sourceSegmentIndex: number
}

const props = defineProps<{
  characterIds: string[]
  characterStates: CharacterVisualState[]
  backgroundId: string | null
  backgroundTag: string | null
}>()
const emit = defineEmits<{
  selectImage: [target: CharacterVisualState]
}>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const stage = ref<HTMLElement | null>(null)
const stageWidth = ref(0)
let stageResizeObserver: ResizeObserver | null = null
const currentBackground = computed(() => backgrounds.byId(props.backgroundId))
const stateByCharacter = computed(
  () => new Map(props.characterStates.map((state) => [state.characterId, state]))
)

function sameTags(left: string[], right: string[]) {
  const leftKeys = new Set(left.map(tagKey).filter(Boolean))
  const rightKeys = new Set(right.map(tagKey).filter(Boolean))
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key))
}

const resolvedCast = computed(() =>
  props.characterIds.flatMap((characterId) => {
    const character = characters.byId(characterId)
    if (!character) return []
    const state = stateByCharacter.value.get(characterId)
    const image = characters.resolveImage(
      characterId,
      state?.tags?.length ? state.tags : state?.tag ?? null,
      state?.imageId ?? null,
      '',
      state?.imageIdOverride === true
    )
    const requestedTags = state?.tags?.length ? [...state.tags] : state?.tag ? [state.tag] : []
    return [
      {
        character,
        state,
        imageTags: image?.tags ? [...image.tags] : [],
        requestedTags,
        imageUrl: characters.urlFor(image?.id),
        tag: primaryTag(image) ?? state?.tag ?? null
      }
    ]
  })
)
const cast = computed(() =>
  resolvedCast.value.slice(-visualNovelCharacterCapacity(stageWidth.value))
)

function galleryItems(characterId: string) {
  const character = characters.byId(characterId)
  const name = character?.name ?? 'Personaje'
  return characters.imagesFor(characterId).map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: `${name} ${primaryTag(image) ?? ''}`.trim()
  }))
}

onMounted(() => {
  if (!stage.value) return
  stageWidth.value = stage.value.getBoundingClientRect().width
  stageResizeObserver = new ResizeObserver(([entry]) => {
    if (entry) stageWidth.value = entry.contentRect.width
  })
  stageResizeObserver.observe(stage.value)
})

onBeforeUnmount(() => stageResizeObserver?.disconnect())
</script>

<template>
  <div
    ref="stage"
    data-testid="visual-novel-stage"
    class="relative h-full min-h-0 overflow-hidden bg-slate-950"
  >
    <img
      v-if="currentBackground && backgrounds.urlFor(currentBackground.id)"
      data-testid="visual-novel-background"
      :src="backgrounds.urlFor(currentBackground.id)!"
      :alt="`Fondo ${primaryTag(currentBackground) ?? ''}`"
      class="absolute inset-0 h-full w-full object-cover"
    >
    <div
      v-else
      data-testid="visual-novel-background-placeholder"
      class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-800 to-brand-900 text-sm text-slate-300"
    >
      {{ backgroundId || backgroundTag ? 'Fondo no disponible' : 'Sin fondo' }}
    </div>

    <div class="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50" />

    <div
      data-testid="visual-novel-cast"
      class="absolute inset-x-0 top-[4%] bottom-0 flex min-w-0 items-end justify-evenly gap-1 px-1 sm:gap-3 sm:px-4"
    >
      <figure
        v-for="item in cast"
        :key="item.character.id"
        :data-character-id="item.character.id"
        class="group/character relative flex h-full min-w-0 flex-1 items-end justify-center"
        :aria-label="`${item.character.name}${item.tag ? `, ${item.tag}` : ''}`"
      >
        <div
          v-if="item.imageUrl"
          class="relative h-full min-h-0 w-full"
        >
          <ImageLightbox
            :src="item.imageUrl"
            :alt="item.character.name"
            container-class="h-full w-full"
            button-class="flex h-full min-h-0 w-full items-end justify-center focus:ring-brand-400"
            image-class="max-h-full min-h-0 w-full object-contain object-bottom drop-shadow-[0_10px_14px_rgba(0,0,0,0.65)]"
            :gallery-items="galleryItems(item.character.id)"
          />
          <button
            v-if="item.state"
            type="button"
            class="absolute top-2 right-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/75 text-white shadow-lg hover:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-brand-400"
            :aria-label="`Cambiar imagen de ${item.character.name}`"
            title="Cambiar imagen"
            @click.stop="emit('selectImage', item.state)"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9m11 0-3-3m3 3-3 3" />
            </svg>
          </button>
        </div>
        <div
          v-if="item.imageUrl"
          data-testid="visual-novel-image-details"
          class="pointer-events-none absolute inset-x-1 bottom-2 z-10 mx-auto max-w-[calc(100%-0.5rem)] rounded-lg bg-slate-950/80 px-2 py-1 text-left text-xs text-white opacity-0 shadow-lg backdrop-blur-sm transition group-hover/character:opacity-100 group-focus-within/character:opacity-100"
        >
          {{ item.character.name }}<span v-if="item.imageTags.length"> · {{ item.imageTags.join(' · ') }}</span>
          <span v-if="item.requestedTags.length && !sameTags(item.imageTags, item.requestedTags)">
            · LLM: {{ item.requestedTags.join(' · ') }}
          </span>
        </div>
        <div
          v-else
          class="mb-4 flex aspect-[3/4] max-h-[80%] w-full max-w-48 flex-col items-center justify-center rounded-t-full border border-white/30 bg-black/45 p-2 text-center text-white shadow-xl"
        >
          <span class="text-3xl font-bold">{{ item.character.name.slice(0, 1) }}</span>
          <span class="mt-2 max-w-full truncate text-xs">{{ item.character.name }}</span>
        </div>
      </figure>
    </div>
  </div>
</template>
