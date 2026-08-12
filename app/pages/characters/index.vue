<script setup lang="ts">
const characters = useCharactersStore()
const confirmDialog = useConfirmStore()
await characters.load()

async function remove(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar personaje',
    message: 'Se borrarán el personaje y todas sus imágenes. Esta acción no se puede deshacer.'
  })
  if (!accepted) return
  await characters.removeCharacter(id)
}

function galleryItems(characterId: string) {
  const characterName = characters.byId(characterId)?.name ?? 'Personaje'
  return characters.imagesFor(characterId).map((image) => ({
    src: characters.urlFor(image.id)!,
    alt: characterName
  }))
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Personajes</h1>
      <NuxtLink to="/characters/new" class="btn-primary">Nuevo personaje</NuxtLink>
    </header>

    <p v-if="characters.characters.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      Aún no hay personajes.
    </p>

    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <li v-for="character in characters.characters" :key="character.id" class="card">
        <div class="flex items-start gap-3">
          <ImageLightbox
            v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
            :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
            alt=""
            container-class="h-16 w-16 shrink-0"
            image-class="h-16 w-16 rounded-xl bg-black/5 object-contain"
            :gallery-items="galleryItems(character.id)"
          />
          <div v-else class="h-16 w-16 shrink-0 rounded-xl bg-brand-500/20" />
          <div class="min-w-0 flex-1">
            <NuxtLink
              :to="`/characters/${character.id}`"
              class="flex items-center gap-2 truncate font-semibold hover:text-brand-600"
            >
              <span
                class="inline-block h-3 w-3 shrink-0 rounded-full"
                :style="{ backgroundColor: characters.colorOf(character.id) }"
              />
              <span class="truncate">{{ character.name }}</span>
            </NuxtLink>
            <p class="mt-1 line-clamp-3 text-sm text-[var(--color-fg-muted)]">
              {{ character.prompt }}
            </p>
            <div v-if="character.tags?.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="tag in character.tags"
                :key="tag"
                class="inline-flex max-w-full truncate rounded-full bg-brand-500/15 px-2 py-0.5 text-xs"
              >
                {{ tag }}
              </span>
            </div>
            <p class="mt-2 text-xs text-[var(--color-fg-muted)]">
              {{ characters.imagesFor(character.id).length }} imágenes
            </p>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <NuxtLink :to="`/characters/${character.id}`" class="btn-ghost">Editar</NuxtLink>
          <NuxtLink
            :to="{ path: '/characters/new', query: { copyFrom: character.id } }"
            class="btn-ghost"
          >
            Copiar
          </NuxtLink>
          <button type="button" class="btn-danger" @click="remove(character.id)">Borrar</button>
        </div>
      </li>
    </ul>
  </div>
</template>
