<script setup lang="ts">
const characters = useCharactersStore()
await characters.load()

async function remove(id: string) {
  if (!confirm('¿Borrar el personaje y sus imágenes?')) return
  await characters.removeCharacter(id)
}
</script>

<template>
  <div class="mx-auto max-w-4xl p-8">
    <header class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-bold">Personajes</h1>
      <NuxtLink to="/characters/new" class="btn-primary">Nuevo personaje</NuxtLink>
    </header>

    <p v-if="characters.characters.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      Aún no hay personajes.
    </p>

    <ul class="grid gap-3 sm:grid-cols-2">
      <li v-for="character in characters.characters" :key="character.id" class="card">
        <div class="flex items-start gap-3">
          <img
            v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
            :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
            alt=""
            class="h-16 w-16 rounded-xl object-cover"
          />
          <div class="h-16 w-16 shrink-0 rounded-xl bg-brand-500/20" v-else />
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
            <p class="mt-2 text-xs text-[var(--color-fg-muted)]">
              {{ characters.imagesFor(character.id).length }} imágenes
            </p>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <NuxtLink :to="`/characters/${character.id}`" class="btn-ghost">Editar</NuxtLink>
          <button type="button" class="btn-danger" @click="remove(character.id)">Borrar</button>
        </div>
      </li>
    </ul>
  </div>
</template>
