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
  MAX_PRIMARY_INTERESTS,
  MIN_TASTE_RATINGS,
  PERSPECTIVE_CHOICES,
  PROFILE_CHOICES,
  QUICK_PRESETS,
  sessionPlayPath,
  sortInterestTerms,
  TONE_CHOICES,
  type ChoiceDefinition,
  type CreationSource,
  type CreatorFormat,
  type NarrativePerspective,
  type StoryConfiguration
} from '../../../shared/lib/nsfwCreatorConfig.ts'

definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()
const step = ref<1 | 2 | 3>(1)
const error = ref<string | null>(null)
const source = ref<CreationSource>('blank')
const configuration = ref<StoryConfiguration>(configurationForFormat('story'))
const modelAlias = ref('')
const modelOpen = ref(false)
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
const customLabel = ref('')
const saveToProfile = ref(false)
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
    pronouns: string
    appearance: string
    boundaries: string[]
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
  const matching = interestCatalog.value.filter(
    (term) => !q || `${term.label} ${term.facet}`.toLocaleLowerCase('es-ES').includes(q)
  )
  return sortInterestTerms(matching, {
    primary: primary.value,
    excluded: excluded.value,
    contextual: contextual.value
  }).slice(0, 80)
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

type HubPick = { id: string; title: string; ownerUsername: string }

const hubCharacters = ref<HubPick[]>([])
const hubPlaces = ref<HubPick[]>([])
const importing = ref('')

/** Personajes y lugares publicados por cualquiera, para no depender solo del Studio propio. */
async function loadHubPicks() {
  const [characters, places] = await Promise.all([
    $fetch<{ listings: HubPick[] }>('/api/private/hub', { query: { type: 'character' } }).catch(
      () => ({ listings: [] as HubPick[] })
    ),
    $fetch<{ listings: HubPick[] }>('/api/private/hub', { query: { type: 'place' } }).catch(() => ({
      listings: [] as HubPick[]
    }))
  ])
  hubCharacters.value = characters.listings
  hubPlaces.value = places.listings
}

await loadHubPicks()

/** Oculta lo que ya existe en el Studio propio con el mismo nombre. */
const availableHubCharacters = computed(() => {
  const mine = new Set(studio.characters.map((item) => item.name.toLocaleLowerCase('es-ES')))
  return hubCharacters.value.filter((item) => !mine.has(item.title.toLocaleLowerCase('es-ES')))
})

const availableHubPlaces = computed(() => {
  const mine = new Set(studio.places.map((item) => item.name.toLocaleLowerCase('es-ES')))
  return hubPlaces.value.filter((item) => !mine.has(item.title.toLocaleLowerCase('es-ES')))
})

async function useHubCharacter(publicationId: string) {
  importing.value = publicationId
  error.value = null
  try {
    const result = await studio.importFromHub(publicationId)
    if (result.character) toggleCharacter(result.character.id)
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo copiar el personaje'
  } finally {
    importing.value = ''
  }
}

async function useHubPlace(publicationId: string) {
  importing.value = publicationId
  error.value = null
  try {
    const result = await studio.importFromHub(publicationId)
    if (result.place) {
      placeId.value = result.place.id
      era.value = result.place.era || era.value
    }
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo copiar el lugar'
  } finally {
    importing.value = ''
  }
}

const selectedPlace = computed(() => studio.places.find((item) => item.id === placeId.value))

const selectedModel = computed(() => sessions.models.find((item) => item.alias === modelAlias.value))

const selectedCharacters = computed(() =>
  characterIds.value
    .map((id) => studio.characters.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
)

function choiceList(choices: ChoiceDefinition<string>[], value: string) {
  return choices.find((item) => item.value === value) || choices[0]!
}

/** Frase única que resume la configuración actual en la columna derecha. */
const livePitch = computed(() => {
  const lower = (choices: ChoiceDefinition<string>[], value: string) =>
    choiceList(choices, value).label.toLocaleLowerCase('es-ES')
  return (
    `Una ${lower(FORMAT_CHOICES, configuration.value.format)} de tono ${lower(TONE_CHOICES, configuration.value.tone)}, ` +
    `duración ${lower(DURATION_CHOICES, configuration.value.duration)} y ${lower(PERSPECTIVE_CHOICES, configuration.value.perspective)}.`
  )
})

/** Migaja del paso 1: de dónde sale la historia, no cómo se titula. */
const sourceLabel = computed(() => {
  if (source.value === 'experience') return selectedExperience.value?.title || 'Experience'
  if (source.value === 'style_reference') return styleReference.value.trim() || 'Referencia'
  if (source.value === 'taste') return 'De las que me gustan'
  if (source.value === 'quick_preset') {
    return QUICK_PRESETS.find((item) => item.id === selectedPresetId.value)?.title || 'Atajo'
  }
  return 'Desde cero'
})

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

/** Los atajos dejan todo resuelto, pero siguen siendo editables desde el paso 2. */
function choosePreset(id: string) {
  const preset = QUICK_PRESETS.find((item) => item.id === id)
  if (!preset) return
  source.value = 'quick_preset'
  selectedPresetId.value = id
  experienceId.value = ''
  configuration.value = coherentConfiguration(preset.config)
  premise.value = preset.premise
  title.value = preset.title
  step.value = 2
}

function onPerspective(event: Event) {
  const value = (event.target as HTMLSelectElement).value as NarrativePerspective
  updateConfig('perspective', value)
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

const primaryFull = computed(() => primary.value.length >= MAX_PRIMARY_INTERESTS)

function classify(label: string, kind: 'primary' | 'excluded' | 'contextual') {
  const wasSelected =
    kind === 'primary'
      ? primary.value.includes(label)
      : kind === 'excluded'
        ? excluded.value.includes(label)
        : contextual.value.includes(label)
  clearClassification(label)
  if (wasSelected) return
  if (kind === 'primary') {
    if (primary.value.length >= MAX_PRIMARY_INTERESTS) return
    primary.value = unique([...primary.value, label]).slice(0, MAX_PRIMARY_INTERESTS)
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

async function addCustom() {
  const label = customLabel.value.trim().replace(/\s+/g, ' ')
  if (!label) return
  termError.value = null
  const existing = interestCatalog.value.find(
    (term) => term.label.toLocaleLowerCase('es-ES') === label.toLocaleLowerCase('es-ES')
  )
  if (existing) {
    termFilter.value = existing.label
    customLabel.value = ''
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
    termFilter.value = result.term.label
    customLabel.value = ''
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
    interests: primary.value.slice(0, MAX_PRIMARY_INTERESTS),
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
    if (saveToProfile.value) await persistProfileDefaults()
    const session = await sessions.createSession(input)
    await navigateTo(sessionPlayPath(session.format, session.id))
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo crear'
  }
}

/** «Guardar también en mi perfil»: por defecto lo de aquí solo vale para esta historia. */
async function persistProfileDefaults() {
  await $fetch('/api/private/profile/self-insert', {
    method: 'POST',
    body: {
      displayName: profilePayload.profile?.displayName || protagonistName.value,
      pronouns: profilePayload.profile?.pronouns || '',
      appearance: profilePayload.profile?.appearance || '',
      boundaries: profilePayload.profile?.boundaries || [],
      adultDefaults: {
        primary: primary.value.slice(0, MAX_PRIMARY_INTERESTS),
        excluded: excluded.value,
        contextual: contextual.value
      }
    }
  })
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
}
if (typeof route.query.preset === 'string' && route.query.preset) {
  choosePreset(route.query.preset)
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-[70rem] px-5 py-9 sm:px-12 sm:py-12">
    <!-- Progreso: origen → forma de contarla → intereses y límites -->
    <nav class="nsfw-steps mb-5" aria-label="Progreso de creación">
      <button
        type="button"
        :class="step === 1 ? 'is-current' : 'is-done'"
        :aria-current="step === 1 ? 'step' : undefined"
        @click="step = 1"
      >
        <i>{{ step > 1 ? '✓' : '1' }}</i> Origen
      </button>
      <hr>
      <button
        type="button"
        :class="step === 2 ? 'is-current' : step > 2 ? 'is-done' : ''"
        :aria-current="step === 2 ? 'step' : undefined"
        @click="step = 2"
      >
        <i>{{ step > 2 ? '✓' : '2' }}</i> Forma de contarla
      </button>
      <hr>
      <button
        type="button"
        :class="step === 3 ? 'is-current' : ''"
        :aria-current="step === 3 ? 'step' : undefined"
        @click="step = 3"
      >
        <i>3</i> Intereses y límites
      </button>
      <span v-if="step > 1" class="ml-auto text-xs text-[var(--nsfw-dim)]">
        Origen: {{ sourceLabel }}
      </span>
    </nav>

    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]" role="alert">{{ error }}</p>

    <!-- ============================ PASO 1 · ORIGEN -->
    <section v-if="step === 1" aria-labelledby="creator-step-one">
      <h1 id="creator-step-one" class="mb-1.5 font-serif text-4xl">
        ¿Qué clase de comienzo quieres?
      </h1>
      <p class="mb-8 max-w-[58ch] font-serif text-[1.05rem] italic leading-relaxed text-[var(--nsfw-muted)]">
        Cada origen precarga una configuración completa. Podrás revisarla entera en el paso
        siguiente.
      </p>

      <div class="nsfw-hairgrid mb-8 md:grid-cols-2">
        <button
          type="button"
          class="nsfw-cell"
          :class="source === 'blank' ? 'selected' : ''"
          :aria-pressed="source === 'blank'"
          @click="setSource('blank')"
        >
          <strong>Desde cero</strong>
          <span>
            Página en blanco con recomendaciones equilibradas. Tú eliges reparto, lugar y tono.
          </span>
        </button>
        <button
          type="button"
          class="nsfw-cell"
          :class="source === 'experience' ? 'selected' : ''"
          :aria-pressed="source === 'experience'"
          @click="setSource('experience')"
        >
          <strong>Elegir una Experience</strong>
          <span>De tu Studio o guardada del Hub. Premisa, reparto y reglas ya preparados.</span>
        </button>
        <button
          type="button"
          class="nsfw-cell"
          :class="source === 'style_reference' ? 'selected' : ''"
          :aria-pressed="source === 'style_reference'"
          @click="setSource('style_reference')"
        >
          <strong>Una historia del estilo de…</strong>
          <span>
            Un libro o autor como referencia de ritmo y atmósfera. No se copian frases ni voz
            autoral.
          </span>
        </button>
        <button
          type="button"
          class="nsfw-cell"
          :class="source === 'taste' ? 'selected' : ''"
          :aria-pressed="source === 'taste'"
          :disabled="!tasteUnlocked"
          @click="setSource('taste')"
        >
          <strong>De las que me gustan</strong>
          <span>Aprende de tus valoraciones sin copiar prosa.</span>
          <span v-if="!tasteUnlocked" class="mt-2 flex items-center gap-2.5">
            <span class="h-[3px] w-20 overflow-hidden rounded-full bg-[rgba(238,224,212,0.12)]">
              <span
                class="block h-full bg-[var(--nsfw-gold)]"
                :style="{ width: `${Math.min(100, (ratingsCount / MIN_TASTE_RATINGS) * 100)}%` }"
              />
            </span>
            <span class="text-[0.7rem] text-[var(--nsfw-dim)]">
              {{ ratingsCount }} de {{ MIN_TASTE_RATINGS }} valoraciones
            </span>
          </span>
        </button>
      </div>

      <div v-if="source === 'experience'" class="mb-8" aria-live="polite">
        <div class="nsfw-section-head">
          <h3>Studio y biblioteca</h3>
        </div>
        <template v-if="experienceOptions.length">
          <button
            v-for="item in experienceOptions"
            :key="item.id"
            type="button"
            class="nsfw-row"
            :class="experienceId === item.id ? 'text-[var(--nsfw-accent)]' : ''"
            :aria-pressed="experienceId === item.id"
            @click="chooseExperience(item.id)"
          >
            <span class="nsfw-row-kind text-[var(--nsfw-faint)]">
              {{ item.origin === 'studio' ? 'Studio' : 'Bibl.' }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="nsfw-row-title block truncate">{{ item.title }}</span>
              <span class="nsfw-row-sub block">{{ item.premise }}</span>
            </span>
            <span v-if="experienceId === item.id" class="nsfw-row-meta">Elegida</span>
          </button>
        </template>
        <p v-else class="py-6 text-sm text-[var(--nsfw-muted)]">
          Añade Experiences en Studio o guárdalas del Hub para usarlas aquí.
        </p>

        <div
          v-if="selectedExperience"
          class="mt-5 flex flex-wrap items-end justify-between gap-5 border-t border-[var(--nsfw-line)] pt-5"
        >
          <div class="min-w-[14rem] flex-1">
            <p class="nsfw-eyebrow">Configuración lista</p>
            <p class="mb-3 text-sm text-[var(--nsfw-muted)]">
              {{ choiceList(FORMAT_CHOICES, configuration.format).label }} ·
              {{ choiceList(DURATION_CHOICES, configuration.duration).label }} ·
              {{ choiceList(TONE_CHOICES, configuration.tone).label }}
            </p>
            <label class="block max-w-xs">
              <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-1.5 block">Modelo LM Studio</span>
              <select v-model="modelAlias" class="nsfw-underline !text-base">
                <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
                  {{ model.alias }}{{ model.available ? '' : ' (no detectado)' }}
                </option>
              </select>
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-5">
            <button type="button" class="nsfw-btn-text" @click="step = 2">Revisar y editar</button>
            <button
              type="button"
              class="nsfw-btn-primary"
              :disabled="sessions.loading || !modelAlias"
              @click="start(true)"
            >
              Empezar ahora
            </button>
          </div>
        </div>
      </div>

      <div v-if="source === 'style_reference'" class="mb-8 max-w-xl">
        <label class="block">
          <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Libro o autor de referencia</span>
          <input
            v-model="styleReference"
            class="nsfw-underline"
            maxlength="200"
            placeholder="Ej. una novela, saga o autor"
          >
        </label>
        <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-dim)]">
          Se usa como referencia de ritmo y atmósfera para el plan. No se copian frases ni una voz
          autoral reconocible. El formato se elige en el paso 2.
        </p>
      </div>

      <div class="nsfw-section-head">
        <h3>O empieza con un atajo</h3>
        <span class="text-xs text-[var(--nsfw-dim)]">
          dejan todo resuelto; puedes revisarlo en los pasos siguientes
        </span>
      </div>
      <div class="nsfw-hairgrid mb-8 sm:grid-cols-2 lg:grid-cols-4">
        <button
          v-for="preset in QUICK_PRESETS"
          :key="preset.id"
          type="button"
          class="nsfw-cell"
          :class="selectedPresetId === preset.id ? 'selected' : ''"
          :aria-pressed="selectedPresetId === preset.id"
          @click="choosePreset(preset.id)"
        >
          <strong class="!text-lg">{{ preset.title }}</strong>
          <span>{{ preset.description }}</span>
        </button>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-4">
        <span class="text-xs text-[var(--nsfw-dim)]">
          Nada de esto es definitivo salvo el formato.
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

    <!-- ============================ PASO 2 · FORMA DE CONTARLA -->
    <section v-else-if="step === 2" aria-labelledby="creator-step-two">
      <h1 id="creator-step-two" class="mb-1.5 font-serif text-4xl">Cómo quieres que se cuente</h1>
      <p class="mb-9 max-w-[56ch] font-serif text-[1.05rem] italic leading-relaxed text-[var(--nsfw-muted)]">
        Todo viene precargado desde tu perfil. Cambia lo que quieras; lo demás se ajusta solo.
      </p>

      <div class="flex flex-col gap-10 lg:flex-row lg:gap-14">
        <div class="flex min-w-0 flex-1 flex-col gap-8">
          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Formato</legend>
            <div class="nsfw-hairgrid sm:grid-cols-3">
              <button
                v-for="choice in FORMAT_CHOICES"
                :key="choice.value"
                type="button"
                class="nsfw-cell"
                :class="configuration.format === choice.value ? 'selected' : ''"
                :aria-pressed="configuration.format === choice.value"
                @click="chooseFormat(choice.value)"
              >
                <strong class="!text-lg">{{ choice.label }}</strong>
              </button>
            </div>
            <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-faint)]">
              {{ choiceList(FORMAT_CHOICES, configuration.format).description }}
              El formato queda fijado para esta sesión.
            </p>
          </fieldset>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Tono</legend>
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
            <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-faint)]">
              {{ choiceList(TONE_CHOICES, configuration.tone).description }}
            </p>
          </fieldset>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Duración</legend>
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
            <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-faint)]">
              {{ choiceList(DURATION_CHOICES, configuration.duration).description }}
            </p>
          </fieldset>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Interacción</legend>
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
            <p class="mt-3 text-xs leading-relaxed text-[var(--nsfw-faint)]">
              {{ choiceList(INTERACTION_CHOICES, configuration.interactionPolicy).description }}
            </p>
          </fieldset>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Reparto · máx. 5</legend>
            <div class="asset-pills mb-3">
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
              <NuxtLink
                to="/private/studio/characters"
                class="asset-pill border-dashed !text-[var(--nsfw-dim)]"
              >
                + Crear personaje
              </NuxtLink>
              <span v-if="!studio.characters.length" class="text-sm text-[var(--nsfw-muted)]">
                Sin personajes en Studio; la IA propondrá el reparto.
              </span>
            </div>
            <div v-if="availableHubCharacters.length" class="mb-3">
              <p class="nsfw-eyebrow nsfw-eyebrow--dim">Publicados en el Hub</p>
              <div class="asset-pills">
                <button
                  v-for="item in availableHubCharacters"
                  :key="item.id"
                  type="button"
                  class="asset-pill"
                  :disabled="importing === item.id || characterIds.length >= 5"
                  :title="`De ${item.ownerUsername}. Se copia a tu Studio al elegirlo.`"
                  @click="useHubCharacter(item.id)"
                >
                  {{ importing === item.id ? 'Copiando…' : `+ ${item.title}` }}
                </button>
              </div>
            </div>
            <label class="flex items-center gap-2.5 text-xs text-[var(--nsfw-faint)]">
              <input
                v-model="lockedRelations"
                type="checkbox"
                class="accent-[var(--nsfw-accent)]"
              >
              Preservar las relaciones ya definidas entre ellos
            </label>
          </fieldset>

          <div class="grid gap-7 sm:grid-cols-2">
            <fieldset class="border-0 p-0">
              <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Lugar</legend>
              <div class="asset-pills">
                <button
                  type="button"
                  class="asset-pill"
                  :class="!placeId ? 'selected' : ''"
                  :aria-pressed="!placeId"
                  @click="placeId = ''"
                >
                  Que lo elija la IA
                </button>
                <button
                  v-for="place in studio.places"
                  :key="place.id"
                  type="button"
                  class="asset-pill"
                  :class="placeId === place.id ? 'selected' : ''"
                  :aria-pressed="placeId === place.id"
                  @click="placeId = place.id; era = place.era || era"
                >
                  {{ place.name }}
                </button>
              </div>
              <div v-if="availableHubPlaces.length" class="mt-3">
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Publicados en el Hub</p>
                <div class="asset-pills">
                  <button
                    v-for="item in availableHubPlaces"
                    :key="item.id"
                    type="button"
                    class="asset-pill"
                    :disabled="importing === item.id"
                    :title="`De ${item.ownerUsername}. Se copia a tu Studio al elegirlo.`"
                    @click="useHubPlace(item.id)"
                  >
                    {{ importing === item.id ? 'Copiando…' : `+ ${item.title}` }}
                  </button>
                </div>
              </div>
              <p v-if="selectedPlace" class="mt-2.5 text-xs text-[var(--nsfw-dim)]">
                {{ selectedPlace.setting }} · {{ selectedPlace.era }}
              </p>
            </fieldset>

            <label class="block">
              <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-3 block">Época</span>
              <input v-model="era" class="nsfw-underline" maxlength="120" placeholder="Ej. Madrid, 1998">
              <span class="mt-2.5 block text-xs text-[var(--nsfw-dim)]">
                Heredada del lugar. Puedes escribir otra.
              </span>
            </label>
          </div>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Tú, en esta historia</legend>
            <div class="grid gap-5 sm:grid-cols-2">
              <label class="block">
                <input v-model="protagonistName" class="nsfw-underline">
                <span class="mt-2.5 block text-xs text-[var(--nsfw-dim)]">
                  Nombre del protagonista
                </span>
              </label>
              <label class="block">
                <select
                  :value="configuration.perspective"
                  class="nsfw-underline !text-base"
                  @change="onPerspective($event)"
                >
                  <option v-for="choice in perspectiveChoices" :key="choice.value" :value="choice.value">
                    {{ choice.label }}
                  </option>
                </select>
                <span class="mt-2.5 block text-xs text-[var(--nsfw-dim)]">Perspectiva</span>
              </label>
            </div>
          </fieldset>

          <fieldset class="border-0 p-0">
            <legend class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Premisa y dirección</legend>
            <div class="grid gap-5">
              <label class="block">
                <input v-model="title" class="nsfw-underline" placeholder="Título (opcional)">
              </label>
              <label class="block">
                <textarea
                  v-model="premise"
                  class="nsfw-input min-h-24 w-full"
                  placeholder="Qué ocurre, con quién, qué tensión abre la escena"
                />
              </label>
              <label class="block">
                <textarea
                  v-model="storyDirection"
                  class="nsfw-input min-h-24 w-full"
                  maxlength="2000"
                  placeholder="Prompt de dirección: ritmo, secreto, tono de la apertura…"
                />
                <span class="mt-2 block text-xs text-[var(--nsfw-dim)]">
                  Se incorpora al plan privado de esta historia.
                </span>
              </label>
            </div>
          </fieldset>
        </div>

        <!-- Resumen vivo -->
        <aside class="nsfw-summary w-full shrink-0 lg:w-[21rem]">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-4">Lo que vas a leer</p>
          <p class="mb-6 font-serif text-xl italic leading-[1.6] text-[var(--nsfw-prose)]">
            {{ livePitch }}
          </p>

          <dl class="mb-6">
            <div>
              <dt>Perspectiva</dt>
              <dd>{{ choiceList(PERSPECTIVE_CHOICES, configuration.perspective).label }}</dd>
            </div>
            <div>
              <dt>Interacción</dt>
              <dd>{{ choiceList(INTERACTION_CHOICES, configuration.interactionPolicy).label }}</dd>
            </div>
            <div>
              <dt>Reparto</dt>
              <dd>
                {{ selectedCharacters.map((item) => item.name).join(' · ') || 'Lo elige la IA' }}
              </dd>
            </div>
            <div>
              <dt>Lugar</dt>
              <dd>{{ selectedPlace?.name || 'Lo elige la IA' }}</dd>
            </div>
            <div>
              <dt>Época</dt>
              <dd>{{ era || '—' }}</dd>
            </div>
          </dl>

          <div class="mb-6 rounded-2xl border border-[var(--nsfw-line)] p-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <span class="nsfw-eyebrow nsfw-eyebrow--dim !mb-0">Modelo</span>
              <span
                class="flex items-center gap-1.5 text-[0.7rem]"
                :class="selectedModel?.available ? 'text-[var(--nsfw-success)]' : 'text-[var(--nsfw-gold)]'"
              >
                <span
                  class="h-1 w-1 rounded-full"
                  :style="{ background: 'currentColor' }"
                />
                {{ selectedModel?.available ? 'disponible' : 'no detectado' }}
              </span>
            </div>
            <p class="font-serif text-lg">{{ modelAlias || '—' }}</p>
            <p class="mb-3 text-[0.7rem] text-[var(--nsfw-dim)]">
              Perfil {{ choiceList(PROFILE_CHOICES, configuration.profile).label.toLocaleLowerCase('es-ES') }}
              <template v-if="selectedModel?.lmStudioModelId">
                · {{ selectedModel.lmStudioModelId }}
              </template>
            </p>
            <button type="button" class="nsfw-btn-text" @click="modelOpen = !modelOpen">
              {{ modelOpen ? 'Ocultar' : 'Cambiar modelo' }}
            </button>
            <div v-if="modelOpen" class="mt-3 grid gap-3">
              <label class="block">
                <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-1 block">Modelo LM Studio</span>
                <select v-model="modelAlias" class="nsfw-input w-full">
                  <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
                    {{ model.alias }}{{ model.available ? '' : ' (no detectado)' }}
                  </option>
                </select>
              </label>
              <div>
                <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-1 block">Ritmo de generación</span>
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
                <p class="mt-2 text-xs text-[var(--nsfw-faint)]">
                  {{ choiceList(PROFILE_CHOICES, configuration.profile).description }}
                </p>
              </div>
            </div>
          </div>

          <div class="flex-1" />

          <button type="button" class="nsfw-btn-primary min-h-13 w-full" @click="step = 3">
            Continuar a intereses y límites
          </button>
          <button type="button" class="nsfw-btn-text mt-3 justify-center" @click="step = 1">
            Volver al origen
          </button>
        </aside>
      </div>
    </section>

    <!-- ============================ PASO 3 · INTERESES Y LÍMITES -->
    <section v-else aria-labelledby="creator-step-three">
      <h1 id="creator-step-three" class="mb-2 font-serif text-4xl">Qué quieres leer, y qué no</h1>
      <p class="mb-7 max-w-[66ch] font-serif text-[1.1rem] italic leading-[1.62] text-[var(--nsfw-muted)]">
        Esto es lo que más cambia la historia. Vienen precargados de tu perfil, pero lo que decidas
        aquí vale
        <strong class="font-medium not-italic text-[var(--nsfw-ink)]">solo para esta historia</strong>
        — tu perfil no se toca.
      </p>

      <div class="nsfw-hairgrid mb-9 md:grid-cols-3">
        <div class="px-6 py-5">
          <p class="mb-2 flex items-center gap-2.5 text-sm font-medium text-[var(--nsfw-positive)]">
            <NsfwInterestIcon kind="primary" />
            Predominante
            <span class="ml-auto text-xs font-normal text-[var(--nsfw-dim)]">
              {{ primary.length }} de {{ MAX_PRIMARY_INTERESTS }}
            </span>
          </p>
          <p class="text-xs leading-relaxed text-[var(--nsfw-faint)]">
            El narrador construye la historia alrededor de esto. Máximo
            {{ MAX_PRIMARY_INTERESTS }} para que ninguno se diluya.
          </p>
        </div>
        <div class="px-6 py-5">
          <p class="mb-2 flex items-center gap-2.5 text-sm font-medium text-[var(--nsfw-negative)]">
            <NsfwInterestIcon kind="excluded" />
            Excluir
            <span class="ml-auto text-xs font-normal text-[var(--nsfw-dim)]">sin límite</span>
          </p>
          <p class="text-xs leading-relaxed text-[var(--nsfw-faint)]">
            No aparece nunca, ni de fondo, ni mencionado. Es la única regla que el truncado de
            contexto nunca borra.
          </p>
        </div>
        <div class="px-6 py-5">
          <p class="mb-2 flex items-center gap-2.5 text-sm font-medium text-[var(--nsfw-contextual)]">
            <NsfwInterestIcon kind="contextual" />
            Si encaja
            <span class="ml-auto text-xs font-normal text-[var(--nsfw-dim)]">sin límite</span>
          </p>
          <p class="text-xs leading-relaxed text-[var(--nsfw-faint)]">
            Permitido, no pedido. Puede aparecer cuando la escena lo traiga sola, y nunca se fuerza.
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-10 lg:flex-row lg:gap-14">
        <div class="min-w-0 flex-1">
          <div
            class="mb-1 flex flex-wrap items-center gap-4 border-b border-[var(--nsfw-line-strong)] pb-2.5"
          >
            <label class="min-w-[10rem] flex-1">
              <span class="sr-only">Filtrar etiquetas</span>
              <input
                v-model="termFilter"
                class="w-full border-0 bg-transparent text-sm text-[var(--nsfw-ink)] outline-none placeholder:text-[var(--nsfw-dim)]"
                :placeholder="`Filtrar entre ${interestCatalog.length} etiquetas…`"
              >
            </label>
            <label class="flex items-center gap-2">
              <span class="sr-only">Nueva etiqueta privada</span>
              <input
                v-model="customLabel"
                class="w-36 border-0 bg-transparent text-xs text-[var(--nsfw-ink)] outline-none placeholder:text-[var(--nsfw-faint)]"
                maxlength="80"
                placeholder="+ Crear etiqueta privada"
                @keydown.enter.prevent="addCustom"
              >
              <button
                v-if="customLabel.trim()"
                type="button"
                class="nsfw-btn-text !text-[var(--nsfw-accent)]"
                @click="addCustom"
              >
                Crear
              </button>
            </label>
          </div>

          <p v-if="termError" class="py-2 text-sm text-[var(--nsfw-danger)]">{{ termError }}</p>

          <div
            v-for="term in filteredTerms"
            :key="term.id"
            class="flex items-center justify-between gap-4 border-b border-[var(--nsfw-hair)] py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm">
                {{ term.label }}
                <span
                  v-if="term.private"
                  class="ml-2 text-[0.62rem] uppercase tracking-[0.14em] text-[var(--nsfw-gold)]"
                >
                  privada
                </span>
              </p>
              <p class="text-[0.7rem] text-[var(--nsfw-dim)]">
                {{ term.private ? 'solo tuya' : term.facet }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <button
                type="button"
                class="term-action positive"
                :class="primary.includes(term.label) ? 'selected' : ''"
                :aria-pressed="primary.includes(term.label)"
                :disabled="primaryFull && !primary.includes(term.label)"
                :title="
                  primaryFull && !primary.includes(term.label)
                    ? `Ya tienes ${MAX_PRIMARY_INTERESTS} predominantes`
                    : 'Predominante'
                "
                @click="classify(term.label, 'primary')"
              >
                <NsfwInterestIcon kind="primary" :filled="primary.includes(term.label)" />
              </button>
              <button
                type="button"
                class="term-action negative"
                :class="excluded.includes(term.label) ? 'selected' : ''"
                :aria-pressed="excluded.includes(term.label)"
                title="Excluir"
                @click="classify(term.label, 'excluded')"
              >
                <NsfwInterestIcon kind="excluded" />
              </button>
              <button
                type="button"
                class="term-action contextual"
                :class="contextual.includes(term.label) ? 'selected' : ''"
                :aria-pressed="contextual.includes(term.label)"
                title="Si encaja"
                @click="classify(term.label, 'contextual')"
              >
                <NsfwInterestIcon kind="contextual" />
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
          </div>

          <p class="mt-5 text-xs leading-relaxed text-[var(--nsfw-dim)]">
            Las etiquetas que creas quedan marcadas como privadas: solo aparecen en tu catálogo y
            nunca se publican al Hub.
          </p>
        </div>

        <!-- Resumen para esta historia -->
        <aside class="nsfw-summary w-full shrink-0 lg:w-[21rem]">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-4">Para esta historia</p>

          <div class="mb-5">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-positive)]">
              <NsfwInterestIcon kind="primary" filled />
              Predominante · {{ primary.length }} de {{ MAX_PRIMARY_INTERESTS }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in primary"
                :key="`p-${label}`"
                type="button"
                class="pill positive !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!primary.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <div class="mb-5">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-negative)]">
              <NsfwInterestIcon kind="excluded" />
              Excluir · {{ excluded.length }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in excluded"
                :key="`e-${label}`"
                type="button"
                class="pill negative !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!excluded.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <div class="mb-6">
            <p class="mb-2.5 flex items-center gap-2 text-xs text-[var(--nsfw-contextual)]">
              <NsfwInterestIcon kind="contextual" />
              Si encaja · {{ contextual.length }}
            </p>
            <div class="custom-pills">
              <button
                v-for="label in contextual"
                :key="`c-${label}`"
                type="button"
                class="pill contextual !min-h-8 !py-1 !text-xs"
                @click="clearClassification(label)"
              >
                {{ label }} ×
              </button>
              <span v-if="!contextual.length" class="text-xs text-[var(--nsfw-dim)]">Ninguno.</span>
            </div>
          </div>

          <div class="mb-6 rounded-2xl border border-[var(--nsfw-line)] p-4">
            <p class="nsfw-eyebrow nsfw-eyebrow--dim">Tu perfil</p>
            <p class="mb-3 text-xs leading-relaxed text-[var(--nsfw-muted)]">
              Estos valores salieron de tus preferencias por defecto. Cambiarlos aquí no las
              modifica.
            </p>
            <label class="flex items-center gap-2.5 text-xs text-[var(--nsfw-faint)]">
              <input v-model="saveToProfile" type="checkbox" class="accent-[var(--nsfw-accent)]">
              Guardar también en mi perfil
            </label>
          </div>

          <div class="flex-1" />

          <button
            type="button"
            class="nsfw-btn-primary min-h-13 w-full"
            :disabled="sessions.loading"
            @click="start(false)"
          >
            {{ sessions.loading ? 'Creando…' : 'Empezar a leer' }}
          </button>
          <p class="mt-3 text-center text-xs text-[var(--nsfw-dim)]">
            Podrás ajustarlo desde el Director en cualquier momento.
          </p>
          <button type="button" class="nsfw-btn-text mt-3 justify-center" @click="step = 2">
            Volver a la forma de contarla
          </button>
        </aside>
      </div>
    </section>
  </div>
</template>
