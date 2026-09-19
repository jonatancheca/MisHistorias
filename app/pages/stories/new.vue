<script setup lang="ts">
import type { StoryCharacterCustomization } from '#shared/types'

const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const settings = useSettingsStore()
const privacy = usePrivacyStore()

await Promise.all([
  stories.load(),
  characters.load(),
  backgrounds.load(),
  settings.load()
])

const copyFromId = Array.isArray(route.query.copyFrom)
  ? route.query.copyFrom[0]
  : route.query.copyFrom
const copiedStory =
  typeof copyFromId === 'string'
    ? (stories.stories.find((story) =>
        story.id === copyFromId && (!privacy.isDemo || story.visibleInDemo)
      ) ?? null)
    : null

function canUseCharacter(characterId: string) {
  const character = characters.byId(characterId)
  return Boolean(
    character &&
    !character.readOnly &&
    (!privacy.isDemo || character.visibleInDemo)
  )
}

const copiedCustomizations = (copiedStory?.characterCustomizations ?? [])
  .filter((customization) => canUseCharacter(customization.characterId))
  .map((customization): StoryCharacterCustomization => ({
    ...customization,
    tags: [...customization.tags]
  }))
const copiedCustomizationIds = new Set(
  copiedCustomizations.map((customization) => customization.characterId)
)

const title = ref('')
const premise = ref(copiedStory?.premise ?? '')
const visualMode = ref(copiedStory?.visualMode ?? true)
const autoGenerateImages = ref(copiedStory?.autoGenerateImages ?? false)
const protagonistPreferences = ref(copiedStory?.protagonistPreferences ?? '')
const protagonistPreferencesMode = ref<'append' | 'replace'>(
  copiedStory?.protagonistPreferencesMode ?? 'append'
)
const selected = ref<string[]>(
  copiedStory?.characterIds.filter((characterId) => {
    const character = characters.byId(characterId)
    return Boolean(
      canUseCharacter(characterId) &&
      (!character?.archived || copiedCustomizationIds.has(characterId))
    )
  }) ?? []
)
const characterCustomizations = ref<StoryCharacterCustomization[]>(copiedCustomizations)
const initialBackgroundId = ref<string | null>(
  copiedStory && backgrounds.byId(copiedStory.initialBackgroundId)
    ? copiedStory.initialBackgroundId
    : null
)
const backgroundStyle = ref<string | null>(copiedStory?.backgroundStyle ?? null)
const saving = ref(false)

const canSubmit = computed(
  () => premise.value.trim().length > 0 && selected.value.length > 0 && !saving.value
)

async function submit() {
  if (!canSubmit.value) return
  saving.value = true
  try {
    const story = await stories.createStory({
      title: title.value,
      premise: premise.value,
      visualMode: visualMode.value,
      autoGenerateImages: autoGenerateImages.value,
      protagonistPreferences: protagonistPreferences.value,
      protagonistPreferencesMode: protagonistPreferencesMode.value,
      characterIds: selected.value,
      characterCustomizations: characterCustomizations.value.map((customization) => ({
        ...customization,
        tags: [...customization.tags]
      })),
      initialBackgroundId: initialBackgroundId.value,
      backgroundStyle: backgroundStyle.value
    })
    await navigateTo(`/stories/${story.id}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page-shell">
    <header class="mb-8">
      <p class="page-kicker">Nuevo relato</p>
      <h1 class="page-title">Crea una historia</h1>
      <p class="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
        Define el punto de partida, reúne el elenco y deja que la aventura cobre vida.
      </p>
    </header>

    <form class="grid max-w-5xl gap-5" @submit.prevent="submit">
      <StorySetupForm
        v-model:title="title"
        v-model:premise="premise"
        v-model:visual-mode="visualMode"
        v-model:auto-generate-images="autoGenerateImages"
        v-model:protagonist-preferences="protagonistPreferences"
        v-model:protagonist-preferences-mode="protagonistPreferencesMode"
        v-model:character-ids="selected"
        v-model:character-customizations="characterCustomizations"
        v-model:initial-background-id="initialBackgroundId"
        v-model:background-style="backgroundStyle"
        id-prefix="story-character"
      />

      <div class="flex flex-wrap gap-2">
        <button type="submit" class="btn-primary" :disabled="!canSubmit">Empezar historia</button>
        <NuxtLink to="/" class="btn-ghost">Cancelar</NuxtLink>
      </div>
    </form>
  </div>
</template>
