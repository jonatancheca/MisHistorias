<template>
  <div
    class="nsfw-vn flex min-h-dvh flex-col overflow-x-hidden bg-[var(--nsfw-canvas)] text-[var(--nsfw-ink)]"
  >
    <div
      class="relative mx-auto flex w-full max-w-[100vw] flex-1 flex-col landscape:max-h-dvh landscape:flex-row lg:max-h-[min(100dvh,900px)] lg:max-w-5xl lg:flex-row"
    >
      <section
        class="relative min-h-[42vh] flex-1 overflow-hidden bg-[radial-gradient(circle_at_30%_20%,#2b2224,transparent_55%),linear-gradient(180deg,#171315,#100d0e)] portrait:min-h-[48vh] landscape:min-h-0 landscape:min-w-0"
        :style="backgroundStyle"
        role="button"
        tabindex="0"
        aria-label="Avanzar escena"
        @click="advance"
        @keydown.enter.prevent="advance"
        @keydown.space.prevent="advance"
      >
        <div class="pointer-events-none absolute inset-x-0 top-0 flex justify-between p-3 text-[10px] uppercase tracking-wide text-[var(--nsfw-faint)]">
          <span>{{ orientationLabel }}</span>
          <span>Audio: Próximamente</span>
        </div>

        <div class="absolute inset-0 flex items-end justify-center gap-3 px-3 pb-28 sm:gap-8 sm:px-8">
          <div
            v-for="member in composedSprites"
            :key="member.actorId"
            class="flex h-32 w-20 flex-col justify-end sm:h-44 sm:w-28"
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
              class="flex h-full w-full flex-col justify-end rounded-t-[2.5rem] bg-[var(--nsfw-soft)]/85 p-2 text-center sm:rounded-t-[3rem]"
            >
              <span class="text-[10px] uppercase tracking-wide text-[var(--nsfw-faint)]">sprite</span>
              <span class="truncate text-xs text-[var(--nsfw-gold)]">{{ member.name }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="activeCg"
          class="absolute inset-8 flex items-center justify-center rounded-2xl border border-[var(--nsfw-line)] bg-black/50 p-4 text-center"
        >
          <div>
            <p class="text-xs uppercase tracking-wide text-[var(--nsfw-faint)]">Scene CG</p>
            <p class="font-serif text-xl">{{ activeCg }}</p>
          </div>
        </div>

        <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 pb-5 sm:p-4 sm:pb-6">
          <p v-if="current?.unit.type === 'dialogue'" class="mb-1 text-sm text-[var(--nsfw-gold)]">
            {{ actorName(current.unit.actorId) }}
          </p>
          <p class="font-serif text-base leading-relaxed sm:text-lg">
            {{ current?.unit.text || 'Pulsa espacio o toca para comenzar / avanzar.' }}
          </p>
        </div>
      </section>

      <aside
        class="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-[var(--nsfw-line)] bg-[var(--nsfw-surface)] p-3 sm:p-4 landscape:w-[min(100%,18rem)] landscape:border-t-0 landscape:border-l lg:w-80 lg:border-t-0 lg:border-l"
      >
        <p class="text-xs uppercase tracking-[0.2em] text-[var(--nsfw-faint)]">VN · {{ session?.title }}</p>
        <p class="text-xs text-[var(--nsfw-muted)]">Historia privada</p>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="nsfw-btn-ghost" @click="backlogOpen = !backlogOpen">Backlog</button>
          <button type="button" class="nsfw-btn-ghost" :class="autoPlay ? 'text-[var(--nsfw-accent)]' : ''" @click="autoPlay = !autoPlay">
            Auto
          </button>
          <button type="button" class="nsfw-btn-ghost" :class="skipRead ? 'text-[var(--nsfw-accent)]' : ''" @click="skipRead = !skipRead">
            Skip leído
          </button>
          <button type="button" class="nsfw-btn-ghost" @click="manualSave">Guardar</button>
          <button type="button" class="nsfw-btn-ghost" @click="galleryOpen = !galleryOpen">Galería</button>
          <button type="button" class="nsfw-btn-ghost" @click="toggleFullscreen">Pantalla</button>
        </div>

        <div v-if="backlogOpen" class="max-h-40 space-y-2 overflow-y-auto text-sm text-[var(--nsfw-muted)] sm:max-h-48">
          <p v-for="item in flatUnits" :key="item.key">
            <span v-if="item.unit.type === 'dialogue'" class="text-[var(--nsfw-gold)]">{{ actorName(item.unit.actorId) }}: </span>
            {{ item.unit.text }}
          </p>
        </div>

        <div v-if="galleryOpen" class="nsfw-card space-y-2 text-sm">
          <p class="text-xs uppercase text-[var(--nsfw-faint)]">CGs vistos</p>
          <p v-if="seenCgs.length === 0" class="text-[var(--nsfw-muted)]">Aún no hay CGs registrados.</p>
          <p v-for="cg in seenCgs" :key="String(cg.id)">{{ cg.title }}</p>
        </div>

        <div v-if="attempt?.state === 'ready'" class="space-y-2">
          <p class="text-xs text-[var(--nsfw-faint)]">Provisional listo</p>
          <p class="text-sm text-[var(--nsfw-muted)]">{{ attempt.provisionalText }}</p>
          <button type="button" class="nsfw-btn-primary w-full" @click="onAccept">Aceptar</button>
        </div>

        <p v-if="localError" class="text-sm text-[var(--nsfw-danger)]">{{ localError }}</p>

        <NsfwAudioAffordances />

        <input v-model="draft" class="nsfw-input w-full" placeholder="Speak / Act…">
        <div class="flex gap-2">
          <button type="button" class="nsfw-btn-ghost flex-1" @click="submit('speak', draft)">Speak</button>
          <button type="button" class="nsfw-btn-ghost flex-1" @click="submit('act', draft)">Act</button>
        </div>

        <div class="text-xs text-[var(--nsfw-faint)]">
          Saves: {{ saves.length }}
          <span v-for="save in saves.slice(0, 3)" :key="save.id" class="ml-2">{{ save.label }}</span>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GenerationProfile, PlayerInput } from '../../../../../shared/types/nsfw/session.ts'

definePageMeta({ layout: 'private' })

const route = useRoute()
const sessions = useNsfwSessionsStore()
const sessionId = computed(() => String(route.params.sessionId || ''))

const draft = ref('')
const modelAlias = ref('')
const generationProfile = ref<GenerationProfile>('quick')
const localError = ref<string | null>(null)
const backlogOpen = ref(false)
const galleryOpen = ref(false)
const autoPlay = ref(false)
const skipRead = ref(false)
const unitCursor = ref(0)
const saves = ref<Array<{ id: string; label: string; isAutosave: boolean }>>([])
const readKeys = ref(new Set<string>())
const seenCgs = ref<Array<Record<string, unknown>>>([])
const isLandscape = ref(false)

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
  if (!modelAlias.value) modelAlias.value = currentSession.modelAlias
  generationProfile.value = currentSession.generationProfile
})

const beats = computed(() => sessions.play?.beats ?? [])
const attempt = computed(() => sessions.play?.activeAttempt ?? null)
const session = computed(() => sessions.play?.session ?? null)

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
    backgroundImage: `linear-gradient(180deg, rgba(16,13,14,0.15), rgba(16,13,14,0.55)), url(/api/private/studio/places/backgrounds/${backgroundId})`,
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

async function submit(kind: PlayerInput['kind'] = 'free', text = draft.value) {
  localError.value = null
  if (!session.value) return
  if (attempt.value && ['ready', 'streaming', 'validating'].includes(attempt.value.state)) return
  try {
    await sessions.generate(sessionId.value, {
      input: { kind, text: text.trim() },
      modelAlias: modelAlias.value || session.value.modelAlias,
      generationProfile: generationProfile.value
    })
    draft.value = ''
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
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      void advance()
    }
    if (event.key === 'Escape') backlogOpen.value = false
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
