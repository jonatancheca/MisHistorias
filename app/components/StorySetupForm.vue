<script setup lang="ts">
import type { StoryCharacterCustomization } from '#shared/types'
import {
  availableBackgroundStyles,
  matchesBackgroundStyle,
  normalizeBackgroundStyle
} from '~/lib/backgroundStyles'
import { DEFAULT_CHARACTER_COLOR, normalizeColor } from '~/lib/colors'
import { primaryTag } from '~/lib/tags'

withDefaults(defineProps<{
  idPrefix: string
  titleRequired?: boolean
  showVisibleInDemo?: boolean
}>(), {
  titleRequired: false,
  showVisibleInDemo: false
})

const title = defineModel<string>('title', { required: true })
const premise = defineModel<string>('premise', { required: true })
const visualMode = defineModel<boolean>('visualMode', { required: true })
const autoGenerateImages = defineModel<boolean>('autoGenerateImages', { required: true })
const protagonistPreferences = defineModel<string>('protagonistPreferences', { required: true })
const protagonistPreferencesMode = defineModel<'append' | 'replace'>('protagonistPreferencesMode', { required: true })
const characterIds = defineModel<string[]>('characterIds', { required: true })
const characterCustomizations = defineModel<StoryCharacterCustomization[]>('characterCustomizations', { required: true })
const initialBackgroundId = defineModel<string | null>('initialBackgroundId', { required: true })
const backgroundStyle = defineModel<string | null>('backgroundStyle', { required: true })
const visibleInDemo = defineModel<boolean>('visibleInDemo', { default: false })

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()
const editingCharacterId = ref<string | null>(null)
const characterPickerOpen = ref(false)
const backgroundPickerOpen = ref(false)
const preferencesOpen = ref(false)

const customizationsById = computed(() => new Map(
  characterCustomizations.value.map((customization) => [customization.characterId, customization])
))
const selectedIds = computed(() => new Set(characterIds.value))
const selectableCharacters = computed(() => characters.characters.filter((character) =>
  !character.readOnly &&
  (!privacy.isDemo || character.visibleInDemo) &&
  (!character.archived || customizationsById.value.has(character.id))
))
const selectedCharacters = computed(() => characterIds.value.flatMap((characterId) => {
  const character = characters.byId(characterId)
  return character ? [character] : []
}))
const pickerCharacters = computed(() => selectableCharacters.value
  .filter((character) => !selectedIds.value.has(character.id))
  .map((character) => ({
    id: character.id,
    label: characterLabel(character.id),
    tags: [...(customizationFor(character.id)?.tags ?? character.tags ?? [])],
    archived: Boolean(character.archived),
    customized: Boolean(customizationFor(character.id))
  })))
const backgroundStyles = computed(() => availableBackgroundStyles(
  backgrounds.backgrounds.filter((background) => !background.readOnly)
))
const selectableBackgroundIds = computed(() => backgrounds.backgrounds
  .filter((background) =>
    !background.readOnly &&
    (!privacy.isDemo || background.visibleInDemo) &&
    matchesBackgroundStyle(background, backgroundStyle.value)
  )
  .map((background) => background.id)
)
const selectedBackground = computed(() => {
  const background = backgrounds.byId(initialBackgroundId.value)
  return background && matchesBackgroundStyle(background, backgroundStyle.value) ? background : null
})
const editingCustomization = computed(() =>
  editingCharacterId.value ? customizationsById.value.get(editingCharacterId.value) ?? null : null
)
const characterTagSuggestions = computed(() =>
  characters.characters
    .filter((character) => !privacy.isDemo || character.visibleInDemo)
    .flatMap((character) => character.tags ?? [])
)
const preferencesSummary = computed(() => {
  const hasOwn = Boolean(protagonistPreferences.value.trim())
  if (protagonistPreferencesMode.value === 'replace') return hasOwn ? 'Solo propias' : 'Sin preferencias'
  return hasOwn ? 'Globales + propias' : 'Globales'
})

function customizationFor(characterId: string) {
  return customizationsById.value.get(characterId) ?? null
}

function ensureCustomization(characterId: string) {
  const existing = customizationFor(characterId)
  if (existing) return existing
  const character = characters.byId(characterId)
  if (!character) return null
  const customization: StoryCharacterCustomization = {
    characterId,
    name: character.name,
    color: normalizeColor(character.color, DEFAULT_CHARACTER_COLOR),
    prompt: character.prompt,
    tags: [...character.tags]
  }
  characterCustomizations.value = [...characterCustomizations.value, customization]
  return customization
}

function toggleCharacter(characterId: string) {
  if (selectedIds.value.has(characterId)) {
    characterIds.value = characterIds.value.filter((id) => id !== characterId)
    return
  }
  ensureCustomization(characterId)
  characterIds.value = [...characterIds.value, characterId]
}

function selectCharacter(characterId: string) {
  if (!selectedIds.value.has(characterId)) toggleCharacter(characterId)
  characterPickerOpen.value = false
}

function openCharacterEditor(characterId: string) {
  if (!ensureCustomization(characterId)) return
  editingCharacterId.value = characterId
}

function saveCharacter(customization: StoryCharacterCustomization) {
  characterCustomizations.value = characterCustomizations.value.map((item) =>
    item.characterId === customization.characterId
      ? { ...customization, tags: [...customization.tags] }
      : item
  )
  editingCharacterId.value = null
}

async function forgetCustomization(characterId: string) {
  if (selectedIds.value.has(characterId)) return
  const customization = customizationFor(characterId)
  if (!customization) return
  const accepted = await confirmDialog.ask({
    title: 'Olvidar personalización',
    message: `Se eliminará de esta historia la personalización recordada de «${customization.name}».`,
    confirmLabel: 'Olvidar'
  })
  if (!accepted) return
  characterCustomizations.value = characterCustomizations.value.filter(
    (item) => item.characterId !== characterId
  )
}

function selectBackground(backgroundId: string | null) {
  initialBackgroundId.value = backgroundId
  backgroundPickerOpen.value = false
}

function selectBackgroundStyle(value: string) {
  backgroundStyle.value = normalizeBackgroundStyle(value) || null
  if (!selectedBackground.value) initialBackgroundId.value = null
}

function savePreferences(value: { preferences: string; mode: 'append' | 'replace' }) {
  protagonistPreferences.value = value.preferences
  protagonistPreferencesMode.value = value.mode
  preferencesOpen.value = false
}

function characterLabel(characterId: string) {
  const character = characters.byId(characterId)
  const customized = customizationFor(characterId)?.name.trim() ?? ''
  if (character?.name && customized && character.name !== customized) return `${character.name} → ${customized}`
  return customized || character?.name || 'Personaje'
}

watch(characterIds, (ids) => {
  ids.forEach(ensureCustomization)
}, { immediate: true })
</script>

<template>
  <div class="grid gap-5">
    <section class="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:p-5">
      <h2 class="font-semibold">Historia</h2>
      <div class="mt-4 grid gap-4">
        <div>
          <label class="label" :for="`${idPrefix}-title`">Título</label>
          <input
            :id="`${idPrefix}-title`"
            v-model="title"
            autocomplete="off"
            class="field"
            placeholder="La taberna del puerto"
            :required="titleRequired"
          >
        </div>
        <div>
          <label class="label" :for="`${idPrefix}-premise`">Planteamiento</label>
          <textarea
            :id="`${idPrefix}-premise`"
            v-model="premise"
            autocomplete="off"
            class="field min-h-36"
            placeholder="Dónde ocurre, cuándo, qué está pasando y qué tono tiene la historia."
            required
          />
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:p-5">
      <h2 class="font-semibold">Presentación</h2>
      <p class="mt-1 text-xs text-[var(--color-fg-muted)]">Elige cómo quieres leer la historia.</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          class="flex items-center gap-3 rounded-xl border-2 p-4 text-left transition"
          :class="visualMode ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)] hover:border-brand-400'"
          :aria-pressed="visualMode"
          @click="visualMode = true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="h-7 w-7 shrink-0 fill-none stroke-current" stroke-width="1.8">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
            <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" />
          </svg>
          <span>
            <span class="block font-medium">Novela Visual</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">Escenas, personajes y diálogo visual.</span>
          </span>
        </button>
        <button
          type="button"
          class="flex items-center gap-3 rounded-xl border-2 p-4 text-left transition"
          :class="!visualMode ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)] hover:border-brand-400'"
          :aria-pressed="!visualMode"
          @click="visualMode = false"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="h-7 w-7 shrink-0 fill-none stroke-current" stroke-width="1.8">
            <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-5 4v-4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
            <path d="M7 9h10M7 13h7" />
          </svg>
          <span>
            <span class="block font-medium">Chat</span>
            <span class="block text-xs text-[var(--color-fg-muted)]">Conversación continua con imágenes integradas.</span>
          </span>
        </button>
      </div>

      <label class="mt-4 flex items-start gap-2 text-sm">
        <input v-model="autoGenerateImages" type="checkbox" class="mt-0.5 h-4 w-4">
        <span>
          <span class="block font-medium">Crear imágenes nuevas durante la historia</span>
          <span class="block text-xs text-[var(--color-fg-muted)]">El LLM podrá pedir una imagen nueva por personaje y respuesta.</span>
        </span>
      </label>

      <label v-if="showVisibleInDemo" class="mt-4 flex items-start gap-2 text-sm">
        <input v-model="visibleInDemo" type="checkbox" class="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]">
        <span>
          <span class="block font-medium">Visible en modo demo</span>
          <span class="block text-xs text-[var(--color-fg-muted)]">Permite mostrar esta historia y sus recursos contextuales en demo.</span>
        </span>
      </label>
    </section>

    <section class="grid gap-3 rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
      <button
        type="button"
        class="rounded-xl border border-[var(--color-border-soft)] p-4 text-left transition hover:border-brand-400"
        @click="preferencesOpen = true"
      >
        <span class="block text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">Preferencias del protagonista</span>
        <span class="mt-1 block font-semibold">{{ preferencesSummary }}</span>
        <span class="mt-1 block text-xs text-[var(--color-fg-muted)]">Pulsa para configurarlas.</span>
      </button>

      <label class="rounded-xl border border-[var(--color-border-soft)] p-4">
        <span class="block text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">Estilo de fondos</span>
        <select
          class="field mt-2"
          aria-label="Estilo de fondos"
          :value="backgroundStyle ?? ''"
          @change="selectBackgroundStyle(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Todos los estilos</option>
          <option v-for="item in backgroundStyles" :key="item" :value="item">{{ item }}</option>
        </select>
        <span class="mt-1 block text-xs text-[var(--color-fg-muted)]">
          Solo estos fondos estarán disponibles para la historia y el LLM.
        </span>
      </label>

      <button
        type="button"
        class="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-border-soft)] p-4 text-left transition hover:border-brand-400"
        aria-label="Seleccionar fondo inicial"
        @click="backgroundPickerOpen = true"
      >
        <img
          v-if="selectedBackground && backgrounds.urlFor(selectedBackground.id)"
          :src="backgrounds.urlFor(selectedBackground.id)!"
          alt=""
          class="h-14 w-20 shrink-0 rounded-lg object-contain"
        >
        <span v-else class="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-2xl" aria-hidden="true">✦</span>
        <span class="min-w-0">
          <span class="block text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">Fondo inicial</span>
          <span class="mt-1 block truncate font-semibold">{{ selectedBackground ? primaryTag(selectedBackground) : 'Que decida el LLM' }}</span>
          <span class="mt-1 line-clamp-1 block text-xs text-[var(--color-fg-muted)]">
            {{ selectedBackground?.description || (selectedBackground ? 'Sin descripción' : (selectableBackgroundIds.length ? 'Pulsa para elegir un fondo.' : 'No hay fondos de este estilo.')) }}
          </span>
        </span>
      </button>
    </section>

    <section class="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">Personajes de la historia</h2>
          <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
            Aquí solo aparece el elenco seleccionado. Quitar un personaje conserva su personalización.
          </p>
        </div>
        <button
          type="button"
          class="btn-primary shrink-0"
          :disabled="!pickerCharacters.length"
          @click="characterPickerOpen = true"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Añadir personaje
        </button>
      </div>

      <p v-if="!selectableCharacters.length && !selectedCharacters.length" class="mt-4 text-sm text-[var(--color-fg-muted)]">
        No hay personajes disponibles.
        <NuxtLink to="/characters" class="text-brand-600 underline">Crea uno primero</NuxtLink>.
      </p>
      <p v-else-if="!selectedCharacters.length" class="empty-state mt-4 rounded-xl border border-[var(--color-border-soft)] p-6 text-sm text-[var(--color-fg-muted)]">
        Añade al menos un personaje para comenzar la historia.
      </p>
      <div v-else class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <article
          v-for="character in selectedCharacters"
          :key="character.id"
          class="grid min-w-0 gap-3 rounded-xl border-2 border-brand-500 bg-brand-500/10 p-3"
          data-testid="selected-story-character"
        >
          <header class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 flex-1 truncate font-semibold">{{ characterLabel(character.id) }}</span>
            <CharacterTagsTooltip
              :tags="customizationFor(character.id)?.tags ?? character.tags ?? []"
              :label="characterLabel(character.id)"
            />
          </header>
          <div class="flex min-w-0 gap-2">
            <CharacterImageCarousel
              :character-id="character.id"
              :alt="characterLabel(character.id)"
              class="h-64 min-w-0 flex-1 sm:h-72"
            />
            <div class="flex w-10 shrink-0 flex-col gap-2">
              <button
                type="button"
                class="btn-ghost h-10 w-10 px-0"
                :aria-label="`Editar ${characterLabel(character.id)}`"
                title="Editar"
                @click="openCharacterEditor(character.id)"
              >
                <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m4 20 4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10zM13.5 8l3 3" />
                </svg>
              </button>
              <button
                type="button"
                class="btn-ghost h-10 w-10 px-0 text-red-500"
                :aria-label="`Quitar ${characterLabel(character.id)} del elenco`"
                title="Quitar del elenco"
                @click="toggleCharacter(character.id)"
              >
                <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-1 text-[0.68rem] text-[var(--color-fg-muted)]">
            <span v-if="character.archived" class="rounded-full border border-[var(--color-border-soft)] px-1.5 py-0.5">Archivado</span>
            <span class="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-brand-600">En el elenco</span>
          </div>
        </article>
      </div>
    </section>

    <StoryCharacterEditDialog
      :customization="editingCustomization"
      :original-name="editingCharacterId ? characters.byId(editingCharacterId)?.name ?? '' : ''"
      :id-prefix="idPrefix"
      :suggestions="characterTagSuggestions"
      @close="editingCharacterId = null"
      @save="saveCharacter"
    />
    <StoryCharacterPickerDialog
      :open="characterPickerOpen"
      :characters="pickerCharacters"
      @close="characterPickerOpen = false"
      @select="selectCharacter"
      @forget="forgetCustomization"
    />
    <StoryBackgroundPickerDialog
      :open="backgroundPickerOpen"
      :background-ids="selectableBackgroundIds"
      :selected-id="initialBackgroundId"
      @close="backgroundPickerOpen = false"
      @select="selectBackground"
    />
    <StoryPreferencesDialog
      :open="preferencesOpen"
      :preferences="protagonistPreferences"
      :mode="protagonistPreferencesMode"
      @close="preferencesOpen = false"
      @save="savePreferences"
    />
  </div>
</template>
