<script setup lang="ts">
import type { Character } from '#shared/types'
import {
  characterArchiveFilename,
  createCharacterArchive,
  normalizeCharacterName,
  readCharacterArchive,
  type ImportedCharacterArchive
} from '~/lib/characterArchive'
import { listSounds, listStories } from '~/lib/db'

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
const showArchived = ref(false)
const visibleCharacters = computed(() =>
  characters.characters.filter((character) => character.archived === showArchived.value)
)

function usageMessage(name: string, stories: Array<{ title: string }>) {
  const titles = stories.map((story) => `«${story.title}»`).join(', ')
  return `No se puede borrar «${name}». Se usa en ${titles}. Borra antes esas historias.`
}

function serverUsageStories(caught: unknown) {
  const error = caught as {
    data?: { data?: { stories?: Array<{ id: string; title: string }> } }
  }
  return error.data?.data?.stories ?? []
}

async function remove(id: string) {
  const character = characters.byId(id)
  if (!character) return
  transferError.value = null
  transferSuccess.value = null
  const usedBy = (await listStories()).filter((story) => story.characterIds.includes(id))
  if (usedBy.length) {
    transferError.value = usageMessage(character.name, usedBy)
    return
  }
  const accepted = await confirmDialog.ask({
    title: 'Borrar personaje',
    message: 'Se borrarán el personaje y todas sus imágenes. Esta acción no se puede deshacer.'
  })
  if (!accepted) return
  try {
    await characters.removeCharacter(id)
  } catch (caught) {
    const stories = serverUsageStories(caught)
    transferError.value = stories.length
      ? usageMessage(character.name, stories)
      : (caught as Error).message || 'No se pudo borrar el personaje.'
  }
}

async function setArchived(id: string, archived: boolean) {
  transferError.value = null
  transferSuccess.value = null
  await characters.setArchived(id, archived)
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
        <button
          type="button"
          class="btn-ghost"
          :aria-pressed="showArchived"
          @click="showArchived = !showArchived"
        >
          <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
          </svg>
          {{ showArchived ? 'Ver activos' : 'Ver archivados' }}
        </button>
        <button type="button" class="btn-ghost" :disabled="importing" @click="importInput?.click()">
          <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M5 21h14" />
          </svg>
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
        <NuxtLink to="/characters/new" class="btn-primary">
          <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="7" r="4" />
            <path d="M3 21v-2a6 6 0 0 1 12 0v2m5-10v6m-3-3h6" />
          </svg>
          Nuevo personaje
        </NuxtLink>
      </div>
    </header>

    <p v-if="transferError" class="card mb-4 text-sm text-red-500" role="alert">
      {{ transferError }}
    </p>
    <p v-else-if="transferSuccess" class="card mb-4 text-sm text-green-600" role="status">
      {{ transferSuccess }}
    </p>

    <p v-if="visibleCharacters.length === 0" class="card text-sm text-[var(--color-fg-muted)]">
      {{ showArchived ? 'No hay personajes archivados.' : 'Aún no hay personajes.' }}
    </p>

    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <li v-for="character in visibleCharacters" :key="character.id" class="card flex h-full flex-col">
        <div class="flex items-start gap-3">
          <ImageLightbox
            v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
            :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
            alt=""
            container-class="h-24 w-24 shrink-0"
            image-class="h-24 w-24 rounded-xl bg-black/5 object-contain"
            :gallery-items="galleryItems(character.id)"
          />
          <div v-else class="h-24 w-24 shrink-0 rounded-xl bg-brand-500/20" />
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
            <p class="mt-2 text-xs text-[var(--color-fg-muted)]">
              {{ characters.imagesFor(character.id).length }} imágenes
            </p>
          </div>
        </div>
        <p
          class="mt-3 line-clamp-3 text-sm text-[var(--color-fg-muted)]"
          :title="character.prompt"
        >
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
        <div class="mt-auto flex flex-nowrap gap-2 pt-3">
          <NuxtLink
            :to="{ path: '/characters/new', query: { copyFrom: character.id } }"
            class="btn-ghost inline-flex items-center gap-1.5 max-[359px]:px-2"
            aria-label="Copiar"
            title="Copiar"
          >
            <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span class="hidden min-[360px]:inline">Copiar</span>
          </NuxtLink>
          <button
            type="button"
            class="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-2"
            :aria-label="character.archived ? 'Desarchivar' : 'Archivar'"
            :title="character.archived ? 'Desarchivar' : 'Archivar'"
            @click="setArchived(character.id, !character.archived)"
          >
            <svg v-if="character.archived" aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16v13H4zM3 3h18v4H3zM12 16v-5m0 0-3 3m3-3 3 3" />
            </svg>
            <svg v-else aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6" />
            </svg>
          </button>
          <button
            type="button"
            class="btn-ghost inline-flex items-center gap-1.5 max-[359px]:px-2"
            aria-label="Exportar"
            title="Exportar"
            :disabled="Boolean(exportingId)"
            @click="exportCharacter(character.id)"
          >
            <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M5 21h14" />
            </svg>
            <span class="hidden min-[360px]:inline">
              {{ exportingId === character.id ? 'Exportando…' : 'Exportar' }}
            </span>
          </button>
          <button
            type="button"
            class="btn-danger inline-flex shrink-0 items-center gap-1.5 px-2"
            aria-label="Borrar"
            title="Borrar"
            @click="remove(character.id)"
          >
            <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18m-4 0v-2H7v2m2 5v6m6-6v6M5 6l1 15h12l1-15" />
            </svg>
          </button>
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
