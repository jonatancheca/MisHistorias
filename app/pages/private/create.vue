<script setup lang="ts">
import type {
  CreateStorySessionInput,
  GenerationProfile,
  InteractionPolicy,
  NsfwStoryFormat
} from '../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const sessions = useNsfwSessionsStore()
const studio = useNsfwStudioStore()
const step = ref(1)
const error = ref<string | null>(null)
const experienceId = ref('')

const form = reactive({
  title: '',
  premise: '',
  format: 'story' as NsfwStoryFormat,
  duration: 'medium',
  tone: 'sensual',
  perspective: 'second',
  interactionPolicy: 'pause' as InteractionPolicy,
  generationProfile: 'quick' as GenerationProfile,
  modelAlias: '',
  protagonistName: 'Tú',
  companionName: 'Alex',
  companionPersonality: 'Directo, observador, con deseo contenido',
  interestsText: 'tensión, diálogo íntimo, proximidad',
  exclusionsText: '',
  planSummary: '',
  era: 'Contemporánea',
  preservedRelationsText: ''
})

await Promise.all([sessions.loadModels(), studio.loadExperiences(), studio.loadCharacters()])
if (!form.modelAlias && sessions.models[0]) {
  form.modelAlias = sessions.models[0].alias
}

const companionCharacterId = ref('')

function applyCompanionCharacter(id: string) {
  companionCharacterId.value = id
  const character = studio.characters.find((item) => item.id === id)
  if (!character) return
  form.companionName = character.name
  form.companionPersonality = character.defaults?.personality || form.companionPersonality
}

function applyExperience(id: string) {
  experienceId.value = id
  const experience = studio.experiences.find((item) => item.id === id)
  if (!experience) return
  form.title = experience.title
  form.premise = experience.premise
  form.tone = experience.adultProfile || form.tone
  form.planSummary = experience.planSeeds?.[0] || form.planSummary
}

const route = useRoute()
if (typeof route.query.experience === 'string' && route.query.experience) {
  applyExperience(route.query.experience)
}

const summary = computed(() => ({
  title: form.title.trim() || 'Historia sin título',
  premise: form.premise.trim(),
  format: form.format,
  duration: form.duration,
  tone: form.tone,
  perspective: form.perspective,
  policy: form.interactionPolicy,
  profile: form.generationProfile,
  model: form.modelAlias
}))

function playPath(format: NsfwStoryFormat, id: string) {
  if (format === 'chat') return `/private/play/chat/${id}`
  if (format === 'vn') return `/private/play/vn/${id}`
  return `/private/play/story/${id}`
}

function nextStep() {
  error.value = null
  if (step.value === 1 && !form.premise.trim()) {
    error.value = 'Escribe una premisa'
    return
  }
  if (step.value < 3) step.value += 1
}

function prevStep() {
  if (step.value > 1) step.value -= 1
}

async function start() {
  error.value = null
  if (!form.modelAlias) {
    error.value = 'Elige un modelo'
    return
  }
  const interests = form.interestsText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)
  const exclusions = form.exclusionsText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const input: CreateStorySessionInput = {
    title: form.title.trim() || 'Historia sin título',
    premise: form.premise.trim(),
    format: form.format,
    duration: form.duration,
    tone: form.tone,
    perspective: form.perspective,
    interactionPolicy: form.interactionPolicy,
    generationProfile: form.generationProfile,
    modelAlias: form.modelAlias,
    interests,
    exclusions,
    planSummary:
      [form.planSummary.trim(), form.era ? `Época: ${form.era}` : ''].filter(Boolean).join(' · '),
    experienceId: experienceId.value || null,
    cast: [
      {
        actorId: 'protagonist',
        name: form.protagonistName.trim() || 'Tú',
        role: 'protagonist',
        personality: '',
        isSelfInsert: true
      },
      {
        actorId: 'companion',
        name: form.companionName.trim() || 'Alex',
        role: 'character',
        personality: form.companionPersonality.trim(),
        isSelfInsert: false,
        sourceCharacterId: companionCharacterId.value || null,
        preservedRelations: form.preservedRelationsText
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      }
    ]
  }

  try {
    const session = await sessions.createSession(input)
    await navigateTo(playPath(session.format, session.id))
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo crear'
  }
}
</script>

<template>
  <div class="nsfw-page mx-auto max-w-3xl px-4 py-8 sm:px-6">
    <header class="mb-6">
      <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">Crear · paso {{ step }}/3</p>
      <h1 class="font-serif text-3xl">Nueva historia</h1>
      <p class="mt-2 text-sm text-[var(--nsfw-muted)]">
        Desde cero o desde una Experience. El formato queda fijado para esta sesión.
      </p>
    </header>

    <p v-if="error" class="mb-4 text-sm text-[var(--nsfw-danger)]">{{ error }}</p>

    <section v-if="step === 1" class="nsfw-card space-y-4">
      <label v-if="studio.experiences.length" class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Experience (opcional)</span>
        <select
          class="nsfw-input w-full"
          :value="experienceId"
          @change="applyExperience(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Desde cero</option>
          <option v-for="item in studio.experiences" :key="item.id" :value="item.id">
            {{ item.title }}
          </option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Título</span>
        <input v-model="form.title" class="nsfw-input w-full" placeholder="Opcional">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Premisa</span>
        <textarea
          v-model="form.premise"
          class="nsfw-input min-h-32 w-full"
          placeholder="Qué ocurre, con quién, qué tensión abre la escena"
          required
        />
      </label>
      <fieldset>
        <legend class="mb-2 text-sm text-[var(--nsfw-muted)]">Formato (inmutable)</legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="option in [
              { value: 'story', label: 'Story' },
              { value: 'chat', label: 'Chat' },
              { value: 'vn', label: 'Visual Novel' }
            ]"
            :key="option.value"
            class="nsfw-btn-ghost cursor-pointer"
            :class="form.format === option.value ? 'text-[var(--nsfw-accent)]' : ''"
          >
            <input v-model="form.format" type="radio" class="sr-only" :value="option.value">
            {{ option.label }}
          </label>
        </div>
      </fieldset>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Duración</span>
          <select v-model="form.duration" class="nsfw-input w-full">
            <option value="short">Corta</option>
            <option value="medium">Media</option>
            <option value="long">Larga</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Tono</span>
          <select v-model="form.tone" class="nsfw-input w-full">
            <option value="sensual">Sensual</option>
            <option value="romantic">Romántico</option>
            <option value="explicit">Explícito</option>
            <option value="dark">Oscuro</option>
          </select>
        </label>
      </div>
    </section>

    <section v-else-if="step === 2" class="nsfw-card space-y-4">
      <p class="text-xs text-[var(--nsfw-faint)]">
        El self-insert del perfil se aplica al protagonista al crear (sin publicarlo).
      </p>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Nombre del protagonista</span>
        <input v-model="form.protagonistName" class="nsfw-input w-full">
      </label>
      <label v-if="studio.characters.length" class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Personaje Studio (opcional)</span>
        <select
          class="nsfw-input w-full"
          :value="companionCharacterId"
          @change="applyCompanionCharacter(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Nombre libre</option>
          <option v-for="character in studio.characters" :key="character.id" :value="character.id">
            {{ character.name }}
          </option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Compañero</span>
        <input v-model="form.companionName" class="nsfw-input w-full">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Personalidad del compañero</span>
        <textarea v-model="form.companionPersonality" class="nsfw-input min-h-24 w-full" />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Intereses (máx. 5, separados por coma)</span>
        <input v-model="form.interestsText" class="nsfw-input w-full">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Exclusiones (separadas por coma)</span>
        <input v-model="form.exclusionsText" class="nsfw-input w-full">
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Época</span>
        <select v-model="form.era" class="nsfw-input w-full">
          <option value="Contemporánea">Contemporánea</option>
          <option value="Histórica">Histórica</option>
          <option value="Futurista">Futurista</option>
          <option value="Propia">Propia / otra</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">
          Relaciones a preservar (coma; vacío = la historia las inventa)
        </span>
        <input v-model="form.preservedRelationsText" class="nsfw-input w-full" placeholder="amistad, tensión previa">
      </label>
      <details class="rounded-xl border border-[var(--nsfw-line)] p-3">
        <summary class="cursor-pointer text-sm text-[var(--nsfw-muted)]">Avanzado</summary>
        <div class="mt-3 space-y-3">
          <label class="block">
            <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Perspectiva</span>
            <select v-model="form.perspective" class="nsfw-input w-full">
              <option value="second">Segunda persona</option>
              <option value="first">Primera</option>
              <option value="third">Tercera</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Política de interacción</span>
            <select v-model="form.interactionPolicy" class="nsfw-input w-full">
              <option value="pause">Pause</option>
              <option value="lite">Lite</option>
              <option value="automatic">Automático</option>
              <option value="non_interactive">No interactivo</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Resumen de plan (sin spoilers fuertes)</span>
            <textarea v-model="form.planSummary" class="nsfw-input min-h-20 w-full" />
          </label>
        </div>
      </details>
    </section>

    <section v-else class="nsfw-card space-y-4">
      <div class="rounded-xl bg-[var(--nsfw-soft)] p-4 text-sm text-[var(--nsfw-muted)]">
        <p><span class="text-[var(--nsfw-ink)]">{{ summary.title }}</span> · {{ summary.format }}</p>
        <p class="mt-2">{{ summary.premise }}</p>
        <p class="mt-2">
          {{ summary.duration }} · {{ summary.tone }} · {{ summary.perspective }} ·
          {{ summary.policy }}
        </p>
      </div>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Perfil de generación</span>
        <select v-model="form.generationProfile" class="nsfw-input w-full">
          <option value="quick">Quick</option>
          <option value="quality">Quality</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-[var(--nsfw-muted)]">Modelo</span>
        <select v-model="form.modelAlias" class="nsfw-input w-full">
          <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
            {{ model.alias }}{{ model.available ? '' : ' (no disponible)' }}
          </option>
        </select>
      </label>
      <p class="text-xs text-[var(--nsfw-faint)]">
        Con mock mode activo en Ajustes, la generación usa un envelope local determinista.
      </p>
    </section>

    <div class="mt-6 flex flex-wrap gap-2">
      <button v-if="step > 1" type="button" class="nsfw-btn-ghost" @click="prevStep">Atrás</button>
      <button
        v-if="step < 3"
        type="button"
        class="nsfw-btn-primary"
        @click="nextStep"
      >
        Continuar
      </button>
      <button
        v-else
        type="button"
        class="nsfw-btn-primary"
        :disabled="sessions.loading"
        @click="start"
      >
        {{ sessions.loading ? 'Creando…' : 'Empezar' }}
      </button>
    </div>
  </div>
</template>
