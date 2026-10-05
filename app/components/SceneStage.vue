<script setup lang="ts">
import { primaryTag } from '~/lib/tags'

const props = defineProps<{
  characterIds: string[]
  activeCharacterId: string | null
  activeTag: string | null
  activeTags?: string[]
  activeImageId: string | null
  activeImageIdOverride?: boolean
  backgroundId: string | null
  backgroundTag: string | null
  characterNames?: Record<string, string>
  absentCharacterIds?: string[]
  presenceDisabled?: boolean
  presenceEditable?: boolean
}>()

const emit = defineEmits<{ changePresence: [characterId: string, present: boolean] }>()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const currentBackground = computed(() => backgrounds.byId(props.backgroundId))

const cast = computed(() =>
  props.characterIds
    .map((id) => characters.byId(id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
)

function characterName(characterId: string) {
  return props.characterNames?.[characterId] ?? characters.byId(characterId)?.name ?? 'Personaje'
}

function imageUrl(characterId: string) {
  const tags = characterId === props.activeCharacterId
    ? props.activeTags?.length ? props.activeTags : props.activeTag
    : null
  const imageId = characterId === props.activeCharacterId ? props.activeImageId : null
  const image = characters.resolveImage(characterId, tags, imageId, '', props.activeImageIdOverride === true)
  return characters.urlFor(image?.id)
}

function currentTag(characterId: string) {
  const tags = characterId === props.activeCharacterId
    ? props.activeTags?.length ? props.activeTags : props.activeTag
    : null
  const imageId = characterId === props.activeCharacterId ? props.activeImageId : null
  return primaryTag(
    characters.resolveImage(characterId, tags, imageId, '', props.activeImageIdOverride === true)
  )
}

function galleryItems(characterId: string) {
  const name = characterName(characterId)
  return characters.imagesFor(characterId).map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: `${name} ${primaryTag(image) ?? ''}`.trim()
  }))
}
</script>

<template>
  <aside class="flex flex-col gap-4" data-testid="chat-scene-stage">
    <div class="rounded-xl border border-[var(--color-border-soft)] p-2">
      <ImageLightbox
        v-if="currentBackground && backgrounds.urlFor(currentBackground.id)"
        fit-to-viewport
        :src="backgrounds.urlFor(currentBackground.id)!"
        :alt="`Fondo ${primaryTag(currentBackground) ?? ''}`"
        container-class="w-full"
        image-class="max-h-48 w-full rounded-lg bg-black/5 object-contain"
      />
      <div v-else class="flex aspect-video items-center justify-center rounded-lg bg-brand-500/10 px-2 text-center text-xs text-[var(--color-fg-muted)]">
        {{ backgroundId || backgroundTag ? 'Fondo no disponible' : 'Sin fondo' }}
      </div>
      <p class="mt-2 truncate text-sm font-semibold">Fondo</p>
      <p class="truncate text-xs text-[var(--color-fg-muted)]">
        {{ currentBackground ? `[${primaryTag(currentBackground)}]` : backgroundId || backgroundTag ? `[${backgroundTag ?? 'desconocido'}] · no disponible` : 'sin seleccionar' }}
      </p>
    </div>
    <div
      v-for="character in cast"
      :key="character.id"
      :data-character-id="character.id"
      class="rounded-xl border p-2 transition"
      :class="absentCharacterIds?.includes(character.id) ? 'border-[var(--color-border-soft)] opacity-40 grayscale' : character.id === activeCharacterId ? '' : 'border-[var(--color-border-soft)] opacity-60'"
      :style="
        character.id === activeCharacterId
          ? { borderColor: characters.colorOf(character.id), backgroundColor: `${characters.colorOf(character.id)}1a` }
          : undefined
      "
    >
      <ImageLightbox
        v-if="imageUrl(character.id)"
        fit-to-viewport
        :src="imageUrl(character.id)!"
        :alt="characterName(character.id)"
        container-class="w-full"
        image-class="h-auto w-full rounded-lg object-contain object-top"
        :gallery-items="galleryItems(character.id)"
      />
      <div v-else class="aspect-square w-full rounded-lg bg-brand-500/20" />
      <p class="mt-2 truncate text-sm font-semibold" :style="{ color: characters.colorOf(character.id) }">
        {{ characterName(character.id) }}
      </p>
      <button
        v-if="presenceEditable"
        type="button"
        role="switch"
        :aria-label="'Presencia de ' + characterName(character.id)"
        :aria-checked="!absentCharacterIds?.includes(character.id)"
        :disabled="presenceDisabled"
        class="btn-ghost mt-2 min-h-11 w-full text-xs"
        @click="emit('changePresence', character.id, absentCharacterIds?.includes(character.id) === true)"
      >{{ absentCharacterIds?.includes(character.id) ? 'Ausente' : 'Presente' }}</button>
      <p class="truncate text-xs text-[var(--color-fg-muted)]">
        {{ currentTag(character.id) ? `[${currentTag(character.id)}]` : 'sin imagen' }}
      </p>
    </div>
  </aside>
</template>
