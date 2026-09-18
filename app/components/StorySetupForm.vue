<script setup lang="ts">
import type { StoryCharacterCustomization } from '#shared/types'
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
const visibleInDemo = defineModel<boolean>('visibleInDemo', { default: false })

const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()
const editingCharacterId = ref<string | null>(null)
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
const selectableBackgroundIds = computed(() => backgrounds.backgrounds
  .filter((background) => !background.readOnly && (!privacy.isDemo || background.visibleInDemo))
  .map((background) => background.id)
)
const selectedBackground = computed(() => backgrounds.byId(initialBackgroundId.value))
const editingCustomization = computed(() =>
  editingCharacterId.value ? customizationsById.value.get(editingCharacterId.value) ?? null : null
)
const characterTagSuggestions = computed(() =>
  characters.characters.flatMap((character) => character.tags ?? [])
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

    <section class="rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div>
        <h2 class="font-semibold">Personajes de la historia</h2>
        <p class="mt-1 text-xs text-[var(--color-fg-muted)]">
          Selecciona el elenco. Quitar un personaje conserva su personalización en esta historia.
        </p>
      </div>

      <p v-if="!selectableCharacters.length" class="mt-4 text-sm text-[var(--color-fg-muted)]">
        No hay personajes disponibles.
        <NuxtLink to="/characters" class="text-brand-600 underline">Crea uno primero</NuxtLink>.
      </p>
      <div v-else class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="character in selectableCharacters"
          :key="character.id"
          class="grid gap-3 rounded-xl border-2 p-3 transition"
          :class="selectedIds.has(character.id) ? 'border-brand-500 bg-brand-500/10' : 'border-[var(--color-border-soft)]'"
        >
          <button
            type="button"
            class="flex min-w-0 items-center gap-3 text-left"
            :aria-label="selectedIds.has(character.id) ? `Quitar ${characterLabel(character.id)} del elenco` : `Añadir ${characterLabel(character.id)} al elenco`"
            :aria-pressed="selectedIds.has(character.id)"
            @click="toggleCharacter(character.id)"
          >
            <img
              v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
              :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
              alt=""
              class="h-11 w-11 shrink-0 rounded-full object-cover"
            >
            <span v-else class="h-11 w-11 shrink-0 rounded-full bg-brand-500/20" />
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ characterLabel(character.id) }}</span>
              <span class="mt-0.5 flex flex-wrap gap-1 text-[0.68rem] text-[var(--color-fg-muted)]">
                <span v-if="character.archived" class="rounded-full border border-[var(--color-border-soft)] px-1.5 py-0.5">Archivado</span>
                <span v-if="!selectedIds.has(character.id) && customizationFor(character.id)" class="rounded-full border border-[var(--color-border-soft)] px-1.5 py-0.5">Personalización guardada</span>
                <span v-if="selectedIds.has(character.id)" class="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-brand-600">En el elenco</span>
              </span>
            </span>
          </button>

          <div v-if="selectedIds.has(character.id) || customizationFor(character.id)" class="flex flex-wrap justify-end gap-2 border-t border-[var(--color-border-soft)] pt-2">
            <button
              v-if="selectedIds.has(character.id)"
              type="button"
              class="btn-ghost px-3 py-1.5 text-xs"
              :aria-label="`Editar ${characterLabel(character.id)}`"
              @click="openCharacterEditor(character.id)"
            >
              Editar
            </button>
            <button
              v-else
              type="button"
              class="btn-ghost px-3 py-1.5 text-xs text-red-500"
              :aria-label="`Olvidar personalización de ${characterLabel(character.id)}`"
              @click="forgetCustomization(character.id)"
            >
              Olvidar personalización
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="grid gap-3 rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-4 sm:grid-cols-2 sm:p-5">
      <button
        type="button"
        class="rounded-xl border border-[var(--color-border-soft)] p-4 text-left transition hover:border-brand-400"
        @click="preferencesOpen = true"
      >
        <span class="block text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">Preferencias del protagonista</span>
        <span class="mt-1 block font-semibold">{{ preferencesSummary }}</span>
        <span class="mt-1 block text-xs text-[var(--color-fg-muted)]">Pulsa para configurarlas.</span>
      </button>

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
            {{ selectedBackground?.description || (selectedBackground ? 'Sin descripción' : 'Pulsa para elegir un fondo.') }}
          </span>
        </span>
      </button>
    </section>

    <StoryCharacterEditDialog
      :customization="editingCustomization"
      :original-name="editingCharacterId ? characters.byId(editingCharacterId)?.name ?? '' : ''"
      :id-prefix="idPrefix"
      :suggestions="characterTagSuggestions"
      @close="editingCharacterId = null"
      @save="saveCharacter"
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
