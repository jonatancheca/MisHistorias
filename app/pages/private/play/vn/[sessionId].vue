<script setup lang="ts">
import type {
  GenerationProfile,
  PlayerInput,
  SessionSheetTab
} from '../../../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const route = useRoute()
const sessions = useNsfwSessionsStore()
const sessionId = computed(() => String(route.params.sessionId || ''))

const draft = ref('')
const writing = ref(false)
const modelAlias = ref('')
const generationProfile = ref<GenerationProfile>('quick')
const localError = ref<string | null>(null)
/** Un solo panel superpuesto con tres pestañas; el resto del chrome se retira. */
const panel = ref<'backlog' | 'gallery' | 'extras' | null>(null)
const autoPlay = ref(false)
const skipRead = ref(false)
const unitCursor = ref(0)
const saves = ref<Array<{ id: string; label: string; isAutosave: boolean }>>([])
const readKeys = ref(new Set<string>())
const seenCgs = ref<Array<Record<string, unknown>>>([])
const isLandscape = ref(false)
const sheet = ref<{ openSheet: (tab?: SessionSheetTab) => void } | null>(null)

await sessions.loadModels()
await sessions.loadPlay(sessionId.value)
await refreshSaves()
await refreshGallery()

watchEffect(() => {
  const currentSession = sessions.play?.session
  if (!currentSession) return
  if (currentSession.format !== 'vn') {
    void navigateTo(`/private/play/${currentSession.format === 'chat' ? 'chat' : 'story'}/${currentSession.id}`)
  }
})

watch(
  () => sessions.play?.session,
  (current) => {
    if (!current) return
    modelAlias.value = current.modelAlias
    generationProfile.value = current.generationProfile
  },
  { immediate: true }
)

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const session = computed(() => sessions.play?.session ?? null)
const busy = computed(
  () =>
    sessions.loading ||
    Boolean(attempt.value && ['requested', 'streaming', 'validating'].includes(attempt.value.state))
)

const flatUnits = computed(() =>
  beats.value.flatMap((beat) =>
    beat.envelope.visibleUnits.map((unit, unitIndex) => ({
      beatId: beat.id,
      unitIndex,
      unit,
      key: `${beat.id}:${unitIndex}`
    }))
  )
)

const current = computed(
  () => flatUnits.value[Math.min(unitCursor.value, Math.max(flatUnits.value.length - 1, 0))] ?? null
)

const lastChoices = computed(() => {
  const last = beats.value[beats.value.length - 1]
  return last?.envelope.choices ?? []
})

const activeCg = computed(() => {
  const last = beats.value[beats.value.length - 1]
  const cue = last?.envelope.visualCues?.find((item) => item.kind === 'scene_cg')
  return cue?.sceneCgAssetId || null
})

const orientationLabel = computed(() => (isLandscape.value ? 'Landscape' : 'Portrait'))

const backgroundStyle = computed(() => {
  const backgroundId = session.value?.assetPins?.placeBackgroundId
  if (!backgroundId) return undefined
  return {
    backgroundImage: `linear-gradient(180deg, rgba(14,11,12,0.15), rgba(14,11,12,0.55)), url(/api/private/studio/places/backgrounds/${backgroundId})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
})

const composedSprites = computed(() => {
  const pins = session.value?.assetPins?.characterSprites || {}
  return (session.value?.cast || [])
    .filter((member) => member.role === 'character')
    .map((member) => ({
      actorId: member.actorId,
      name: member.name,
      speaking: current.value?.unit.type === 'dialogue' && current.value.unit.actorId === member.actorId,
      src: pins[member.actorId]
        ? `/api/private/studio/sprites/${pins[member.actorId]}`
        : pins.companion && member.actorId === 'companion'
          ? `/api/private/studio/sprites/${pins.companion}`
          : ''
    }))
})

function actorName(actorId: string) {
  return session.value?.cast.find((member) => member.actorId === actorId)?.name || actorId
}

async function refreshSaves() {
  const result = await $fetch<{
    saves: Array<{ id: string; label: string; isAutosave: boolean }>
    readUnits: Array<{ beat_id: string; unit_index: number }>
  }>(`/api/private/sessions/${sessionId.value}/vn-saves`)
  saves.value = result.saves
  readKeys.value = new Set(result.readUnits.map((item) => `${item.beat_id}:${item.unit_index}`))
}

async function refreshGallery() {
  try {
    const result = await $fetch<{ cgs: Array<Record<string, unknown>> }>(
      `/api/private/sessions/${sessionId.value}/seen-cgs`
    )
    seenCgs.value = result.cgs
  } catch {
    seenCgs.value = []
  }
}

async function autosave() {
  await $fetch(`/api/private/sessions/${sessionId.value}/vn-saves`, {
    method: 'POST',
    body: {
      label: 'Autosave',
      isAutosave: true,
      headBeatId: session.value?.headBeatId,
      payload: { unitCursor: unitCursor.value }
    }
  })
  await refreshSaves()
}

async function manualSave() {
  await $fetch(`/api/private/sessions/${sessionId.value}/vn-saves`, {
    method: 'POST',
    body: {
      label: `Guardado ${new Date().toLocaleTimeString('es-ES')}`,
      headBeatId: session.value?.headBeatId,
      payload: { unitCursor: unitCursor.value }
    }
  })
  await refreshSaves()
}

async function markCurrentRead() {
  if (!current.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/read-units`, {
    method: 'POST',
    body: { beatId: current.value.beatId, unitIndexes: [current.value.unitIndex] }
  })
  readKeys.value.add(current.value.key)
}

async function advance() {
  if (writing.value || panel.value) return
  await markCurrentRead()
  if (unitCursor.value < flatUnits.value.length - 1) {
    let next = unitCursor.value + 1
    if (skipRead.value) {
      while (next < flatUnits.value.length && readKeys.value.has(flatUnits.value[next]!.key)) {
        next += 1
      }
    }
    unitCursor.value = Math.min(next, flatUnits.value.length - 1)
    await autosave()
    return
  }
  await submit('continue', '')
}

async function submit(kind: PlayerInput['kind'] = 'free', text = draft.value, choiceId?: string) {
  localError.value = null
  if (!session.value || busy.value) return
  if (attempt.value && ['ready', 'streaming', 'validating', 'requested'].includes(attempt.value.state)) {
    return
  }
  try {
    await sessions.generate(sessionId.value, {
      input: { kind, text: text.trim(), choiceId },
      modelAlias: modelAlias.value || session.value.modelAlias,
      generationProfile: generationProfile.value
    })
    draft.value = ''
    writing.value = false
  } catch (caught) {
    localError.value = (caught as Error).message || 'Error'
  }
}

async function onAccept() {
  if (!attempt.value) return
  await sessions.accept(sessionId.value, attempt.value.id)
  unitCursor.value = Math.max(flatUnits.value.length - 1, 0)
  await autosave()
  if (activeCg.value) {
    await $fetch(`/api/private/sessions/${sessionId.value}/seen-cgs`, {
      method: 'POST',
      body: { title: activeCg.value, tags: ['seen'] }
    })
    await refreshGallery()
  }
}

async function toggleHeart() {
  if (!session.value) return
  await $fetch(`/api/private/sessions/${sessionId.value}/escalation`, {
    method: 'POST',
    body: { value: !session.value.escalationHeart }
  })
  await sessions.loadPlay(sessionId.value)
}

function togglePanel(next: 'backlog' | 'gallery' | 'extras') {
  panel.value = panel.value === next ? null : next
}

function toggleFullscreen() {
  const root = document.documentElement
  if (!document.fullscreenElement) void root.requestFullscreen?.()
  else void document.exitFullscreen?.()
}

function syncOrientation() {
  isLandscape.value = window.matchMedia('(orientation: landscape)').matches
}

let autoTimer: ReturnType<typeof setInterval> | null = null
watch(autoPlay, (enabled) => {
  if (autoTimer) clearInterval(autoTimer)
  autoTimer = null
  if (!enabled) return
  autoTimer = setInterval(() => {
    void advance()
  }, 2800)
})

onMounted(() => {
  syncOrientation()
  const onKey = (event: KeyboardEvent) => {
    if (writing.value) {
      if (event.key === 'Escape') writing.value = false
      return
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      void advance()
    }
    if (event.key === 'Escape') panel.value = null
  }
  const onResize = () => syncOrientation()
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('resize', onResize)
    if (autoTimer) clearInterval(autoTimer)
  })
})
</script>

<template>
  <div class="nsfw-vn relative h-dvh overflow-hidden bg-[var(--nsfw-canvas)] text-[var(--nsfw-ink)]">
    <!-- Escenario -->
    <div
      class="absolute inset-0"
      :style="
        backgroundStyle || {
          background:
            'radial-gradient(70% 60% at 50% 30%, #2a2124, transparent 70%), linear-gradient(180deg, #191415, #0e0b0c)'
        }
      "
      role="button"
      tabindex="0"
      aria-label="Avanzar escena"
      @click="advance"
      @keydown.enter.prevent="advance"
      @keydown.space.prevent="advance"
    />
    <div
      class="pointer-events-none absolute inset-0"
      style="box-shadow: inset 0 0 160px 40px rgba(0, 0, 0, 0.6)"
    />

    <!-- Sprites -->
    <div
      class="pointer-events-none absolute inset-0 flex items-end justify-center gap-10 px-8 pb-[15rem] sm:gap-24 sm:px-16"
    >
      <div
        v-for="member in composedSprites"
        :key="member.actorId"
        class="flex h-40 w-24 flex-col justify-end transition sm:h-64 sm:w-40"
        :class="member.speaking ? '' : 'brightness-[.6]'"
        :title="member.name"
      >
        <img
          v-if="member.src"
          :src="member.src"
          :alt="member.name"
          class="h-full w-full object-contain object-bottom"
        >
        <div
          v-else
          class="flex h-full w-full flex-col items-center justify-end rounded-t-full border border-b-0 border-[var(--nsfw-hair)] bg-gradient-to-b from-[rgba(58,45,48,0.25)] to-[rgba(58,45,48,0.9)] pb-4"
        >
          <span class="text-[0.6rem] uppercase tracking-[0.2em] text-[var(--nsfw-dim)]">sprite</span>
          <span class="max-w-full truncate px-2 font-serif text-sm text-[var(--nsfw-gold)]">
            {{ member.name }}
          </span>
        </div>
      </div>
    </div>

    <div
      v-if="activeCg"
      class="pointer-events-none absolute inset-16 flex items-center justify-center rounded-2xl border border-[var(--nsfw-line)] bg-black/50 p-4 text-center"
    >
      <div>
        <p class="nsfw-eyebrow">Scene CG</p>
        <p class="font-serif text-xl">{{ activeCg }}</p>
      </div>
    </div>

    <!-- Chrome superior -->
    <div
      class="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-[0.66rem] uppercase tracking-[0.16em] text-[var(--nsfw-faint)]"
    >
      <span class="truncate">{{ session?.title }}</span>
      <div class="flex flex-wrap items-center gap-4">
        <button type="button" class="nsfw-btn-text uppercase tracking-[0.16em]" @click="togglePanel('backlog')">
          Backlog
        </button>
        <button
          type="button"
          class="nsfw-btn-text uppercase tracking-[0.16em]"
          :class="autoPlay ? '!text-[var(--nsfw-accent)]' : ''"
          @click="autoPlay = !autoPlay"
        >
          Auto
        </button>
        <button
          type="button"
          class="nsfw-btn-text uppercase tracking-[0.16em]"
          :class="skipRead ? '!text-[var(--nsfw-accent)]' : ''"
          @click="skipRead = !skipRead"
        >
          Skip
        </button>
        <button type="button" class="nsfw-btn-text uppercase tracking-[0.16em]" @click="manualSave">
          Guardar
        </button>
        <button type="button" class="nsfw-btn-text uppercase tracking-[0.16em]" @click="togglePanel('gallery')">
          Galería
        </button>
        <button type="button" class="nsfw-btn-text uppercase tracking-[0.16em]" @click="togglePanel('extras')">
          Extras
        </button>
        <button
          type="button"
          class="nsfw-btn-text uppercase tracking-[0.16em]"
          @click="sheet?.openSheet('direction')"
        >
          Director
        </button>
        <span class="h-3 w-px bg-[var(--nsfw-line)]" />
        <button type="button" class="nsfw-btn-text uppercase tracking-[0.16em]" @click="toggleFullscreen">
          Pantalla
        </button>
      </div>
    </div>

    <!-- Panel superpuesto: backlog, galería, extras -->
    <div
      v-if="panel"
      class="absolute inset-x-4 top-16 bottom-[16rem] z-20 flex flex-col overflow-hidden rounded-2xl border border-[var(--nsfw-line)] bg-[color-mix(in_srgb,var(--nsfw-raised)_95%,transparent)] backdrop-blur sm:inset-x-16"
    >
      <div class="nsfw-tabs shrink-0 px-6 pt-4">
        <button
          type="button"
          class="nsfw-tab"
          :class="panel === 'backlog' ? 'is-active' : ''"
          @click="panel = 'backlog'"
        >
          Backlog
        </button>
        <button
          type="button"
          class="nsfw-tab"
          :class="panel === 'gallery' ? 'is-active' : ''"
          @click="panel = 'gallery'"
        >
          Galería
        </button>
        <button
          type="button"
          class="nsfw-tab"
          :class="panel === 'extras' ? 'is-active' : ''"
          @click="panel = 'extras'"
        >
          Extras
        </button>
        <span class="flex-1" />
        <button type="button" class="nsfw-btn-text pb-2.5 text-lg leading-none" aria-label="Cerrar" @click="panel = null">
          ×
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div v-if="panel === 'backlog'" class="nsfw-prose !max-w-none">
          <p v-if="!flatUnits.length" class="text-sm text-[var(--nsfw-muted)]">Sin diálogo aún.</p>
          <p v-for="item in flatUnits" :key="item.key" class="!mb-4">
            <span v-if="item.unit.type === 'dialogue'" class="nsfw-speaker">
              {{ actorName(item.unit.actorId) }}
            </span>
            {{ item.unit.text }}
          </p>
        </div>

        <div v-else-if="panel === 'gallery'">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim">CGs vistos</p>
          <p v-if="!seenCgs.length" class="text-sm text-[var(--nsfw-muted)]">
            Aún no hay CGs registrados.
          </p>
          <p v-for="cg in seenCgs" :key="String(cg.id)" class="font-serif text-lg">
            {{ cg.title }}
          </p>
        </div>

        <div v-else class="flex flex-col gap-6">
          <div>
            <p class="nsfw-eyebrow nsfw-eyebrow--dim">Guardados · {{ saves.length }}</p>
            <p v-if="!saves.length" class="text-sm text-[var(--nsfw-muted)]">Todavía ninguno.</p>
            <p
              v-for="save in saves.slice(0, 8)"
              :key="save.id"
              class="border-b border-[var(--nsfw-hair)] py-2 text-sm text-[var(--nsfw-muted)]"
            >
              {{ save.label }}
              <span v-if="save.isAutosave" class="text-[var(--nsfw-dim)]"> · auto</span>
            </p>
          </div>
          <NsfwAudioAffordances />
          <NsfwFeedbackStrip
            :session-id="sessionId"
            :attempt-id="attempt?.id"
            :beat-count="beats.length"
          />
          <p class="text-xs text-[var(--nsfw-dim)]">Orientación: {{ orientationLabel }}</p>
        </div>
      </div>
    </div>

    <!-- Caja de diálogo -->
    <div class="absolute inset-x-0 bottom-0 px-5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-12 lg:pb-8">
      <div class="relative mx-auto max-w-[54rem]">
        <span
          v-if="current?.unit.type === 'dialogue'"
          class="absolute -top-4 left-0 inline-flex items-center rounded-full border border-[color-mix(in_srgb,var(--nsfw-gold)_35%,transparent)] bg-[var(--nsfw-raised)] px-4 py-1 font-serif text-[0.95rem] text-[var(--nsfw-gold)]"
        >
          {{ actorName(current.unit.actorId) }}
        </span>

        <div
          class="rounded-2xl border border-[var(--nsfw-line)] bg-[color-mix(in_srgb,var(--nsfw-canvas)_86%,transparent)] px-7 pt-8 pb-5 backdrop-blur"
        >
          <p class="mb-5 font-serif text-[1.35rem] leading-[1.55] text-[var(--nsfw-ink)]">
            {{ current?.unit.text || 'Pulsa espacio o toca para comenzar / avanzar.' }}
          </p>

          <div v-if="busy" class="nsfw-loading-pulse mb-4 text-xs text-[var(--nsfw-faint)]" aria-live="polite">
            Esperando respuesta del modelo…
          </div>

          <div
            v-if="attempt?.state === 'ready'"
            class="mb-4 flex flex-wrap items-center gap-4 border-t border-[var(--nsfw-hair)] pt-4"
          >
            <p class="min-w-0 flex-1 truncate text-xs text-[var(--nsfw-muted)]">
              {{ attempt.provisionalText || 'Provisional listo' }}
            </p>
            <button type="button" class="nsfw-btn-primary" :disabled="busy" @click="onAccept">
              Aceptar
            </button>
          </div>

          <p v-if="localError" class="mb-3 text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

          <div v-if="writing" class="mb-4 flex flex-wrap items-center gap-3">
            <label class="min-w-[12rem] flex-1">
              <span class="sr-only">Escribe tu turno</span>
              <input
                v-model="draft"
                class="nsfw-underline !text-base"
                :disabled="busy"
                placeholder="Qué dices o qué haces…"
                @keydown.enter.prevent="submit('speak', draft)"
              >
            </label>
            <button type="button" class="nsfw-btn-text" :disabled="busy" @click="submit('speak', draft)">
              Hablar
            </button>
            <button type="button" class="nsfw-btn-text" :disabled="busy" @click="submit('act', draft)">
              Actuar
            </button>
            <button type="button" class="nsfw-btn-text" @click="writing = false">Cancelar</button>
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--nsfw-hair)] pt-3.5"
          >
            <div class="flex flex-wrap gap-2">
              <button
                v-for="(choice, index) in lastChoices"
                :key="choice.id"
                type="button"
                class="nsfw-choice"
                :class="choice.prominence === 'primary' ? 'is-primary' : ''"
                @click="submit(choice.kind === 'choice' ? 'choice' : choice.kind, choice.label, choice.id)"
              >
                <span class="mr-2 text-[var(--nsfw-dim)]">{{ index + 1 }}</span>{{ choice.label }}
              </button>
              <button type="button" class="nsfw-choice" @click="writing = true">
                <span class="mr-2 text-[var(--nsfw-dim)]">{{ lastChoices.length + 1 }}</span>
                Escribir algo
              </button>
              <button
                type="button"
                class="nsfw-heat-btn"
                :aria-pressed="Boolean(session?.escalationHeart)"
                title="Subir la temperatura de la escena"
                @click="toggleHeart"
              >
                <span aria-hidden="true">♥</span>
                {{ session?.escalationHeart ? 'Bajar' : 'Subir' }}
              </button>
            </div>
            <span class="text-[0.66rem] uppercase tracking-[0.14em] text-[var(--nsfw-dim)]">
              Espacio ▸
            </span>
          </div>
        </div>
      </div>
    </div>

    <NsfwSessionSheet ref="sheet" :session-id="sessionId" hide-trigger />
  </div>
</template>
