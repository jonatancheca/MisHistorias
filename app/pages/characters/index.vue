<script setup lang="ts">
import type { Character } from '#shared/types'
import {
  characterArchiveFilename,
  createCharacterArchive,
  normalizeCharacterName,
  readCharacterArchive,
  type ImportedCharacterArchive
} from '~/lib/characterArchive'
import { listSounds } from '~/lib/db'

const characters = useCharactersStore()
const confirmDialog = useConfirmStore()
await characters.load()

const importInput = ref<HTMLInputElement | null>(null)
const pendingArchive = ref<ImportedCharacterArchive | null>(null)
const importMatches = ref<Character[]>([])
const showImportDialog = ref(false)
const importing = ref(false)
const exportingId = ref<string | null>(null)
const transferError = ref<string | null>(null)
const transferSuccess = ref<string | null>(null)

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

async function exportCharacter(id: string) {
  const character = characters.byId(id)
  if (!character || exportingId.value) return
  exportingId.value = id
  transferError.value = null
  transferSuccess.value = null
  try {
    const sounds = (await listSounds()).filter((sound) => sound.characterId === id)
    const blob = await createCharacterArchive(character, characters.imagesFor(id), sounds)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = characterArchiveFilename(character.name)
    link.click()
    URL.revokeObjectURL(url)
  } catch (caught) {
    transferError.value = (caught as Error).message || 'No se pudo exportar el personaje.'
  } finally {
    exportingId.value = null
  }
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return
  transferError.value = null
  transferSuccess.value = null
  try {
    const archive = await readCharacterArchive(file)
    pendingArchive.value = archive
    const nameKey = normalizeCharacterName(archive.character.name)
    importMatches.value = characters.characters.filter(
      (character) => normalizeCharacterName(character.name) === nameKey
    )
    if (importMatches.value.length === 0) {
      await performImport(archive.character.name)
    } else {
      showImportDialog.value = true
    }
  } catch (caught) {
    transferError.value = (caught as Error).message || 'No se pudo importar el personaje.'
  }
}

async function performImport(name: string, targetId?: string) {
  if (!pendingArchive.value || importing.value) return
  importing.value = true
  showImportDialog.value = false
  transferError.value = null
  try {
    const imported = await characters.importArchive(pendingArchive.value, name, targetId)
    transferSuccess.value = targetId
      ? `«${imported.name}» reemplazado.`
      : `«${imported.name}» importado.`
    pendingArchive.value = null
    importMatches.value = []
  } catch (caught) {
    transferError.value = (caught as Error).message || 'No se pudo importar el personaje.'
  } finally {
    importing.value = false
  }
}

function cancelImport() {
  showImportDialog.value = false
  pendingArchive.value = null
  importMatches.value = []
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold">Personajes</h1>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          {{ importing ? 'Importando…' : 'Importar' }}
        </button>
        <input
          ref="importInput"
          type="file"
          accept=".zip,application/zip"
          autocomplete="off"
          class="hidden"
          @change="onImportFile"
        >
        <NuxtLink to="/characters/new" class="btn-primary">Nuevo personaje</NuxtLink>
      </div>
    </header>

    <p v-if="transferError" class="card mb-4 text-sm text-red-500" role="alert">
      {{ transferError }}
    </p>
    <p v-else-if="transferSuccess" class="card mb-4 text-sm text-green-600" role="status">
      {{ transferSuccess }}
    </p>

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
          <button
            type="button"
            class="btn-ghost"
            :disabled="Boolean(exportingId)"
            @click="exportCharacter(character.id)"
          >
            {{ exportingId === character.id ? 'Exportando…' : 'Exportar' }}
          </button>
          <button type="button" class="btn-danger" @click="remove(character.id)">Borrar</button>
        </div>
      </li>
    </ul>

    <CharacterImportDialog
      v-if="showImportDialog && pendingArchive"
      :imported-name="pendingArchive.character.name"
      :matches="importMatches"
      @cancel="cancelImport"
      @create="performImport($event)"
      @replace="performImport(pendingArchive.character.name, $event)"
    />
  </div>
</template>
