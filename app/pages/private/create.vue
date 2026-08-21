<script setup lang="ts">
import type { CreateStorySessionInput } from '../../../shared/types/nsfw/session.ts'
import {
  coherentConfiguration,
  configurationForFormat,
  DEFAULT_INTEREST_TERMS,
  DURATION_CHOICES,
  FORMAT_CHOICES,
  INTERACTION_CHOICES,
  mapPerspectiveToSession,
  mapToneToSession,
  MIN_TASTE_RATINGS,
  PERSPECTIVE_CHOICES,
  PROFILE_CHOICES,
  QUICK_PRESETS,
  TONE_CHOICES,
  type ChoiceDefinition,
  type CreationSource,
  type CreatorFormat,
  type StoryConfiguration
} from '../../../shared/lib/nsfwCreatorConfig.ts'

definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()
const step = ref<1 | 2>(1)
const error = ref<string | null>(null)
const source = ref<CreationSource>('blank')
const configuration = ref<StoryConfiguration>(configurationForFormat('story'))
const modelAlias = ref('')
const experienceId = ref('')
const selectedPresetId = ref('')
const styleReference = ref('')
const storyDirection = ref('')
const premise = ref('')
const title = ref('')
const era = ref('Contemporánea')
const placeId = ref('')
const lockedRelations = ref(false)
const characterIds = ref<string[]>([])
const primary = ref<string[]>([])
const excluded = ref<string[]>([])
const contextual = ref<string[]>([])
const customPrimary = ref('')
const customExcluded = ref('')
const customContextual = ref('')
const termFilter = ref('')
const tasteUnlocked = ref(false)
const ratingsCount = ref(0)
const taxonomyTerms = ref<
  Array<{ id: string; label: string; facet: string; private?: boolean }>
>([])
const termError = ref<string | null>(null)

await Promise.all([
  sessions.loadModels(),
  studio.loadExperiences(),
  studio.loadCharacters(),
  studio.loadPlaces(),
  studio.loadLibraryEntries()
])

if (sessions.models[0]) modelAlias.value = sessions.models[0].alias

const profilePayload = await $fetch<{
  profile: {
    displayName: string
    adultDefaults?: { primary: string[]; excluded: string[]; contextual: string[] }
  } | null
  tasteUnlocked: boolean
  ratingsCount: number
}>('/api/private/profile/self-insert')

tasteUnlocked.value = profilePayload.tasteUnlocked
ratingsCount.value = profilePayload.ratingsCount
primary.value = [...(profilePayload.profile?.adultDefaults?.primary || [])]
excluded.value = [...(profilePayload.profile?.adultDefaults?.excluded || [])]
contextual.value = [...(profilePayload.profile?.adultDefaults?.contextual || [])]
const protagonistName = ref(profilePayload.profile?.displayName || 'Tú')

async function refreshTerms() {
  try {
    const result = await $fetch<{
      catalog: Array<{ id: string; label: string; facet: string; private: boolean }>
    }>('/api/private/terms')
    taxonomyTerms.value = result.catalog
  } catch {
    taxonomyTerms.value = DEFAULT_INTEREST_TERMS.map((term) => ({
      ...term,
      facet: term.facet,
      private: false
    }))
  }
}

await refreshTerms()

const interestCatalog = computed(() => {
  if (taxonomyTerms.value.length) return taxonomyTerms.value
  return DEFAULT_INTEREST_TERMS.map((term) => ({ ...term, private: false }))
})

const filteredTerms = computed(() => {
  const q = termFilter.value.trim().toLocaleLowerCase('es-ES')
  return interestCatalog.value
    .filter((term) => !q || `${term.label} ${term.facet}`.toLocaleLowerCase('es-ES').includes(q))
    .slice(0, 60)
})

type ExperienceOption = {
  id: string
  title: string
  premise: string
  origin: 'studio' | 'library'
  adultProfile?: string
  planSeed?: string
}

const experienceOptions = computed<ExperienceOption[]>(() => {
  const studioItems = studio.experiences.map((item) => ({
    id: item.id,
    title: item.title,
    premise: item.premise,
    origin: 'studio' as const,
    adultProfile: item.adultProfile,
    planSeed: item.planSeeds?.[0]
  }))
  const studioIds = new Set(studioItems.map((item) => item.id))
  const libraryItems = studio.libraryEntries
    .filter((item) => item.resourceType === 'experience' && !studioIds.has(item.publicationId))
    .map((item) => ({
      id: item.publicationId,
      title: item.title,
      premise: item.title,
      origin: 'library' as const
    }))
  return [...studioItems, ...libraryItems]
})

const selectedExperience = computed(() =>
  experienceOptions.value.find((item) => item.id === experienceId.value)
)

const selectedPlace = computed(() => studio.places.find((item) => item.id === placeId.value))

function playPath(format: CreatorFormat, id: string) {
  if (format === 'chat') return `/private/play/chat/${id}`
  if (format === 'vn') return `/private/play/vn/${id}`
  return `/private/play/story/${id}`
}

function setSource(next: CreationSource) {
  if (next === 'taste' && !tasteUnlocked.value) return
  source.value = next
  if (next !== 'experience') experienceId.value = ''
  if (next !== 'quick_preset') selectedPresetId.value = ''
  if (next === 'blank' || next === 'taste') {
    configuration.value = configurationForFormat('story')
  }
}

function chooseExperience(id: string) {
  const experience = experienceOptions.value.find((item) => item.id === id)
  if (!experience) return
  source.value = 'experience'
  experienceId.value = id
  selectedPresetId.value = ''
  title.value = experience.title
  premise.value = experience.premise
  if (experience.adultProfile) {
    const tone = experience.adultProfile.toLocaleLowerCase('es-ES')
    if (tone.includes('hard') || tone.includes('explíc') || tone.includes('explic')) {
      configuration.value = coherentConfiguration({ ...configuration.value, tone: 'hardcore' })
    } else if (tone.includes('rom')) {
      configuration.value = coherentConfiguration({ ...configuration.value, tone: 'romantic' })
    } else if (tone.includes('dark') || tone.includes('oscur')) {
      configuration.value = coherentConfiguration({ ...configuration.value, tone: 'dark' })
    }
  }
}

function choosePreset(id: string) {
  const preset = QUICK_PRESETS.find((item) => item.id === id)
  if (!preset) return
  source.value = 'quick_preset'
  selectedPresetId.value = id
  experienceId.value = ''
  configuration.value = coherentConfiguration(preset.config)
  premise.value = preset.premise
  title.value = preset.title
}

function chooseFormat(format: CreatorFormat) {
  configuration.value = configurationForFormat(format)
}

function updateConfig<K extends keyof StoryConfiguration>(key: K, value: StoryConfiguration[K]) {
  configuration.value = coherentConfiguration({ ...configuration.value, [key]: value })
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function classify(label: string, kind: 'primary' | 'excluded' | 'contextual') {
  primary.value = primary.value.filter((item) => item !== label)
  excluded.value = excluded.value.filter((item) => item !== label)
  contextual.value = contextual.value.filter((item) => item !== label)
  if (kind === 'primary') {
    if (primary.value.length >= 5) return
    primary.value = unique([...primary.value, label]).slice(0, 5)
  } else if (kind === 'excluded') {
    excluded.value = unique([...excluded.value, label])
  } else {
    contextual.value = unique([...contextual.value, label])
  }
}

function clearClassification(label: string) {
  primary.value = primary.value.filter((item) => item !== label)
  excluded.value = excluded.value.filter((item) => item !== label)
  contextual.value = contextual.value.filter((item) => item !== label)
}

async function addCustom(kind: 'primary' | 'excluded' | 'contextual') {
  const raw =
    kind === 'primary'
      ? customPrimary.value
      : kind === 'excluded'
        ? customExcluded.value
        : customContextual.value
  const label = raw.trim().replace(/\s+/g, ' ')
  if (!label) return
  termError.value = null
  const existing = interestCatalog.value.find(
    (term) => term.label.toLocaleLowerCase('es-ES') === label.toLocaleLowerCase('es-ES')
  )
  if (existing) {
    classify(existing.label, kind)
    if (kind === 'primary') customPrimary.value = ''
    if (kind === 'excluded') customExcluded.value = ''
    if (kind === 'contextual') customContextual.value = ''
    return
  }
  try {
    const result = await $fetch<{
      term: { id: string; label: string }
      catalog: Array<{ id: string; label: string; facet: string; private: boolean }>
    }>('/api/private/terms', {
      method: 'POST',
      body: { label, kind: 'interest' }
    })
    taxonomyTerms.value = result.catalog
    classify(result.term.label, kind)
    if (kind === 'primary') customPrimary.value = ''
    if (kind === 'excluded') customExcluded.value = ''
    if (kind === 'contextual') customContextual.value = ''
  } catch (caught) {
    termError.value =
      caught && typeof caught === 'object' && 'data' in caught
        ? String((caught as { data?: { statusMessage?: string } }).data?.statusMessage || 'No se pudo crear')
        : 'No se pudo crear el término privado'
  }
}

async function removePrivateTerm(termId: string, label: string) {
  termError.value = null
  try {
    const result = await $fetch<{
      catalog: Array<{ id: string; label: string; facet: string; private: boolean }>
    }>(`/api/private/terms?id=${encodeURIComponent(termId)}`, {
      method: 'DELETE'
    })
    taxonomyTerms.value = result.catalog
    clearClassification(label)
  } catch (caught) {
    termError.value =
      caught && typeof caught === 'object' && 'data' in caught
        ? String((caught as { data?: { statusMessage?: string } }).data?.statusMessage || 'No se pudo borrar')
        : 'No se pudo borrar el término privado'
  }
}

function toggleCharacter(id: string) {
  if (characterIds.value.includes(id)) {
    characterIds.value = characterIds.value.filter((item) => item !== id)
    return
  }
  if (characterIds.value.length >= 5) return
  characterIds.value = [...characterIds.value, id]
}

function sourceTitle() {
  if (source.value === 'experience') return selectedExperience.value?.title || 'Experience'
  if (source.value === 'style_reference') {
    return styleReference.value.trim()
      ? `Inspirada por ${styleReference.value.trim()}`
      : 'Referencia literaria'
  }
  if (source.value === 'taste') return 'Una historia a mi medida'
  if (source.value === 'quick_preset') {
    return QUICK_PRESETS.find((item) => item.id === selectedPresetId.value)?.title || 'Historia rápida'
  }
  return title.value.trim() || 'Historia sin título'
}

function canContinueStep1() {
  if (source.value === 'experience' && !experienceId.value) return false
  if (source.value === 'style_reference' && !styleReference.value.trim()) return false
  if (source.value === 'quick_preset' && !selectedPresetId.value) return false
  if (source.value === 'taste' && !tasteUnlocked.value) return false
  return true
}

async function start(fromExperienceInstant = false) {
  error.value = null
  if (!modelAlias.value) {
    error.value = 'Elige un modelo de inferencia'
    return
  }
  if (source.value === 'experience' && !experienceId.value) {
    error.value = 'Selecciona una Experience'
    return
  }
  if (source.value === 'style_reference' && !styleReference.value.trim()) {
    error.value = 'Indica un libro o autor'
    return
  }

  const cast: CreateStorySessionInput['cast'] = [
    {
      actorId: 'protagonist',
      name: protagonistName.value.trim() || 'Tú',
      role: 'protagonist',
      personality: '',
      isSelfInsert: true
    }
  ]

  for (const id of characterIds.value) {
    const character = studio.characters.find((item) => item.id === id)
    if (!character) continue
    cast.push({
      actorId: `char-${character.id.slice(0, 8)}`,
      name: character.name,
      role: 'character',
      personality: character.defaults?.personality || character.tags.join(', '),
      isSelfInsert: false,
      sourceCharacterId: character.id,
      preservedRelations: lockedRelations.value ? ['relación definida'] : []
    })
  }

  if (cast.length === 1) {
    cast.push({
      actorId: 'companion',
      name: 'Alex',
      role: 'character',
      personality: 'Directo, observador, con deseo contenido',
      isSelfInsert: false
    })
  }

  const input: CreateStorySessionInput = {
    title: sourceTitle(),
    premise:
      premise.value.trim() ||
      selectedExperience.value?.premise ||
      (styleReference.value.trim()
        ? `Historia inspirada en el estilo de ${styleReference.value.trim()}.`
        : storyDirection.value.trim() || 'Una historia privada que empieza ahora.'),
    format: configuration.value.format,
    duration: configuration.value.duration,
    tone: mapToneToSession(configuration.value.tone),
    perspective: mapPerspectiveToSession(configuration.value.perspective),
    interactionPolicy: configuration.value.interactionPolicy,
    generationProfile: configuration.value.profile,
    modelAlias: modelAlias.value,
    interests: primary.value.slice(0, 5),
    exclusions: excluded.value,
    planSummary: selectedExperience.value?.planSeed || '',
    experienceId: experienceId.value || null,
    assetPins: {
      placeId: placeId.value || null,
      placeBackgroundId: null,
      characterSprites: {}
    },
    cast,
    styleReference: styleReference.value,
    storyDirection: storyDirection.value,
    creationSource: fromExperienceInstant ? 'experience' : source.value,
    contextual: contextual.value,
    era: era.value,
    placeId: placeId.value || null
  }

  try {
    const session = await sessions.createSession(input)
    await navigateTo(playPath(session.format, session.id))
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo crear'
  }
}

function choiceList(choices: ChoiceDefinition<string>[], value: string) {
  return choices.find((item) => item.value === value) || choices[0]!
}

const perspectiveChoices = computed(() =>
  configuration.value.format === 'chat'
    ? PERSPECTIVE_CHOICES.filter((item) => item.value === 'first' || item.value === 'second')
    : PERSPECTIVE_CHOICES
)

const interactionChoices = computed(() =>
  configuration.value.format === 'chat'
    ? INTERACTION_CHOICES.filter((item) => item.value !== 'non_interactive')
    : INTERACTION_CHOICES
)

const route = useRoute()
if (typeof route.query.experience === 'string' && route.query.experience) {
  chooseExperience(route.query.experience)
  step.value = 1
}
</script>

<template>
  <div class="nsfw-page creator-shell mx-auto max-w-5xl px-3 py-6 sm:px-6 sm:py-8">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.22em] text-[var(--nsfw-faint)]">
        Crear · paso {{ step }}/2
      </p>
      <h1 class="font-serif text-3xl sm:text-4xl">Nueva historia</h1>
      <p class="mt-2 max-w-2xl text-sm text-[var(--nsfw-muted)]">
        Elige un origen, revisa las opciones recomendadas y arranca. El formato queda fijado para
        esta sesión.
      </p>
    </header>

    <nav class="create-progress mb-6" aria-label="Progreso de creación">
      <button
        type="button"
        class="create-progress-step"
        :class="step === 1 ? 'current' : 'complete'"
        aria-current="step"
        @click="step = 1"
      >
        <span>1</span> Origen
      </button>
      <button
        type="button"
        class="create-progress-step"
        :class="step === 2 ? 'current' : step > 2 ? 'complete' : 'pending'"
        :disabled="step < 2"
        @click="step = 2"
      >
        <span>2</span> Configuración
      </button>
    </nav>

    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]" role="alert">{{ error }}</p>

    <section v-if="step === 1" class="space-y-6" aria-labelledby="creator-step-one">
      <div>
        <h2 id="creator-step-one" class="font-serif text-2xl">¿Qué clase de comienzo quieres?</h2>
        <p class="mt-1 text-sm text-[var(--nsfw-muted)]">
          Cargaremos una configuración completa que podrás aceptar o ajustar.
        </p>
      </div>

      <div class="source-grid">
        <button
          type="button"
          class="source-card"
          :class="source === 'blank' ? 'selected' : ''"
          :aria-pressed="source === 'blank'"
          @click="setSource('blank')"
        >
          <strong>Desde cero</strong>
          <span>Página en blanco con recomendaciones equilibradas.</span>
        </button>
        <button
          type="button"
          class="source-card"
          :class="source === 'experience' ? 'selected' : ''"
          :aria-pressed="source === 'experience'"
          @click="setSource('experience')"
        >
          <strong>Elegir Experience</strong>
          <span>De tu Studio o Biblioteca. Premisa y valores ya preparados.</span>
        </button>
        <button
          type="button"
          class="source-card"
          :class="source === 'style_reference' ? 'selected' : ''"
          :aria-pressed="source === 'style_reference'"
          @click="setSource('style_reference')"
        >
          <strong>Una historia del estilo de…</strong>
          <span>Libro o autor como referencia de ritmo y atmósfera para el plan.</span>
        </button>
        <button
          type="button"
          class="source-card"
          :class="[source === 'taste' ? 'selected' : '', !tasteUnlocked ? 'disabled' : '']"
          :aria-pressed="source === 'taste'"
          :disabled="!tasteUnlocked"
          :title="
            tasteUnlocked
              ? 'Basada en tus valoraciones'
              : `Necesitas al menos ${MIN_TASTE_RATINGS} valoraciones (${ratingsCount}/${MIN_TASTE_RATINGS})`
          "
          @click="setSource('taste')"
        >
          <strong>De las que me gustan</strong>
          <span v-if="tasteUnlocked">Aprende de tus valoraciones sin copiar prosa.</span>
          <span v-else>
            Desactivada hasta {{ MIN_TASTE_RATINGS }} valoraciones ({{ ratingsCount }}/{{
              MIN_TASTE_RATINGS
            }}).
          </span>
        </button>
      </div>

      <div v-if="source === 'experience'" class="source-detail" aria-live="polite">
        <p class="eyebrow">Studio y Biblioteca</p>
        <div v-if="experienceOptions.length" class="experience-picker">
          <button
            v-for="item in experienceOptions"
            :key="item.id"
            type="button"
            class="library-choice"
            :class="experienceId === item.id ? 'selected' : ''"
            :aria-pressed="experienceId === item.id"
            @click="chooseExperience(item.id)"
          >
            <strong>{{ item.title }}</strong>
            <span>{{ item.premise }}</span>
            <small>{{ item.origin === 'studio' ? 'Studio' : 'Biblioteca' }}</small>
          </button>
        </div>
        <p v-else class="text-sm text-[var(--nsfw-muted)]">
          Añade Experiences en Studio o al Hub/Biblioteca para usarlas aquí.
        </p>
        <div v-if="selectedExperience" class="instant-start">
          <div>
            <strong>Configuración lista</strong>
            <p class="text-sm text-[var(--nsfw-muted)]">
              {{ choiceList(FORMAT_CHOICES, configuration.format).label }} ·
              {{ choiceList(DURATION_CHOICES, configuration.duration).label }} ·
              {{ choiceList(TONE_CHOICES, configuration.tone).label }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="nsfw-btn-primary"
              :disabled="sessions.loading"
              @click="start(true)"
            >
              Empezar ahora
            </button>
            <button type="button" class="nsfw-btn-ghost" @click="step = 2">Revisar y editar</button>
          </div>
        </div>
      </div>

      <div v-if="source === 'style_reference'" class="source-detail">
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Libro o autor de referencia</span>
          <input
            v-model="styleReference"
            class="nsfw-input w-full"
            maxlength="200"
            placeholder="Ej. una novela, saga o autor"
          >
          <small class="mt-2 block text-xs text-[var(--nsfw-faint)]">
            Se usa como referencia de ritmo y atmósfera para el plan. No se copian frases ni una voz
            autoral reconocible. El formato se elige en el paso 2.
          </small>
        </label>
      </div>

      <div class="quick-preset-block">
        <div>
          <p class="eyebrow">Atajos coherentes</p>
          <h3 class="font-serif text-xl">Historias rápidas</h3>
          <p class="text-sm text-[var(--nsfw-muted)]">
            Combinaciones pensadas para llegar antes al primer beat.
          </p>
        </div>
        <div class="preset-grid">
          <button
            v-for="preset in QUICK_PRESETS"
            :key="preset.id"
            type="button"
            class="preset-card"
            :class="[preset.accent, selectedPresetId === preset.id ? 'selected' : '']"
            :aria-pressed="selectedPresetId === preset.id"
            @click="choosePreset(preset.id)"
          >
            <strong>{{ preset.title }}</strong>
            <span>{{ preset.description }}</span>
          </button>
        </div>
      </div>

      <div class="creator-footer">
        <span class="text-xs text-[var(--nsfw-faint)]">
          Las opciones avanzadas aparecen desplegadas en el paso 2.
        </span>
        <button
          type="button"
          class="nsfw-btn-primary"
          :disabled="!canContinueStep1()"
          @click="step = 2"
        >
          Continuar
        </button>
      </div>
    </section>

    <section v-else class="space-y-5" aria-labelledby="creator-step-two">
      <div>
        <h2 id="creator-step-two" class="font-serif text-2xl">Opciones avanzadas</h2>
        <p class="mt-1 text-sm text-[var(--nsfw-muted)]">
          Valores recomendados para tu formato y origen. Cada elección explica cómo afecta.
        </p>
        <div class="recommendation-stamp mt-3">
          <strong>Precargado para ti.</strong>
          Intereses desde tu perfil; Experience o preset pueden añadir recomendaciones.
        </div>
      </div>

      <section class="configuration-card space-y-4">
        <h3 class="font-serif text-xl">01 · Forma de contarla</h3>

        <fieldset class="choice-fieldset">
          <legend>Formato</legend>
          <div class="choice-pills">
            <button
              v-for="choice in FORMAT_CHOICES"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.format === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.format === choice.value"
              @click="chooseFormat(choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>{{ choiceList(FORMAT_CHOICES, configuration.format).label }}:</strong>
            {{ choiceList(FORMAT_CHOICES, configuration.format).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Perspectiva</legend>
          <div class="choice-pills">
            <button
              v-for="choice in perspectiveChoices"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.perspective === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.perspective === choice.value"
              @click="updateConfig('perspective', choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>{{ choiceList(PERSPECTIVE_CHOICES, configuration.perspective).label }}:</strong>
            {{ choiceList(PERSPECTIVE_CHOICES, configuration.perspective).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Duración</legend>
          <div class="choice-pills">
            <button
              v-for="choice in DURATION_CHOICES"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.duration === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.duration === choice.value"
              @click="updateConfig('duration', choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>{{ choiceList(DURATION_CHOICES, configuration.duration).label }}:</strong>
            {{ choiceList(DURATION_CHOICES, configuration.duration).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Ritmo de generación</legend>
          <div class="choice-pills">
            <button
              v-for="choice in PROFILE_CHOICES"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.profile === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.profile === choice.value"
              @click="updateConfig('profile', choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>{{ choiceList(PROFILE_CHOICES, configuration.profile).label }}:</strong>
            {{ choiceList(PROFILE_CHOICES, configuration.profile).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Tono</legend>
          <div class="choice-pills">
            <button
              v-for="choice in TONE_CHOICES"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.tone === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.tone === choice.value"
              @click="updateConfig('tone', choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>{{ choiceList(TONE_CHOICES, configuration.tone).label }}:</strong>
            {{ choiceList(TONE_CHOICES, configuration.tone).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Interacción</legend>
          <div class="choice-pills">
            <button
              v-for="choice in interactionChoices"
              :key="choice.value"
              type="button"
              class="choice-pill"
              :class="configuration.interactionPolicy === choice.value ? 'selected' : ''"
              :aria-pressed="configuration.interactionPolicy === choice.value"
              @click="updateConfig('interactionPolicy', choice.value)"
            >
              {{ choice.label }}
            </button>
          </div>
          <p class="choice-description">
            <strong>
              {{ choiceList(INTERACTION_CHOICES, configuration.interactionPolicy).label }}:
            </strong>
            {{ choiceList(INTERACTION_CHOICES, configuration.interactionPolicy).description }}
          </p>
        </fieldset>

        <fieldset class="choice-fieldset">
          <legend>Modelo de inferencia · LM Studio</legend>
          <div class="model-choice-grid">
            <button
              v-for="model in sessions.models"
              :key="model.alias"
              type="button"
              class="model-choice"
              :class="modelAlias === model.alias ? 'selected' : ''"
              :aria-pressed="modelAlias === model.alias"
              @click="modelAlias = model.alias"
            >
              <strong>{{ model.alias }}</strong>
              <code>{{ model.lmStudioModelId }}</code>
              <span class="text-xs text-[var(--nsfw-faint)]">
                {{ model.available ? 'Disponible / listo' : 'No detectado en LM Studio' }}
              </span>
            </button>
          </div>
        </fieldset>
      </section>

      <section class="configuration-card space-y-4">
        <h3 class="font-serif text-xl">02 · Personajes, lugar y época</h3>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Nombre del protagonista</span>
          <input v-model="protagonistName" class="nsfw-input w-full">
        </label>
        <fieldset class="asset-fieldset">
          <legend>Personajes (máx. 5)</legend>
          <div class="asset-pills">
            <button
              v-for="character in studio.characters"
              :key="character.id"
              type="button"
              class="asset-pill"
              :class="characterIds.includes(character.id) ? 'selected' : ''"
              :aria-pressed="characterIds.includes(character.id)"
              :disabled="!characterIds.includes(character.id) && characterIds.length >= 5"
              @click="toggleCharacter(character.id)"
            >
              {{ character.name }}
            </button>
            <span v-if="!studio.characters.length" class="text-sm text-[var(--nsfw-muted)]">
              Sin personajes en Studio; la IA propondrá el reparto.
            </span>
          </div>
        </fieldset>
        <fieldset class="asset-fieldset">
          <legend>Lugar</legend>
          <div class="asset-pills">
            <button
              type="button"
              class="asset-pill"
              :class="!placeId ? 'selected' : ''"
              :aria-pressed="!placeId"
              @click="placeId = ''"
            >
              Que lo defina la IA
            </button>
            <button
              v-for="place in studio.places"
              :key="place.id"
              type="button"
              class="asset-pill"
              :class="placeId === place.id ? 'selected' : ''"
              :aria-pressed="placeId === place.id"
              @click="
                placeId = place.id;
                era = place.era || era
              "
            >
              {{ place.name }}
            </button>
          </div>
          <p v-if="selectedPlace" class="asset-description">
            {{ selectedPlace.setting }} · {{ selectedPlace.era }}
          </p>
        </fieldset>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Época</span>
          <input v-model="era" class="nsfw-input w-full" maxlength="120" placeholder="Ej. Madrid, 1998">
        </label>
        <label class="relationship-toggle">
          <input v-model="lockedRelations" type="checkbox">
          <span>
            <strong>Preservar relaciones definidas</strong>
            <small>Si está desactivado, cada historia puede inventar las relaciones.</small>
          </span>
        </label>
      </section>

      <section class="configuration-card space-y-4">
        <h3 class="font-serif text-xl">03 · Intereses y límites</h3>
        <p class="text-sm text-[var(--nsfw-muted)]">
          Se han precargado desde tu perfil. Puedes cambiarlos solo para esta historia.
        </p>
        <div class="interest-legend">
          <span class="positive">Predominante · máx. 5</span>
          <span class="negative">Excluir · nunca</span>
          <span class="contextual">Permitido si encaja</span>
        </div>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Buscar</span>
          <input v-model="termFilter" class="nsfw-input w-full" placeholder="Filtra por nombre">
        </label>
        <div class="term-matrix">
          <article v-for="term in filteredTerms" :key="term.id">
            <div>
              <strong>{{ term.label }}</strong>
              <small>{{ term.private ? 'privado' : term.facet }}</small>
            </div>
            <div>
              <button
                type="button"
                class="term-action positive"
                :class="primary.includes(term.label) ? 'selected' : ''"
                :aria-pressed="primary.includes(term.label)"
                @click="classify(term.label, 'primary')"
              >
                Preferir
              </button>
              <button
                type="button"
                class="term-action negative"
                :class="excluded.includes(term.label) ? 'selected' : ''"
                :aria-pressed="excluded.includes(term.label)"
                @click="classify(term.label, 'excluded')"
              >
                Excluir
              </button>
              <button
                type="button"
                class="term-action contextual"
                :class="contextual.includes(term.label) ? 'selected' : ''"
                :aria-pressed="contextual.includes(term.label)"
                @click="classify(term.label, 'contextual')"
              >
                Permitir
              </button>
              <button
                v-if="term.private"
                type="button"
                class="term-action delete"
                title="Eliminar término privado"
                @click="removePrivateTerm(term.id, term.label)"
              >
                ×
              </button>
            </div>
          </article>
        </div>
        <p v-if="termError" class="text-sm text-[var(--nsfw-danger)]">{{ termError }}</p>
        <p class="contextual-explainer">
          <strong>¿Qué significa “permitido si encaja”?</strong>
          No pide a la IA que lo incluya. Solo indica que puede aparecer cuando resulte natural.
          Al crear una etiqueta nueva queda como <em>privado</em> (solo tú) y se suma a la lista permanente.
        </p>
        <div class="custom-interest-grid">
          <label>
            Crear predominante privado
            <span>
              <input
                v-model="customPrimary"
                class="nsfw-input"
                maxlength="80"
                placeholder="Etiqueta solo tuya"
                @keydown.enter.prevent="addCustom('primary')"
              >
              <button type="button" class="nsfw-btn-ghost" @click="addCustom('primary')">+</button>
            </span>
          </label>
          <label>
            Crear exclusión privada
            <span>
              <input
                v-model="customExcluded"
                class="nsfw-input"
                maxlength="80"
                @keydown.enter.prevent="addCustom('excluded')"
              >
              <button type="button" class="nsfw-btn-ghost" @click="addCustom('excluded')">+</button>
            </span>
          </label>
          <label>
            Crear permitido privado
            <span>
              <input
                v-model="customContextual"
                class="nsfw-input"
                maxlength="80"
                @keydown.enter.prevent="addCustom('contextual')"
              >
              <button type="button" class="nsfw-btn-ghost" @click="addCustom('contextual')">+</button>
            </span>
          </label>
        </div>
        <div class="custom-pills">
          <button
            v-for="label in primary"
            :key="`p-${label}`"
            type="button"
            class="pill positive"
            @click="primary = primary.filter((item) => item !== label)"
          >
            {{ label }} ×
          </button>
          <button
            v-for="label in excluded"
            :key="`e-${label}`"
            type="button"
            class="pill negative"
            @click="excluded = excluded.filter((item) => item !== label)"
          >
            {{ label }} ×
          </button>
          <button
            v-for="label in contextual"
            :key="`c-${label}`"
            type="button"
            class="pill contextual"
            @click="contextual = contextual.filter((item) => item !== label)"
          >
            {{ label }} ×
          </button>
        </div>
      </section>

      <section class="configuration-card space-y-3">
        <h3 class="font-serif text-xl">04 · Premisa y dirección</h3>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Título</span>
          <input v-model="title" class="nsfw-input w-full" placeholder="Opcional">
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Premisa</span>
          <textarea
            v-model="premise"
            class="nsfw-input min-h-28 w-full"
            placeholder="Qué ocurre, con quién, qué tensión abre la escena"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Prompt de dirección</span>
          <textarea
            v-model="storyDirection"
            class="nsfw-input min-h-28 w-full"
            maxlength="2000"
            placeholder="Orientar, sugerir o aclarar: ritmo, secreto, tono de la apertura…"
          />
          <small class="mt-1 block text-xs text-[var(--nsfw-faint)]">
            Se incorpora al plan privado de esta historia.
          </small>
        </label>
      </section>

      <div class="creator-footer">
        <button type="button" class="nsfw-btn-ghost" @click="step = 1">Volver al origen</button>
        <button
          type="button"
          class="nsfw-btn-primary"
          :disabled="sessions.loading"
          @click="start(false)"
        >
          {{ sessions.loading ? 'Creando…' : 'Empezar historia' }}
        </button>
      </div>
    </section>
  </div>
</template>
