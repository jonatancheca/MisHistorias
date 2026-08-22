<script setup lang="ts">
import {
  DURATION_CHOICES,
  FORMAT_CHOICES,
  INTERACTION_CHOICES,
  MAX_PRIMARY_INTERESTS,
  PERSPECTIVE_CHOICES,
  TONE_CHOICES,
  coherentConfiguration,
  mapPerspectiveToSession,
  mapToneToSession,
  sceneIntensity,
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
  hideTrigger?: boolean
}>()

const route = useRoute()
const sessions = useNsfwSessionsStore()
const open = ref(false)
const tab = ref<SessionSheetTab>('direction')
const advancedOpen = ref(false)
const message = ref<string | null>(null)
const error = ref<string | null>(null)
const saving = ref(false)

const session = computed(() => sessions.play?.session ?? null)
const attempt = computed(() => sessions.play?.activeAttempt ?? null)

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

const TABS: Array<{ id: SessionSheetTab; label: string }> = [
  { id: 'direction', label: 'Dirección' },
  { id: 'bible', label: 'Biblia' },
  { id: 'plan', label: 'Plan' },
  { id: 'state', label: 'Estado' },
  { id: 'cast', label: 'Reparto' },
  { id: 'usage', label: 'Uso' }
]

/** La intensidad se lee del tono y sube un tramo cuando la escalada está pedida. */
const intensity = computed(() => sceneIntensity(tone.value, Boolean(session.value?.escalationHeart)))

const profileLabel = computed(() => {
  const value = attempt.value?.generationProfile || session.value?.generationProfile
  if (!value) return '—'
  return value === 'quick' ? 'Rápido' : 'Calidad'
})

const intensityNote = computed(() =>
  session.value?.escalationHeart
    ? 'Escalada pedida: sube a explícito en los próximos beats.'
    : `${TONE_CHOICES.find((item) => item.value === tone.value)?.label}. Puedes subirla cuando quieras.`
)

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

function actorName(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

function openSheet(nextTab: SessionSheetTab = 'direction') {
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
        interests: splitList(interestsText.value).slice(0, MAX_PRIMARY_INTERESTS),
        exclusions: splitList(exclusionsText.value)
      }
    })
    await sessions.loadPlay(props.sessionId)
    message.value = 'Afecta al siguiente beat'
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
    message.value = `Copiado a Studio: ${result.character.name}`
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
      v-if="!hideTrigger"
      type="button"
      class="nsfw-btn-text"
      :class="compact ? 'is-compact' : ''"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="openSheet()"
    >
      Director
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        class="nsfw-session-sheet__root nsfw-scope"
        role="dialog"
        aria-modal="true"
        aria-label="Director de la sesión"
      >
        <button
          type="button"
          class="nsfw-session-sheet__backdrop"
          aria-label="Cerrar"
          @click="closeSheet"
        />
        <aside class="nsfw-session-sheet__panel">
          <header class="nsfw-session-sheet__header">
            <div class="min-w-0">
              <p class="nsfw-session-sheet__eyebrow truncate">
                {{ session?.title || 'Sesión' }}
                <template v-if="session?.branchLabel"> · {{ session.branchLabel }}</template>
              </p>
              <h2>Director</h2>
            </div>
            <button
              type="button"
              class="nsfw-btn-text text-lg leading-none"
              aria-label="Cerrar"
              @click="closeSheet"
            >
              ×
            </button>
          </header>

          <nav class="nsfw-session-sheet__tabs" aria-label="Secciones">
            <button
              v-for="item in TABS"
              :key="item.id"
              type="button"
              :class="tab === item.id ? 'is-active' : ''"
              @click="tab = item.id"
            >
              {{ item.label }}
            </button>
          </nav>

          <p v-if="message" class="nsfw-session-sheet__status is-ok">{{ message }}</p>
          <p v-if="error" class="nsfw-session-sheet__status is-err">{{ error }}</p>

          <div class="nsfw-session-sheet__body">
            <!-- DIRECCIÓN -->
            <section v-if="tab === 'direction'" class="space-y-6">
              <p class="text-xs leading-relaxed text-[var(--nsfw-faint)]">
                Cambia el rumbo sin reescribir lo ya leído. Todo lo de aquí afecta al
                <strong class="font-medium text-[var(--nsfw-muted)]">siguiente</strong> beat.
                Formato: <strong class="font-medium text-[var(--nsfw-muted)]">{{ formatLabel }}</strong>,
                inmutable para esta historia.
              </p>

              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Intensidad de la escena</p>
                <div class="mb-2 flex items-center gap-3">
                  <div class="nsfw-meter flex-1">
                    <span v-for="n in 5" :key="n" :class="n <= intensity ? 'is-on' : ''" />
                  </div>
                  <button
                    type="button"
                    class="nsfw-heat-btn"
                    :aria-pressed="Boolean(session?.escalationHeart)"
                    @click="toggleHeart"
                  >
                    <span aria-hidden="true">♥</span>
                    {{ session?.escalationHeart ? 'Bajar' : 'Subir ya' }}
                  </button>
                </div>
                <p class="text-xs text-[var(--nsfw-dim)]">{{ intensityNote }}</p>
              </div>

              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Tono</p>
                <div class="choice-pills">
                  <button
                    v-for="item in TONE_CHOICES"
                    :key="item.value"
                    type="button"
                    class="choice-pill !min-h-9 !text-xs"
                    :class="tone === item.value ? 'selected' : ''"
                    :aria-pressed="tone === item.value"
                    @click="tone = item.value"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>

              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Ritmo</p>
                <div class="choice-pills">
                  <button
                    v-for="item in DURATION_CHOICES"
                    :key="item.value"
                    type="button"
                    class="choice-pill !min-h-9 !text-xs"
                    :class="duration === item.value ? 'selected' : ''"
                    :aria-pressed="duration === item.value"
                    @click="duration = item.value"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>

              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Quién lleva la iniciativa</p>
                <div class="choice-pills">
                  <button
                    v-for="item in policyChoices"
                    :key="item.value"
                    type="button"
                    class="choice-pill !min-h-9 !text-xs"
                    :class="interactionPolicy === item.value ? 'selected' : ''"
                    :aria-pressed="interactionPolicy === item.value"
                    @click="interactionPolicy = item.value"
                  >
                    {{ item.label }}
                  </button>
                </div>
                <p class="mt-2 text-xs text-[var(--nsfw-dim)]">
                  {{ INTERACTION_CHOICES.find((item) => item.value === interactionPolicy)?.description }}
                </p>
              </div>

              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Perspectiva</p>
                <select v-model="perspective" class="nsfw-input w-full">
                  <option v-for="item in perspectiveChoices" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </option>
                </select>
              </div>

              <label class="block">
                <span class="nsfw-session-sheet__label">Título</span>
                <input v-model="title" class="nsfw-input w-full">
              </label>

              <label class="block">
                <span class="nsfw-session-sheet__label">Nota al narrador · premisa</span>
                <textarea v-model="premise" class="nsfw-input min-h-20 w-full" />
              </label>

              <label class="block">
                <span class="nsfw-session-sheet__label">
                  Predominantes · máx. {{ MAX_PRIMARY_INTERESTS }}, separados por comas
                </span>
                <input v-model="interestsText" class="nsfw-input w-full">
              </label>
              <label class="block">
                <span class="nsfw-session-sheet__label">Excluir · sin límite, separados por comas</span>
                <input v-model="exclusionsText" class="nsfw-input w-full">
              </label>

              <button
                type="button"
                class="nsfw-btn-primary w-full"
                :disabled="saving"
                @click="saveOptions"
              >
                Aplicar al siguiente beat
              </button>
            </section>

            <!-- BIBLIA -->
            <section v-else-if="tab === 'bible'" class="space-y-4">
              <p class="text-xs text-[var(--nsfw-faint)]">
                Hechos que la historia no puede contradecir.
              </p>
              <ul
                v-if="session?.bible.facts.length"
                class="space-y-2 text-sm text-[var(--nsfw-muted)]"
              >
                <li
                  v-for="fact in session.bible.facts"
                  :key="fact.id"
                  class="border-b border-[var(--nsfw-hair)] pb-2"
                >
                  <span class="text-[var(--nsfw-gold)]">{{ fact.entity }}:</span>
                  {{ fact.text }}
                </li>
              </ul>
              <p v-else class="text-sm text-[var(--nsfw-muted)]">Sin hechos todavía.</p>
              <div class="grid gap-2 sm:grid-cols-2">
                <input v-model="bibleEntity" class="nsfw-input" placeholder="Entidad">
                <input v-model="bibleText" class="nsfw-input" placeholder="Hecho">
              </div>
              <button
                type="button"
                class="nsfw-btn-ghost"
                :disabled="saving"
                @click="addBibleFact"
              >
                Añadir hecho
              </button>
            </section>

            <!-- PLAN -->
            <section v-else-if="tab === 'plan'" class="space-y-4">
              <p class="text-xs text-[var(--nsfw-faint)]">
                El plan es una posibilidad mutable. No reescribe beats ya aceptados.
              </p>
              <textarea v-model="planSummary" class="nsfw-input min-h-28 w-full" />
              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Próximo en el plan</p>
                <ul class="space-y-1.5">
                  <li
                    v-for="beat in session?.plan.nextBeats || []"
                    :key="beat.id"
                    class="font-serif text-[0.95rem] italic leading-relaxed text-[var(--nsfw-muted)]"
                  >
                    {{ beat.intent }}
                    <span class="font-sans text-[0.68rem] not-italic text-[var(--nsfw-dim)]">
                      · {{ beat.status }}
                    </span>
                  </li>
                  <li v-if="!(session?.plan.nextBeats || []).length" class="text-sm text-[var(--nsfw-muted)]">
                    Sin beats planificados aún.
                  </li>
                </ul>
              </div>
              <button type="button" class="nsfw-btn-ghost" :disabled="saving" @click="savePlan">
                Guardar plan
              </button>
            </section>

            <!-- ESTADO -->
            <section v-else-if="tab === 'state'" class="space-y-6">
              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Escena</p>
                <p class="font-serif text-xl leading-tight">{{ session?.sceneState.location }}</p>
                <p class="mt-1 text-xs leading-relaxed text-[var(--nsfw-faint)]">
                  {{ session?.sceneState.intention }} · ritmo {{ session?.sceneState.pacing }}
                </p>
              </div>
              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Presentes</p>
                <div class="flex flex-col gap-2.5">
                  <div
                    v-for="actorId in session?.sceneState.presentActorIds || []"
                    :key="actorId"
                    class="flex items-center gap-2.5"
                  >
                    <span class="nsfw-avatar is-gold h-7 w-7 text-xs">
                      {{ actorName(actorId).slice(0, 1) }}
                    </span>
                    <span class="text-sm">{{ actorName(actorId) }}</span>
                  </div>
                </div>
              </div>
              <div>
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">Mundo</p>
                <p class="text-sm text-[var(--nsfw-muted)]">
                  {{ session?.worldState.location }} · {{ session?.worldState.mood }}
                </p>
                <ul class="mt-2 space-y-1 text-xs text-[var(--nsfw-faint)]">
                  <li v-for="(note, index) in session?.worldState.relationshipNotes || []" :key="index">
                    {{ note }}
                  </li>
                </ul>
              </div>
            </section>

            <!-- REPARTO -->
            <section v-else-if="tab === 'cast'" class="space-y-5">
              <p class="text-xs text-[var(--nsfw-faint)]">
                Override local. No muta el Personaje fuente del Studio.
              </p>
              <article
                v-for="member in session?.cast || []"
                :key="member.actorId"
                class="space-y-2 border-t border-[var(--nsfw-hair)] pt-4 first:border-0 first:pt-0"
              >
                <p class="nsfw-eyebrow nsfw-eyebrow--dim">
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
                  <div class="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      class="nsfw-btn-ghost"
                      :disabled="saving"
                      @click="saveCast(member.actorId)"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      class="nsfw-btn-text"
                      :disabled="saving"
                      @click="cloneCast(member.actorId)"
                    >
                      Copiar a Studio
                    </button>
                  </div>
                </template>
              </article>
            </section>

            <!-- USO -->
            <section v-else class="space-y-4">
              <p class="text-xs text-[var(--nsfw-faint)]">Último intento de esta sesión.</p>
              <div class="nsfw-session-sheet__readonly space-y-2">
                <div>
                  <span>Modelo</span>
                  <strong>{{ attempt?.modelAlias || session?.modelAlias || '—' }}</strong>
                </div>
                <div>
                  <span>Perfil</span>
                  <strong>{{ profileLabel }}</strong>
                </div>
                <div>
                  <span>Latencia</span>
                  <strong>{{ attempt ? `${(attempt.latencyMs / 1000).toFixed(1)} s` : '—' }}</strong>
                </div>
                <div>
                  <span>Tokens</span>
                  <strong>{{ attempt?.usage.totalTokens ?? '—' }}</strong>
                </div>
                <div>
                  <span>Estado</span>
                  <strong>{{ attempt?.state || 'sin intentos' }}</strong>
                </div>
              </div>
              <NuxtLink to="/private/usage" class="nsfw-btn-text">Uso y latencia completos</NuxtLink>
            </section>
          </div>

          <!-- OPCIONES AVANZADAS -->
          <div class="border-t border-[var(--nsfw-hair)] bg-[rgba(238,224,212,0.02)]">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-6 py-3.5 text-left"
              :aria-expanded="advancedOpen"
              @click="advancedOpen = !advancedOpen"
            >
              <span class="nsfw-eyebrow !mb-0 !text-[var(--nsfw-muted)]">Opciones avanzadas</span>
              <span class="text-xs text-[var(--nsfw-faint)]">{{ advancedOpen ? '▴' : '▾' }}</span>
            </button>
            <div v-if="advancedOpen" class="grid gap-4 px-6 pb-5 sm:grid-cols-2">
              <label class="block">
                <span class="nsfw-session-sheet__label">Modelo</span>
                <select v-model="modelAlias" class="nsfw-input w-full">
                  <option v-for="model in sessions.models" :key="model.alias" :value="model.alias">
                    {{ model.alias }}{{ model.available ? '' : ' (no detectado)' }}
                  </option>
                </select>
              </label>
              <label class="block">
                <span class="nsfw-session-sheet__label">Perfil</span>
                <select v-model="generationProfile" class="nsfw-input w-full">
                  <option value="quick">Rápido</option>
                  <option value="quality">Calidad</option>
                </select>
              </label>
              <div class="sm:col-span-2 flex flex-wrap items-center justify-between gap-3">
                <span class="text-xs text-[var(--nsfw-dim)]">
                  Se aplica al guardar en Dirección.
                </span>
                <button
                  type="button"
                  class="nsfw-btn-ghost"
                  :disabled="saving"
                  @click="saveOptions"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>
