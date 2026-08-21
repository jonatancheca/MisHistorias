<script setup lang="ts">
import {
  DURATION_CHOICES,
  FORMAT_CHOICES,
  INTERACTION_CHOICES,
  PERSPECTIVE_CHOICES,
  TONE_CHOICES,
  coherentConfiguration,
  mapPerspectiveToSession,
  mapToneToSession,
  type CreatorFormat,
  type NarrativePerspective,
  type NarrativeTone,
  type StoryDuration
} from '../../../shared/lib/nsfwCreatorConfig.ts'
import type {
  GenerationProfile,
  InteractionPolicy,
  NsfwStorySession
} from '../../../shared/types/nsfw/session.ts'

const props = defineProps<{
  sessionId: string
  compact?: boolean
}>()

const route = useRoute()
const sessions = useNsfwSessionsStore()
const open = ref(false)
const tab = ref<'options' | 'director' | 'bible' | 'cast'>('options')
const message = ref<string | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)

const session = computed(() => sessions.play?.session ?? null)

const title = ref('')
const premise = ref('')
const tone = ref<NarrativeTone>('neutral')
const perspective = ref<NarrativePerspective>('first')
const duration = ref<StoryDuration>('short')
const interactionPolicy = ref<InteractionPolicy>('pause')
const generationProfile = ref<GenerationProfile>('quick')
const modelAlias = ref('')
const interestsText = ref('')
const exclusionsText = ref('')
const planSummary = ref('')
const bibleEntity = ref('')
const bibleText = ref('')
const castDrafts = ref<
  Record<string, { name: string; personality: string; characterization: string }>
>({})

function toneFromSession(value: string): NarrativeTone {
  if (value === 'romantic') return 'romantic'
  if (value === 'explicit' || value === 'hardcore') return 'hardcore'
  if (value === 'dark') return 'dark'
  return 'neutral'
}

function perspectiveFromSession(value: string): NarrativePerspective {
  if (value === 'first') return 'first'
  if (value === 'third') return 'third'
  if (value === 'narrative') return 'narrative'
  return 'second'
}

function syncFromSession(current: NsfwStorySession) {
  title.value = current.title
  premise.value = current.premise
  tone.value = toneFromSession(current.tone)
  perspective.value = perspectiveFromSession(current.perspective)
  duration.value = (DURATION_CHOICES.some((item) => item.value === current.duration)
    ? current.duration
    : 'short') as StoryDuration
  interactionPolicy.value = current.interactionPolicy
  generationProfile.value = current.generationProfile
  modelAlias.value = current.modelAlias
  interestsText.value = current.interests.join(', ')
  exclusionsText.value = current.exclusions.join(', ')
  planSummary.value = current.plan.summary
  for (const member of current.cast) {
    if (castDrafts.value[member.actorId]) continue
    castDrafts.value[member.actorId] = {
      name: member.overrideName || member.name,
      personality: member.personality || '',
      characterization: member.characterization || ''
    }
  }
}

watch(
  session,
  (current) => {
    if (current) syncFromSession(current)
  },
  { immediate: true }
)

watch(
  () => route.fullPath,
  () => {
    open.value = false
  }
)

const formatLabel = computed(() => {
  const format = session.value?.format as CreatorFormat | undefined
  return FORMAT_CHOICES.find((item) => item.value === format)?.label || format || '—'
})

const policyChoices = computed(() => {
  const format = (session.value?.format || 'story') as CreatorFormat
  return INTERACTION_CHOICES.filter((item) => {
    if (format === 'chat' && item.value === 'non_interactive') return false
    return true
  })
})

const perspectiveChoices = computed(() => {
  const format = (session.value?.format || 'story') as CreatorFormat
  return PERSPECTIVE_CHOICES.filter((item) => {
    if (format === 'chat' && (item.value === 'narrative' || item.value === 'third')) return false
    return true
  })
})

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function openSheet(nextTab: typeof tab.value = 'options') {
  if (session.value) syncFromSession(session.value)
  tab.value = nextTab
  open.value = true
  message.value = null
  error.value = null
}

function closeSheet() {
  open.value = false
}

async function saveOptions() {
  if (!session.value) return
  saving.value = true
  error.value = null
  message.value = null
  try {
    const coherent = coherentConfiguration({
      format: session.value.format as CreatorFormat,
      profile: generationProfile.value,
      tone: tone.value,
      perspective: perspective.value,
      duration: duration.value,
      interactionPolicy: interactionPolicy.value
    })
    await $fetch(`/api/private/sessions/${props.sessionId}/config`, {
      method: 'PATCH',
      body: {
        title: title.value,
        premise: premise.value,
        duration: coherent.duration,
        tone: mapToneToSession(coherent.tone),
        perspective: mapPerspectiveToSession(coherent.perspective),
        interactionPolicy: coherent.interactionPolicy,
        generationProfile: coherent.profile,
        modelAlias: modelAlias.value,
        interests: splitList(interestsText.value).slice(0, 5),
        exclusions: splitList(exclusionsText.value)
      }
    })
    await sessions.loadPlay(props.sessionId)
    message.value = 'Opciones guardadas'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar'
  } finally {
    saving.value = false
  }
}

async function savePlan() {
  saving.value = true
  error.value = null
  try {
    await $fetch(`/api/private/sessions/${props.sessionId}/plan`, {
      method: 'PATCH',
      body: { summary: planSummary.value }
    })
    await sessions.loadPlay(props.sessionId)
    message.value = 'Plan actualizado'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar el plan'
  } finally {
    saving.value = false
  }
}

async function addBibleFact() {
  if (!bibleEntity.value.trim() || !bibleText.value.trim()) return
  saving.value = true
  error.value = null
  try {
    await sessions.addBibleFact(props.sessionId, {
      entity: bibleEntity.value,
      text: bibleText.value,
      knownByProtagonist: true
    })
    bibleEntity.value = ''
    bibleText.value = ''
    message.value = 'Hecho añadido'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar'
  } finally {
    saving.value = false
  }
}

async function saveCast(actorId: string) {
  const draft = castDrafts.value[actorId]
  if (!draft) return
  saving.value = true
  error.value = null
  try {
    await $fetch(`/api/private/sessions/${props.sessionId}/cast/${actorId}`, {
      method: 'POST',
      body: {
        name: draft.name,
        overrideName: draft.name,
        personality: draft.personality,
        characterization: draft.characterization
      }
    })
    await sessions.loadPlay(props.sessionId)
    message.value = 'Caracterización guardada'
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo guardar'
  } finally {
    saving.value = false
  }
}

async function cloneCast(actorId: string) {
  const draft = castDrafts.value[actorId]
  saving.value = true
  try {
    const result = await $fetch<{ character: { name: string } }>(
      `/api/private/sessions/${props.sessionId}/cast/${actorId}`,
      { method: 'POST', body: { action: 'clone', name: draft?.name } }
    )
    message.value = `Clone: ${result.character.name}`
  } catch (caught) {
    error.value = (caught as Error).message || 'No se pudo clonar'
  } finally {
    saving.value = false
  }
}

async function toggleHeart() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${props.sessionId}/escalation`, {
    method: 'POST',
    body: { value: !session.value.escalationHeart }
  })
  await sessions.loadPlay(props.sessionId)
}

defineExpose({ openSheet, closeSheet })
</script>

<template>
  <div class="nsfw-session-sheet">
    <button
      type="button"
      class="nsfw-session-sheet__trigger"
      :class="compact ? 'is-compact' : ''"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="openSheet()"
    >
      <span aria-hidden="true">···</span>
      <span class="nsfw-session-sheet__trigger-label">Sesión</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="nsfw-session-sheet__root nsfw-scope"
        role="dialog"
        aria-modal="true"
        aria-label="Opciones de sesión"
      >
        <button
          type="button"
          class="nsfw-session-sheet__backdrop"
          aria-label="Cerrar"
          @click="closeSheet"
        />
        <aside class="nsfw-session-sheet__panel">
          <header class="nsfw-session-sheet__header">
            <div>
              <p class="nsfw-session-sheet__eyebrow">Director</p>
              <h2>{{ session?.title || 'Sesión' }}</h2>
            </div>
            <button type="button" class="nsfw-btn-ghost" @click="closeSheet">Cerrar</button>
          </header>

          <nav class="nsfw-session-sheet__tabs" aria-label="Secciones">
            <button
              type="button"
              :class="tab === 'options' ? 'is-active' : ''"
              @click="tab = 'options'"
            >
              Opciones
            </button>
            <button
              type="button"
              :class="tab === 'director' ? 'is-active' : ''"
              @click="tab = 'director'"
            >
              Plan
            </button>
            <button
              type="button"
              :class="tab === 'bible' ? 'is-active' : ''"
              @click="tab = 'bible'"
            >
              Bible
            </button>
            <button
              type="button"
              :class="tab === 'cast' ? 'is-active' : ''"
              @click="tab = 'cast'"
            >
              Reparto
            </button>
          </nav>

          <p v-if="message" class="nsfw-session-sheet__status is-ok">{{ message }}</p>
          <p v-if="error" class="nsfw-session-sheet__status is-err">{{ error }}</p>

          <div class="nsfw-session-sheet__body">
            <section v-if="tab === 'options'" class="space-y-4">
              <div class="nsfw-session-sheet__readonly">
                <div>
                  <span>Formato</span>
                  <strong>{{ formatLabel }}</strong>
                </div>
                <p>Inmutable para esta historia.</p>
              </div>

              <label class="block">
                <span class="nsfw-session-sheet__label">Título</span>
                <input v-model="title" class="nsfw-input w-full">
              </label>
              <label class="block">
                <span class="nsfw-session-sheet__label">Premisa</span>
                <textarea v-model="premise" class="nsfw-input min-h-20 w-full" />
              </label>

              <div class="grid gap-3 sm:grid-cols-2">
                <label class="block">
                  <span class="nsfw-session-sheet__label">Tono</span>
                  <select v-model="tone" class="nsfw-input w-full">
                    <option v-for="item in TONE_CHOICES" :key="item.value" :value="item.value">
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label class="block">
                  <span class="nsfw-session-sheet__label">Perspectiva</span>
                  <select v-model="perspective" class="nsfw-input w-full">
                    <option
                      v-for="item in perspectiveChoices"
                      :key="item.value"
                      :value="item.value"
                    >
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label class="block">
                  <span class="nsfw-session-sheet__label">Duración</span>
                  <select v-model="duration" class="nsfw-input w-full">
                    <option v-for="item in DURATION_CHOICES" :key="item.value" :value="item.value">
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label class="block">
                  <span class="nsfw-session-sheet__label">Interacción</span>
                  <select v-model="interactionPolicy" class="nsfw-input w-full">
                    <option v-for="item in policyChoices" :key="item.value" :value="item.value">
                      {{ item.label }}
                    </option>
                  </select>
                </label>
                <label class="block">
                  <span class="nsfw-session-sheet__label">Perfil por defecto</span>
                  <select v-model="generationProfile" class="nsfw-input w-full">
                    <option value="quick">Rápido</option>
                    <option value="quality">Calidad</option>
                  </select>
                </label>
                <label class="block">
                  <span class="nsfw-session-sheet__label">Modelo por defecto</span>
                  <select v-model="modelAlias" class="nsfw-input w-full">
                    <option
                      v-for="model in sessions.models"
                      :key="model.alias"
                      :value="model.alias"
                    >
                      {{ model.alias }}
                    </option>
                  </select>
                </label>
              </div>

              <label class="block">
                <span class="nsfw-session-sheet__label">Intereses (máx. 5, coma)</span>
                <input v-model="interestsText" class="nsfw-input w-full">
              </label>
              <label class="block">
                <span class="nsfw-session-sheet__label">Exclusiones (coma)</span>
                <input v-model="exclusionsText" class="nsfw-input w-full">
              </label>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="nsfw-btn-ghost"
                  :class="session?.escalationHeart ? 'text-[var(--nsfw-accent)]' : ''"
                  @click="toggleHeart"
                >
                  ♥ Escalada
                </button>
                <button
                  type="button"
                  class="nsfw-btn-primary"
                  :disabled="saving"
                  @click="saveOptions"
                >
                  Guardar opciones
                </button>
              </div>
            </section>

            <section v-else-if="tab === 'director'" class="space-y-3">
              <p class="text-xs text-[var(--nsfw-faint)]">
                Plan como posibilidad mutable. No reescribe beats ya aceptados.
              </p>
              <textarea v-model="planSummary" class="nsfw-input min-h-28 w-full" />
              <ul class="space-y-1 text-sm text-[var(--nsfw-muted)]">
                <li v-for="beat in session?.plan.nextBeats || []" :key="beat.id">
                  {{ beat.status }} · {{ beat.intent }}
                </li>
                <li v-if="!(session?.plan.nextBeats || []).length">Sin beats planificados aún.</li>
              </ul>
              <button type="button" class="nsfw-btn-primary" :disabled="saving" @click="savePlan">
                Guardar plan
              </button>
            </section>

            <section v-else-if="tab === 'bible'" class="space-y-3">
              <ul
                v-if="session?.bible.facts.length"
                class="space-y-2 text-sm text-[var(--nsfw-muted)]"
              >
                <li v-for="fact in session.bible.facts" :key="fact.id">
                  <span class="text-[var(--nsfw-ink)]">{{ fact.entity }}:</span>
                  {{ fact.text }}
                </li>
              </ul>
              <p v-else class="text-sm text-[var(--nsfw-muted)]">Sin hechos todavía.</p>
              <div class="grid gap-2 sm:grid-cols-2">
                <input v-model="bibleEntity" class="nsfw-input" placeholder="Entidad">
                <input v-model="bibleText" class="nsfw-input" placeholder="Hecho">
              </div>
              <button type="button" class="nsfw-btn-ghost" :disabled="saving" @click="addBibleFact">
                Añadir hecho
              </button>
            </section>

            <section v-else class="space-y-4">
              <p class="text-xs text-[var(--nsfw-faint)]">
                Override local. No muta el Personaje fuente.
              </p>
              <article
                v-for="member in session?.cast || []"
                :key="member.actorId"
                class="space-y-2 border-t border-[var(--nsfw-line)] pt-3 first:border-0 first:pt-0"
              >
                <p class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">
                  {{ member.role }} · {{ member.name }}
                </p>
                <template v-if="castDrafts[member.actorId]">
                  <input
                    v-model="castDrafts[member.actorId].name"
                    class="nsfw-input w-full"
                    placeholder="Nombre en escena"
                  >
                  <input
                    v-model="castDrafts[member.actorId].personality"
                    class="nsfw-input w-full"
                    placeholder="Personalidad"
                  >
                  <textarea
                    v-model="castDrafts[member.actorId].characterization"
                    class="nsfw-input min-h-20 w-full"
                    placeholder="Caracterización"
                  />
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="nsfw-btn-primary"
                      :disabled="saving"
                      @click="saveCast(member.actorId)"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      class="nsfw-btn-ghost"
                      :disabled="saving"
                      @click="cloneCast(member.actorId)"
                    >
                      Clone
                    </button>
                  </div>
                </template>
              </article>
            </section>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
