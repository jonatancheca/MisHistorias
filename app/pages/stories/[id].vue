<script setup lang="ts">
import type {
  GenerationMode,
  LlmDebugTrace,
  Message,
  StoryCharacterCustomization
} from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'
import { primaryTag } from '~/lib/tags'
import { buildVisualNovelFrames } from '~/lib/visualNovelFrames'

const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const settings = useSettingsStore()
const confirmDialog = useConfirmStore()
const {
  hidden: mobileChromeHidden,
  hide: hideMobileChrome,
  show: showMobileChrome
} = useMobileChrome()

await Promise.all([
  characters.load(),
  backgrounds.load(),
  settings.load(),
  stories.openStory(String(route.params.id))
])

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const timelineContent = ref<HTMLElement | null>(null)
const canScrollToTop = ref(false)
const canScrollToBottom = ref(false)
const selectedDebugTrace = ref<LlmDebugTrace | null>(null)
const storyPreferencesOpen = ref(false)
const storyPremise = ref('')
const storyPreferences = ref('')
const storyPreferencesMode = ref<'append' | 'replace'>('append')
const storyCharacterCustomizations = ref<StoryCharacterCustomization[]>([])
const storyCustomizationRows = computed(() =>
  storyCharacterCustomizations.value.map((customization) => ({
    customization,
    character: characters.byId(customization.characterId)
  }))
)
const characterTagSuggestions = computed(() =>
  characters.characters.flatMap((character) => character.tags ?? [])
)
const followingBottom = ref(true)
let lastScrollTop = 0
let autoScrollTarget: number | null = null
let accumulatedScroll = 0
let desktopMedia: MediaQueryList | null = null
let timelineResizeObserver: ResizeObserver | null = null
let followScrollFrame: number | null = null
let followSettleFrame: number | null = null

type TimelineItem =
  | { kind: 'message'; id: string; createdAt: number; message: Message }
  | { kind: 'trace'; id: string; createdAt: number; trace: LlmDebugTrace }

const timeline = computed<TimelineItem[]>(() => {
  return [
    ...stories.messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      createdAt: message.createdAt,
      message
    })),
    ...stories.debugTraces
      .filter((trace) => trace.status === 'error' || !trace.responseMessageId)
      .map((trace) => ({
        kind: 'trace' as const,
        id: trace.id,
        createdAt: trace.createdAt,
        trace
      }))
  ].sort((a, b) => a.createdAt - b.createdAt)
})

function debugForMessage(id: string) {
  return stories.debugTraces.find((trace) => trace.responseMessageId === id) ?? null
}

function traceErrorMessage(trace: LlmDebugTrace) {
  if ('error' in trace.response) return trace.response.error
  if (trace.response.finishReason === 'length') {
    return 'El modelo alcanzó el máximo de tokens antes de devolver contenido visible.'
  }
  return 'El modelo no devolvió contenido visible.'
}

const lastDialogue = computed(() => {
  for (let index = stories.messages.length - 1; index >= 0; index -= 1) {
    const message = stories.messages[index]!
    for (let cursor = message.segments.length - 1; cursor >= 0; cursor -= 1) {
      const segment = message.segments[cursor]!
      if (segment.type === 'dialogue' && segment.characterId) return segment
    }
  }
  return null
})

function updateScrollControls() {
  if (!scroller.value) {
    canScrollToTop.value = false
    canScrollToBottom.value = false
    return
  }
  const maximum = Math.max(0, scroller.value.scrollHeight - scroller.value.clientHeight)
  canScrollToTop.value = scroller.value.scrollTop > 1
  canScrollToBottom.value = !followingBottom.value || scroller.value.scrollTop < maximum - 1
}

function scrollFollowingToBottom() {
  if (!followingBottom.value || !scroller.value) return
  const maximum = Math.max(0, scroller.value.scrollHeight - scroller.value.clientHeight)
  autoScrollTarget = maximum
  scroller.value.scrollTo({ top: maximum, behavior: 'auto' })
  lastScrollTop = scroller.value.scrollTop
  updateScrollControls()
}

function scheduleFollowBottom() {
  if (
    stories.activeStory?.visualMode ||
    !followingBottom.value ||
    followScrollFrame !== null ||
    followSettleFrame !== null
  ) return
  followScrollFrame = requestAnimationFrame(() => {
    followScrollFrame = null
    if (!followingBottom.value) return
    scrollFollowingToBottom()
    followSettleFrame = requestAnimationFrame(() => {
      followSettleFrame = null
      scrollFollowingToBottom()
    })
  })
}

function scrollToTop() {
  if (!scroller.value) return
  followingBottom.value = false
  autoScrollTarget = 0
  showMobileChrome()
  scroller.value.scrollTo({ top: 0, behavior: 'smooth' })
  updateScrollControls()
}

async function scrollToBottom(behavior: ScrollBehavior = 'auto', resume = true) {
  if (resume) followingBottom.value = true
  await nextTick()
  if (!scroller.value) return
  if (behavior === 'auto') {
    scrollFollowingToBottom()
    scheduleFollowBottom()
    return
  }
  const maximum = Math.max(0, scroller.value.scrollHeight - scroller.value.clientHeight)
  autoScrollTarget = maximum
  scroller.value.scrollTo({ top: maximum, behavior })
  updateScrollControls()
}

async function resumeFollowingBottom() {
  followingBottom.value = true
  autoScrollTarget = null
  await nextTick()
  scrollFollowingToBottom()
  scheduleFollowBottom()
}

async function toggleVisualMode() {
  if (!stories.activeStory || stories.generating) return
  const visualMode = !stories.activeStory.visualMode
  await stories.setVisualMode(visualMode)
  if (visualMode) {
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
  } else {
    await resumeFollowingBottom()
  }
}

async function submit() {
  const text = input.value
  if (!text.trim() || stories.generating) return
  followingBottom.value = true
  scheduleFollowBottom()
  input.value = ''
  await stories.send(text)
}

async function generateOpening() {
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.generate()
}

async function generateContinuation(mode: Exclude<GenerationMode, 'normal'>) {
  if (stories.generating) return
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.generate(mode)
}

const isEmpty = computed(() => timeline.value.length === 0 && !stories.generating)

watch(timeline, () => scheduleFollowBottom(), { deep: true, flush: 'post' })
watch(
  () => [stories.waitingForResponse, stories.error],
  () => scheduleFollowBottom(),
  { flush: 'post' }
)

function onTimelineAssetLoad(event: Event) {
  if (event.target instanceof HTMLImageElement) scheduleFollowBottom()
}

function onStoryScroll() {
  const current = scroller.value?.scrollTop ?? 0
  const delta = current - lastScrollTop
  lastScrollTop = current

  if (autoScrollTarget !== null) {
    const reachedTarget = Math.abs(current - autoScrollTarget) <= 1
    const movingTowardTarget = autoScrollTarget === 0 ? delta <= 0 : delta >= 0
    if (reachedTarget) autoScrollTarget = null
    if (reachedTarget || movingTowardTarget) {
      updateScrollControls()
      return
    }
    autoScrollTarget = null
  }

  if (delta < -1) {
    followingBottom.value = false
    accumulatedScroll = 0
    showMobileChrome()
    updateScrollControls()
    return
  }
  updateScrollControls()
  if (window.innerWidth >= 640) {
    showMobileChrome()
    return
  }

  if (current <= 8) {
    accumulatedScroll = 0
    showMobileChrome()
    return
  }
  if (Math.sign(delta) !== Math.sign(accumulatedScroll)) accumulatedScroll = 0
  accumulatedScroll += delta
  if (accumulatedScroll >= 12) {
    hideMobileChrome()
    accumulatedScroll = 0
  } else if (accumulatedScroll <= -4) {
    showMobileChrome()
    accumulatedScroll = 0
  }
}

function openStoryPreferences() {
  if (!stories.activeStory) return
  storyPremise.value = stories.activeStory.premise
  storyPreferences.value = stories.activeStory.protagonistPreferences ?? ''
  storyPreferencesMode.value = stories.activeStory.protagonistPreferencesMode ?? 'append'
  const stored = new Map(
    (stories.activeStory.characterCustomizations ?? []).map((item) => [item.characterId, item])
  )
  storyCharacterCustomizations.value = stories.activeStory.characterIds.flatMap((characterId) => {
    const source = stored.get(characterId) ?? characters.byId(characterId)
    return source
      ? [
          {
            characterId,
            prompt: source.prompt,
            tags: [...source.tags]
          }
        ]
      : []
  })
  storyPreferencesOpen.value = true
}

async function saveStoryPreferences() {
  if (!storyPremise.value.trim()) return
  await stories.updateStorySettings(
    storyPremise.value,
    storyPreferences.value,
    storyPreferencesMode.value,
    storyCharacterCustomizations.value.map((item) => ({ ...item, tags: [...item.tags] }))
  )
  storyPreferencesOpen.value = false
}

async function removeMessage(id: string) {
  const accepted = await confirmDialog.ask({
    title: 'Borrar mensaje',
    message: 'Este mensaje se borrará definitivamente.'
  })
  if (accepted) await stories.removeMessage(id)
}

async function regenerateFrom(id: string) {
  const index = stories.messages.findIndex((message) => message.id === id)
  if (index < 0) return
  const following = stories.messages.length - index - 1
  const accepted = await confirmDialog.ask({
    title: 'Regenerar desde aquí',
    message: following
      ? `Se borrarán esta respuesta y ${following} mensajes posteriores antes de generar otra.`
      : 'Se borrará esta respuesta antes de generar otra.',
    confirmLabel: 'Regenerar'
  })
  if (accepted) {
    followingBottom.value = true
    scheduleFollowBottom()
    await stories.regenerateFrom(id)
  }
}

async function resendFrom(id: string) {
  const index = stories.messages.findIndex((message) => message.id === id)
  if (index < 0) return
  const following = stories.messages.length - index - 1
  const deleted = following === 1 ? '1 mensaje posterior' : `${following} mensajes posteriores`
  const accepted = await confirmDialog.ask({
    title: 'Reenviar desde aquí',
    message: following
      ? `Se borrarán ${deleted} antes de generar otra respuesta.`
      : 'Se reenviará este mensaje para generar otra respuesta.',
    confirmLabel: 'Reenviar'
  })
  if (accepted) {
    followingBottom.value = true
    scheduleFollowBottom()
    await stories.resendFrom(id)
  }
}

function onBreakpointChange(event: MediaQueryListEvent) {
  if (event.matches) showMobileChrome()
}

onMounted(() => {
  desktopMedia = window.matchMedia('(min-width: 640px)')
  desktopMedia.addEventListener('change', onBreakpointChange)
  timelineResizeObserver = new ResizeObserver(scheduleFollowBottom)
  if (timelineContent.value) timelineResizeObserver.observe(timelineContent.value)
  if (scroller.value) timelineResizeObserver.observe(scroller.value)
  timelineContent.value?.addEventListener('load', onTimelineAssetLoad, true)
  window.addEventListener('keydown', onVisualNovelKeydown)
  if (!stories.activeStory?.visualMode) void scrollToBottom()
})

const initialBackground = computed(() =>
  backgrounds.byId(stories.activeStory?.initialBackgroundId)
)

const currentBackground = computed(() => {
  let id = stories.activeStory?.initialBackgroundId ?? null
  let tag = primaryTag(backgrounds.byId(id))
  for (const message of stories.messages) {
    for (const segment of message.segments) {
      if (segment.type !== 'background') continue
      id = Object.prototype.hasOwnProperty.call(segment, 'backgroundId')
        ? (segment.backgroundId ?? null)
        : backgrounds.byTag(segment.tag)?.id ?? null
      tag = segment.tag
    }
  }
  return { id, tag }
})

const visualFrames = computed(() =>
  buildVisualNovelFrames(stories.messages, {
    initialBackgroundId: stories.activeStory?.initialBackgroundId ?? null,
    initialBackgroundTag: primaryTag(initialBackground.value),
    resolveBackgroundId: (tag) => backgrounds.byTag(tag)?.id ?? null
  })
)
const visualFrameIndex = ref(Math.max(0, visualFrames.value.length - 1))
const activeVisualFrame = computed(() => visualFrames.value[visualFrameIndex.value] ?? null)
const canShowPreviousVisualFrame = computed(() => visualFrameIndex.value > 0)
const canShowNextVisualFrame = computed(
  () => visualFrameIndex.value < visualFrames.value.length - 1
)
const visualBackground = computed(() => ({
  id: activeVisualFrame.value?.backgroundId ?? stories.activeStory?.initialBackgroundId ?? null,
  tag: activeVisualFrame.value?.backgroundTag ?? primaryTag(initialBackground.value)
}))
const visualCharacterStates = computed(() =>
  activeVisualFrame.value?.characterState ? [activeVisualFrame.value.characterState] : []
)
const visualCharacterIds = computed(() =>
  activeVisualFrame.value?.characterState
    ? [activeVisualFrame.value.characterState.characterId]
    : []
)
const visualSpeaker = computed(() => {
  const frame = activeVisualFrame.value
  if (!frame || frame.kind === 'narration') return null
  if (frame.kind === 'dialogue' && frame.characterState) {
    return {
      name: characters.byId(frame.characterState.characterId)?.name ?? 'Personaje',
      color: characters.colorOf(frame.characterState.characterId)
    }
  }
  return {
    name: settings.activeUserName,
    color: normalizeColor(settings.settings.userColor, DEFAULT_USER_COLOR)
  }
})

watch(
  () => visualFrames.value.length,
  (length, previousLength) => {
    if (length === 0) {
      visualFrameIndex.value = 0
      return
    }
    const wasAtEnd = previousLength === 0 || visualFrameIndex.value >= previousLength - 1
    visualFrameIndex.value = wasAtEnd
      ? length - 1
      : Math.min(visualFrameIndex.value, length - 1)
  }
)

function showPreviousVisualFrame() {
  if (canShowPreviousVisualFrame.value) visualFrameIndex.value -= 1
}

function showNextVisualFrame() {
  if (canShowNextVisualFrame.value) visualFrameIndex.value += 1
}

function onVisualFrameClick(event: MouseEvent) {
  if (window.innerWidth >= 640) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  if (event.clientX < bounds.left + bounds.width / 2) {
    showPreviousVisualFrame()
  } else {
    showNextVisualFrame()
  }
}

function onVisualNovelKeydown(event: KeyboardEvent) {
  if (!stories.activeStory?.visualMode) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches('input, textarea, select, [contenteditable="true"]'))
  ) return

  if (event.key === 'ArrowLeft' && canShowPreviousVisualFrame.value) {
    event.preventDefault()
    showPreviousVisualFrame()
  } else if (event.key === 'ArrowRight' && canShowNextVisualFrame.value) {
    event.preventDefault()
    showNextVisualFrame()
  }
}

onBeforeUnmount(() => {
  desktopMedia?.removeEventListener('change', onBreakpointChange)
  timelineContent.value?.removeEventListener('load', onTimelineAssetLoad, true)
  timelineResizeObserver?.disconnect()
  window.removeEventListener('keydown', onVisualNovelKeydown)
  if (followScrollFrame !== null) cancelAnimationFrame(followScrollFrame)
  if (followSettleFrame !== null) cancelAnimationFrame(followSettleFrame)
  showMobileChrome()
})
</script>

<template>
  <div v-if="!stories.activeStory" class="p-8">
    <p class="card text-sm">Historia no encontrada.</p>
  </div>

  <div v-else class="flex h-full min-h-0">
    <section class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-4 transition-[max-height,opacity,padding,transform] duration-200 sm:max-h-none sm:translate-y-0 sm:px-6 sm:py-4 sm:opacity-100"
        :class="
          mobileChromeHidden
            ? 'max-h-0 -translate-y-2 overflow-hidden border-b-0 py-0 opacity-0'
            : 'max-h-24 translate-y-0 py-3 opacity-100'
        "
      >
        <div class="min-w-0">
          <h1 class="truncate text-lg font-bold">
            {{ stories.activeStory.title }}
            <span
              v-if="settings.settings.mockMode"
              class="ml-2 rounded-full bg-brand-500/15 px-2 py-0.5 align-middle text-xs font-semibold text-brand-600"
            >
              modo prueba
            </span>
          </h1>
          <p class="truncate text-xs text-[var(--color-fg-muted)]">
            {{ stories.activeStory.premise }}
          </p>
        </div>
        <div class="flex shrink-0 gap-1 sm:gap-2">
          <template v-if="!stories.activeStory.visualMode">
          <button
            type="button"
            class="btn-ghost h-10 w-10 shrink-0 px-0 py-0"
            aria-label="Volver al principio"
            title="Volver al principio"
            :disabled="!canScrollToTop"
            @click="scrollToTop"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 4h14M12 20V7m-5 5 5-5 5 5" />
            </svg>
          </button>
          <button
            type="button"
            class="btn-ghost h-10 w-10 shrink-0 px-0 py-0"
            aria-label="Volver al final"
            title="Volver al final"
            :disabled="!canScrollToBottom"
            @click="resumeFollowingBottom"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 20h14M12 4v13m-5-5 5 5 5-5" />
            </svg>
          </button>
          </template>
          <span
            v-if="stories.activeStory.visualMode"
            data-testid="visual-novel-counter"
            class="flex h-10 shrink-0 items-center text-xs text-[var(--color-fg-muted)]"
          >
            {{ visualFrames.length ? visualFrameIndex + 1 : 0 }} / {{ visualFrames.length }}
          </span>
          <button
            type="button"
            class="btn-ghost"
            data-testid="visual-mode-toggle"
            :aria-label="stories.activeStory.visualMode ? 'Desactivar modo novela visual' : 'Activar modo novela visual'"
            :title="stories.activeStory.visualMode ? 'Desactivar modo novela visual' : 'Activar modo novela visual'"
            :aria-pressed="stories.activeStory.visualMode"
            :disabled="stories.generating"
            @click="toggleVisualMode"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="m3 15 5-5 4 4 3-3 6 6M8 8h.01" />
            </svg>
            <span>{{ stories.activeStory.visualMode ? 'Chat' : 'Novela' }}</span>
          </button>
          <button
            type="button"
            class="btn-ghost"
            aria-label="Ajustes de la historia"
            title="Ajustes de la historia"
            :disabled="stories.generating"
            @click="openStoryPreferences"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
            </svg>
            <span class="hidden sm:inline">Ajustes</span>
          </button>
        </div>
      </header>

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <div
          v-if="stories.activeStory.visualMode"
          data-testid="visual-novel-view"
          class="flex h-full min-h-0 flex-col bg-slate-950"
        >
          <div class="min-h-0 flex-1">
            <VisualNovelStage
              :character-ids="visualCharacterIds"
              :character-states="visualCharacterStates"
              :background-id="visualBackground.id"
              :background-tag="visualBackground.tag"
            />
          </div>

          <section
            data-testid="visual-novel-dialogue"
            class="h-24 shrink-0 overflow-hidden border-t border-white/20 bg-slate-950 text-white shadow-[0_-10px_30px_rgba(0,0,0,0.35)] sm:h-[120px]"
            aria-live="polite"
          >
            <div class="grid h-full grid-cols-1 sm:grid-cols-[4rem_minmax(0,1fr)_4rem]">
              <button
                type="button"
                class="btn-ghost hidden h-full w-full rounded-none px-0 py-0 text-white disabled:text-slate-500 sm:flex"
                data-testid="visual-novel-previous"
                aria-label="Frase anterior"
                title="Frase anterior"
                :disabled="!canShowPreviousVisualFrame"
                @click="showPreviousVisualFrame"
              >
                <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>

              <div
                data-testid="visual-novel-frame"
                class="h-full min-w-0 overflow-y-auto px-4 py-3 text-center sm:px-6 sm:py-4"
                @click="onVisualFrameClick"
              >
                <template v-if="activeVisualFrame">
                  <p
                    class="text-[15px] leading-relaxed whitespace-pre-wrap sm:text-base"
                    :class="activeVisualFrame.kind === 'narration' ? 'italic text-slate-300' : ''"
                    :style="visualSpeaker ? { color: visualSpeaker.color } : undefined"
                  >
                    <span v-if="visualSpeaker" class="font-semibold">{{ `${visualSpeaker.name}: ` }}</span><span>{{ activeVisualFrame.text }}</span>
                  </p>
                </template>
                <p v-else class="text-sm text-slate-300">La historia aún no ha empezado.</p>
              </div>

              <button
                type="button"
                class="btn-ghost hidden h-full w-full rounded-none px-0 py-0 text-white disabled:text-slate-500 sm:flex"
                data-testid="visual-novel-next"
                aria-label="Frase siguiente"
                title="Frase siguiente"
                :disabled="!canShowNextVisualFrame"
                @click="showNextVisualFrame"
              >
                <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </section>
        </div>

        <div
          v-show="!stories.activeStory.visualMode"
          ref="scroller"
          data-testid="story-scroller"
          class="relative z-10 h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6"
          @scroll.passive="onStoryScroll"
        >
          <div ref="timelineContent" class="mx-auto max-w-5xl space-y-3">
          <figure
            v-if="!stories.activeStory.visualMode && stories.activeStory.initialBackgroundId"
            class="mb-5"
          >
            <ImageLightbox
              v-if="initialBackground && backgrounds.urlFor(initialBackground.id)"
              :src="backgrounds.urlFor(initialBackground.id)!"
              :alt="`Fondo inicial ${primaryTag(initialBackground) ?? ''}`"
              container-class="w-full"
              image-class="max-h-[32rem] w-full rounded-2xl bg-black/5 object-contain"
            />
            <div
              v-else
              class="rounded-xl border border-dashed border-[var(--color-border-soft)] p-4 text-sm text-[var(--color-fg-muted)]"
            >
              Fondo inicial · fondo no disponible
            </div>
            <figcaption v-if="initialBackground" class="mt-1 text-xs text-[var(--color-fg-muted)]">
              Fondo inicial · {{ primaryTag(initialBackground) }}
            </figcaption>
          </figure>

          <div v-if="isEmpty" class="card text-sm text-[var(--color-fg-muted)]">
            La historia aún no ha empezado.
            <button type="button" class="text-brand-600 underline" @click="generateOpening">
              Deja que el narrador abra la escena
            </button>
            o escribe tú el primer movimiento.
          </div>

          <template v-for="item in timeline" :key="`${item.kind}-${item.id}`">
            <MessageBubble
              v-if="item.kind === 'message'"
              :message="item.message"
              :debug-trace="debugForMessage(item.message.id)"
              :editable="!stories.generating"
              :visual-mode="stories.activeStory.visualMode"
              @debug="selectedDebugTrace = $event"
              @edit="stories.updateMessage(item.message.id, $event)"
              @remove="removeMessage(item.message.id)"
              @regenerate="regenerateFrom(item.message.id)"
              @resend="resendFrom(item.message.id)"
            />

            <div v-else class="group flex min-w-0 items-start gap-2">
              <div
                class="flex w-8 shrink-0 text-red-500 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              >
                <button
                  type="button"
                  class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-red-500/10"
                  aria-label="Ver datos de debug del error LLM"
                  title="Debug LLM"
                  @click="selectedDebugTrace = item.trace"
                >
                  <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 2h8M9 2v3m6-3v3M4 13h3m10 0h3M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2" />
                    <rect x="7" y="5" width="10" height="16" rx="5" />
                    <path d="M9 11h6m-6 4h6" />
                  </svg>
                </button>
              </div>
              <p
                class="min-w-0 flex-1 rounded-lg bg-red-500/10 px-4 py-2 text-sm break-words text-red-500"
                role="alert"
              >
                {{ traceErrorMessage(item.trace) }}
              </p>
            </div>
          </template>

          <div
            v-if="stories.waitingForResponse"
            data-testid="thinking-indicator"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-alt)] px-4 py-3 text-sm text-[var(--color-fg-muted)]"
            role="status"
            aria-live="polite"
          >
            <span>La IA está pensando…</span>
            <span class="flex items-center gap-1" aria-hidden="true">
              <span class="h-2 w-2 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none" />
              <span
                class="h-2 w-2 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none"
                style="animation-delay: 120ms"
              />
              <span
                class="h-2 w-2 animate-bounce rounded-full bg-brand-500 motion-reduce:animate-none"
                style="animation-delay: 240ms"
              />
            </span>
          </div>

          <p
            v-if="stories.error"
            class="rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-500"
            role="alert"
          >
            {{ stories.error }}
          </p>
          </div>
        </div>
      </div>

      <footer
        class="border-t border-[var(--color-border-soft)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-4"
      >
        <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submit">
          <textarea
            v-model="input"
            autocomplete="off"
            class="field min-h-12 min-w-0 resize-none"
            rows="2"
            placeholder="Escribe lo que haces o dices…"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="grid shrink-0 grid-cols-3 gap-2 sm:w-56">
            <button type="submit" class="btn-primary" :disabled="stories.generating">Enviar</button>
            <span class="group relative min-w-0">
              <button
                type="button"
                class="btn-ghost w-full"
                data-testid="continue-button"
                aria-describedby="continue-tooltip"
                aria-label="Continuar sin decidir por el protagonista"
                :disabled="stories.generating"
                @click="generateContinuation('continue')"
              >
                Sigue
              </button>
              <span
                id="continue-tooltip"
                role="tooltip"
                class="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
              >
                Continúa la historia sin que la IA hable ni decida por el protagonista.
              </span>
            </span>
            <span class="group relative min-w-0">
              <button
                type="button"
                class="btn-ghost w-full"
                data-testid="auto-button"
                aria-describedby="auto-tooltip"
                aria-label="Continuar permitiendo que la IA decida por el protagonista"
                :disabled="stories.generating"
                @click="generateContinuation('auto')"
              >
                Auto
              </button>
              <span
                id="auto-tooltip"
                role="tooltip"
                class="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
              >
                Continúa la historia y permite que la IA decida acciones o diálogos del protagonista.
              </span>
            </span>
            <button
              v-if="stories.generating"
              type="button"
              class="btn-ghost col-span-3"
              @click="stories.stop({ preserveAutoResponse: true })"
            >
              Parar
            </button>
          </div>
        </form>
      </footer>
    </section>

    <div
      v-if="!stories.activeStory.visualMode"
      class="hidden w-64 shrink-0 overflow-y-auto border-l border-[var(--color-border-soft)] p-4 lg:block"
    >
      <SceneStage
        :character-ids="stories.activeStory.characterIds"
        :active-character-id="lastDialogue?.characterId ?? null"
        :active-tag="lastDialogue?.tag ?? null"
        :active-image-id="lastDialogue?.imageId ?? null"
        :background-id="currentBackground.id"
        :background-tag="currentBackground.tag"
      />
    </div>

    <Teleport to="body">
      <div
        v-if="storyPreferencesOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
        @click.self="storyPreferencesOpen = false"
        @keydown.esc.stop.prevent="storyPreferencesOpen = false"
      >
        <form
          class="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
          @submit.prevent="saveStoryPreferences"
        >
          <h2 class="text-lg font-bold">Ajustes de la historia</h2>
          <div class="mt-4 grid gap-4">
            <div>
              <label class="label" for="storyPremise">Planteamiento</label>
              <textarea
                id="storyPremise"
                v-model="storyPremise"
                autocomplete="off"
                class="field min-h-32"
                autofocus
                required
              />
            </div>
            <div>
              <label class="label" for="storyProtagonistPreferences">Preferencias de esta historia</label>
              <textarea
                id="storyProtagonistPreferences"
                v-model="storyPreferences"
                autocomplete="off"
                class="field min-h-32"
              />
            </div>
            <div>
              <label class="label" for="storyProtagonistPreferencesMode">Combinar con globales</label>
              <select
                id="storyProtagonistPreferencesMode"
                v-model="storyPreferencesMode"
                class="field"
              >
                <option value="append">Añadir</option>
                <option value="replace">Reemplazar</option>
              </select>
            </div>
            <div v-if="storyCustomizationRows.length" class="grid gap-3">
              <div>
                <span class="label">Personalización de personajes</span>
                <p class="text-xs text-[var(--color-fg-muted)]">
                  Copia independiente. No modifica los personajes globales.
                </p>
              </div>
              <section
                v-for="row in storyCustomizationRows"
                :key="row.customization.characterId"
                class="rounded-xl border border-[var(--color-border-soft)] p-4"
              >
                <h3 class="font-semibold">
                  {{ row.character?.name ?? 'Personaje no disponible' }}
                </h3>
                <div class="mt-3 grid gap-3">
                  <div>
                    <label
                      class="label"
                      :for="`story-settings-character-prompt-${row.customization.characterId}`"
                    >
                      Prompt
                    </label>
                    <textarea
                      :id="`story-settings-character-prompt-${row.customization.characterId}`"
                      v-model="row.customization.prompt"
                      autocomplete="off"
                      class="field min-h-32"
                    />
                  </div>
                  <div>
                    <label
                      class="label"
                      :for="`story-settings-character-tags-${row.customization.characterId}`"
                    >
                      Etiquetas descriptivas
                    </label>
                    <TagInput
                      :id="`story-settings-character-tags-${row.customization.characterId}`"
                      v-model="row.customization.tags"
                      :suggestions="characterTagSuggestions"
                      show-all-suggestions
                      placeholder="aventurera"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="storyPreferencesOpen = false">Cancelar</button>
            <button type="submit" class="btn-primary" :disabled="!storyPremise.trim()">Guardar</button>
          </div>
        </form>
      </div>
    </Teleport>

    <LlmDebugDialog :trace="selectedDebugTrace" @close="selectedDebugTrace = null" />
  </div>
</template>
