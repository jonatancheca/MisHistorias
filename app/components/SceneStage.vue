<script setup lang="ts">
const props = defineProps<{
  characterIds: string[]
  activeCharacterId: string | null
  activeTag: string | null
  backgroundId: string | null
  backgroundTag: string | null
}>()

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const currentBackground = computed(() => backgrounds.byId(props.backgroundId))

const cast = computed(() =>
  props.characterIds
    .map((id) => characters.byId(id))
    .filter((character): character is NonNullable<typeof character> => Boolean(character))
)

function imageUrl(characterId: string) {
  const tag = characterId === props.activeCharacterId ? props.activeTag : null
  const image = characters.resolveImage(characterId, tag)
  return characters.urlFor(image?.id)
}

function currentTag(characterId: string) {
  const tag = characterId === props.activeCharacterId ? props.activeTag : null
  return characters.resolveImage(characterId, tag)?.tag ?? null
}
</script>

<template>
  <aside class="flex flex-col gap-4">
    <div class="rounded-xl border border-[var(--color-border-soft)] p-2">
      <img
        v-if="currentBackground && backgrounds.urlFor(currentBackground.id)"
        :src="backgrounds.urlFor(currentBackground.id)!"
        :alt="`Fondo ${currentBackground.tag}`"
        class="max-h-48 w-full rounded-lg bg-black/5 object-contain"
      />
      <div v-else class="flex aspect-video items-center justify-center rounded-lg bg-brand-500/10 px-2 text-center text-xs text-[var(--color-fg-muted)]">
        {{ backgroundId || backgroundTag ? 'Fondo no disponible' : 'Sin fondo' }}
      </div>
      <p class="mt-2 truncate text-sm font-semibold">Fondo</p>
      <p class="truncate text-xs text-[var(--color-fg-muted)]">
        {{ currentBackground ? `[${currentBackground.tag}]` : backgroundId || backgroundTag ? `[${backgroundTag ?? 'desconocido'}] · no disponible` : 'sin seleccionar' }}
      </p>
    </div>
    <div
      v-for="character in cast"
      :key="character.id"
      class="rounded-xl border p-2 transition"
      :class="character.id === activeCharacterId ? '' : 'border-[var(--color-border-soft)] opacity-60'"
      :style="
        character.id === activeCharacterId
          ? { borderColor: characters.colorOf(character.id), backgroundColor: `${characters.colorOf(character.id)}1a` }
          : undefined
      "
    >
      <img
        v-if="imageUrl(character.id)"
        :src="imageUrl(character.id)!"
        :alt="character.name"
        class="aspect-square w-full rounded-lg object-cover"
      />
      <div v-else class="aspect-square w-full rounded-lg bg-brand-500/20" />
      <p class="mt-2 truncate text-sm font-semibold" :style="{ color: characters.colorOf(character.id) }">
        {{ character.name }}
      </p>
      <p class="truncate text-xs text-[var(--color-fg-muted)]">
        {{ currentTag(character.id) ? `[${currentTag(character.id)}]` : 'sin imagen' }}
      </p>
    </div>
  </aside>
</template>
