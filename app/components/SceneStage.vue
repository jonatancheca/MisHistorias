<script setup lang="ts">
const props = defineProps<{
  characterIds: string[]
  activeCharacterId: string | null
  activeTag: string | null
}>()

const characters = useCharactersStore()

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
