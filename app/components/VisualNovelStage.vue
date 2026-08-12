<script setup lang="ts">
import { primaryTag } from '~/lib/tags'

interface CharacterVisualState {
  characterId: string
  tag: string | null
  tags?: string[]
  imageId: string | null
}

const props = defineProps<{
  characterIds: string[]
  characterStates: CharacterVisualState[]
  backgroundId: string | null
  backgroundTag: string | null
}>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const currentBackground = computed(() => backgrounds.byId(props.backgroundId))
const stateByCharacter = computed(
  () => new Map(props.characterStates.map((state) => [state.characterId, state]))
)
const cast = computed(() =>
  props.characterIds.flatMap((characterId) => {
    const character = characters.byId(characterId)
    if (!character) return []
    const state = stateByCharacter.value.get(characterId)
    const image = characters.resolveImage(
      characterId,
      state?.tags?.length ? state.tags : state?.tag ?? null,
      state?.imageId ?? null
    )
    return [
      {
        character,
        imageUrl: characters.urlFor(image?.id),
        tag: primaryTag(image) ?? state?.tag ?? null
      }
    ]
  })
)
</script>

<template>
  <div
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
        class="flex h-full min-w-0 flex-1 items-end justify-center"
        :aria-label="`${item.character.name}${item.tag ? `, ${item.tag}` : ''}`"
      >
        <img
          v-if="item.imageUrl"
          :src="item.imageUrl"
          :alt="item.character.name"
          class="max-h-full min-h-0 w-full object-contain object-bottom drop-shadow-[0_10px_14px_rgba(0,0,0,0.65)]"
        >
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
