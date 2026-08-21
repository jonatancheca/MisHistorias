<script setup lang="ts">
import type {
  GenerationMode,
  LlmDebugTrace,
  Message,
  StoryCharacterCustomization
} from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'
import { primaryTag } from '~/lib/tags'
import {
  buildVisualNovelFrames,
  resolveVisualNovelFrameIndex,
  withPendingAssistantMessage
} from '~/lib/visualNovelFrames'

const route = useRoute()
const stories = useStoriesStore()
const characters = useCharactersStore()
const backgrounds = useBackgroundsStore()
const sounds = useSoundsStore()
const settings = useSettingsStore()
const privacy = usePrivacyStore()
const confirmDialog = useConfirmStore()
const {
  hidden: mobileChromeHidden,
  hide: hideMobileChrome,
  show: showMobileChrome,
  toggle: toggleMobileChrome
} = useMobileChrome()

hideMobileChrome()

await Promise.all([
  characters.load(),
  backgrounds.load(),
  sounds.load(),
  settings.load(),
  stories.openStory(String(route.params.id))
])

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const timelineContent = ref<HTMLElement | null>(null)
const canScrollToTop = ref(false)
const canScrollToBottom = ref(false)
const selectedDebugTrace = ref<LlmDebugTrace | null>(null)
interface ImagePickerTarget {
  mode: 'replace' | 'queue'
  characterId: string | null
  messageId: string | null
  segmentIndex: number | null
  imageId: string | null
}
const imagePickerTarget = ref<ImagePickerTarget | null>(null)
const storyPreferencesOpen = ref(false)
const storyTitle = ref('')
const storyPremise = ref('')
const storyPreferences = ref('')
const storyPreferencesMode = ref<'append' | 'replace'>('append')
const storyCharacterIds = ref<string[]>([])
const storyCharacterCustomizations = ref<StoryCharacterCustomization[]>([])
const storyCustomizationRows = computed(() =>
  storyCharacterCustomizations.value.map((customization) => ({
    customization,
    character: characters.byId(customization.characterId)
  }))
)
const availableStoryCharacters = computed(() =>
  characters.characters.filter((character) => !storyCharacterIds.value.includes(character.id))
)
const characterTagSuggestions = computed(() =>
  characters.characters.flatMap((character) => character.tags ?? [])
)
const storyCharacterNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (stories.activeStory?.characterCustomizations ?? []).map((customization) => [
      customization.characterId,
      customization.name?.trim() || characters.byId(customization.characterId)?.name || 'Personaje'
    ])
  )
)
const followingBottom = ref(true)
let lastScrollTop = 0
let autoScrollTarget: number | null = null
let timelineResizeObserver: ResizeObserver | null = null
let followScrollFrame: number | null = null
let followSettleFrame: number | null = null
let missingStoryPrivateClickCount = 0
let missingStoryPrivateClickTimer: ReturnType<typeof setTimeout> | null = null

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
    followingVisualReveal.value = true
  } else {
    stories.resumeVisualReveal()
    await resumeFollowingBottom()
  }
}

async function toggleVisualNovelManualAdvance() {
  const manualAdvance = !settings.settings.visualNovelManualAdvance
  await settings.save({
    visualNovelManualAdvance: manualAdvance
  })
  stories.setVisualRevealManualAdvance(manualAdvance)
}

async function submit() {
  void sounds.unlock()
  const text = input.value
  if (!text.trim() || stories.generating) return
  const showSubmittedVisualFrame = Boolean(
    stories.activeStory?.visualMode && settings.settings.visualNovelManualAdvance
  )
  followingBottom.value = true
  scheduleFollowBottom()
  input.value = ''
  const message = await stories.addUserMessage(text)
  if (!message) return
  if (showSubmittedVisualFrame) {
    await nextTick()
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
    followingVisualReveal.value = true
    stories.resumeVisualReveal()
  }
  await stories.generate('normal', { consumePendingImageInstructions: true })
}

async function generateOpening() {
  void sounds.unlock()
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.generate()
}

async function generateContinuation(mode: Exclude<GenerationMode, 'normal'>) {
  void sounds.unlock()
  if (stories.generating) return
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.generate(mode, { consumePendingImageInstructions: true })
}

const visiblePendingImageInstructions = computed(() =>
  (stories.activeStory?.pendingImageInstructions ?? []).flatMap((instruction) => {
    const character = characters.byId(instruction.characterId)
    const image = characters.images.find((candidate) => candidate.id === instruction.imageId)
    return character && image?.characterId === character.id
      ? [{ ...instruction, characterName: character.name }]
      : []
  })
)

function openImageReplacement(target: {
  characterId: string
  messageId?: string
  segmentIndex?: number
  sourceMessageId?: string
  sourceSegmentIndex?: number
  imageId: string | null
}) {
  imagePickerTarget.value = {
    mode: 'replace',
    characterId: target.characterId,
    messageId: target.messageId ?? target.sourceMessageId ?? null,
    segmentIndex: target.segmentIndex ?? target.sourceSegmentIndex ?? null,
    imageId: target.imageId
  }
}

function openPendingImagePicker() {
  imagePickerTarget.value = {
    mode: 'queue',
    characterId: stories.activeStory?.characterIds.length === 1
      ? stories.activeStory.characterIds[0]!
      : null,
    messageId: null,
    segmentIndex: null,
    imageId: null
  }
}

async function applyImageSelection(selection: { imageId: string; queueForNextResponse: boolean }) {
  const target = imagePickerTarget.value
  if (!target) return
  if (target.mode === 'replace' && target.messageId && target.segmentIndex !== null) {
    await stories.replaceMessageSegmentImage(target.messageId, target.segmentIndex, selection.imageId)
  }
  if (selection.queueForNextResponse) await stories.setPendingImageInstruction(selection.imageId)
  imagePickerTarget.value = null
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
  }
  updateScrollControls()
}

function openStoryPreferences() {
  if (!stories.activeStory) return
  storyTitle.value = stories.activeStory.title
  storyPremise.value = stories.activeStory.premise
  storyPreferences.value = stories.activeStory.protagonistPreferences ?? ''
  storyPreferencesMode.value = stories.activeStory.protagonistPreferencesMode ?? 'append'
  storyCharacterIds.value = [...stories.activeStory.characterIds]
  const stored = new Map(
    (stories.activeStory.characterCustomizations ?? []).map((item) => [item.characterId, item])
  )
  storyCharacterCustomizations.value = stories.activeStory.characterIds.flatMap((characterId) => {
    const source = stored.get(characterId) ?? characters.byId(characterId)
    return source
      ? [
          {
            characterId,
            name: source.name?.trim() || characters.byId(characterId)?.name || '',
            prompt: source.prompt,
            tags: [...source.tags]
          }
        ]
      : []
  })
  storyPreferencesOpen.value = true
}

function addStoryCharacter(characterId: string) {
  if (storyCharacterIds.value.includes(characterId)) return
  const character = characters.byId(characterId)
  if (!character) return
  storyCharacterIds.value.push(characterId)
  storyCharacterCustomizations.value.push({
    characterId,
    name: character.name,
    prompt: character.prompt,
    tags: [...character.tags]
  })
}

async function saveStoryPreferences() {
  if (!storyTitle.value.trim() || !storyPremise.value.trim()) return
  await stories.updateStorySettings(
    storyTitle.value,
    storyPremise.value,
    storyPreferences.value,
    storyPreferencesMode.value,
    storyCharacterIds.value,
    storyCharacterCustomizations.value.map((item) => ({ ...item, tags: [...item.tags] }))
  )
  storyPreferencesOpen.value = false
}

async function onMissingStoryPrivateTrigger() {
  if (privacy.isPrivate) return

  missingStoryPrivateClickCount += 1
  if (missingStoryPrivateClickTimer) clearTimeout(missingStoryPrivateClickTimer)

  if (missingStoryPrivateClickCount === 3) {
    missingStoryPrivateClickCount = 0
    missingStoryPrivateClickTimer = null
    await privacy.activate()
    return
  }

  missingStoryPrivateClickTimer = setTimeout(() => {
    missingStoryPrivateClickCount = 0
    missingStoryPrivateClickTimer = null
  }, 1000)
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

onMounted(() => {
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
const completeVisualFrames = computed(() =>
  buildVisualNovelFrames(
    withPendingAssistantMessage(stories.messages, stories.pendingAssistantMessage),
    {
      initialBackgroundId: stories.activeStory?.initialBackgroundId ?? null,
      initialBackgroundTag: primaryTag(initialBackground.value),
      resolveBackgroundId: (tag) => backgrounds.byTag(tag)?.id ?? null
    }
  )
)
const visualFrameTotal = computed(() =>
  Math.max(visualFrames.value.length, completeVisualFrames.value.length)
)
const visualFrameIndex = ref(Math.max(0, visualFrames.value.length - 1))
const followingVisualReveal = ref(true)
const activeVisualFrame = computed(() => visualFrames.value[visualFrameIndex.value] ?? null)
const canShowPreviousVisualFrame = computed(() => visualFrameIndex.value > 0)
const canShowNextVisualFrame = computed(
  () => visualFrameIndex.value < visualFrames.value.length - 1
)
const completeActiveVisualFrame = computed(() => {
  const active = activeVisualFrame.value
  if (!active || active.messageId !== stories.pendingAssistantMessage?.id) return null
  return completeVisualFrames.value.find((frame) => frame.id === active.id) ?? null
})
const isActiveVisualFrameRevealing = computed(() => {
  const active = activeVisualFrame.value
  const complete = completeActiveVisualFrame.value
  return Boolean(active && complete && active.text !== complete.text)
})
const hasPendingNextVisualFrame = computed(
  () => visualFrameIndex.value < completeVisualFrames.value.length - 1
)
const isViewingCurrentVisualReveal = computed(() =>
  followingVisualReveal.value &&
  visualFrameIndex.value === visualFrames.value.length - 1
)
const canAdvanceVisualFrame = computed(
  () =>
    isActiveVisualFrameRevealing.value ||
    canShowNextVisualFrame.value ||
    (isViewingCurrentVisualReveal.value && stories.visualRevealWaitingForAdvance) ||
    hasPendingNextVisualFrame.value
)
const visualBackground = computed(() => ({
  id: activeVisualFrame.value?.backgroundId ?? stories.activeStory?.initialBackgroundId ?? null,
  tag: activeVisualFrame.value?.backgroundTag ?? primaryTag(initialBackground.value)
}))
const visualCharacterStates = computed(() =>
  activeVisualFrame.value?.characterStates ?? []
)
const visualCharacterIds = computed(() =>
  visualCharacterStates.value.map((state) => state.characterId)
)
const visualSpeaker = computed(() => {
  const frame = activeVisualFrame.value
  if (!frame || frame.kind === 'narration') return null
  const speakerState = frame.characterStates[frame.characterStates.length - 1]
  if (frame.kind === 'dialogue' && speakerState) {
    return {
      name: storyCharacterNames.value[speakerState.characterId] ?? 'Personaje',
      color: characters.colorOf(speakerState.characterId)
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
    const firstNewFrame = visualFrames.value[previousLength]
    const previousFrame = visualFrames.value[previousLength - 1]
    const firstNewMessage = firstNewFrame
      ? stories.messages.find((message) => message.id === firstNewFrame.messageId)
      : null
    const isNewAssistantFrame = Boolean(
      firstNewFrame &&
      (
        firstNewFrame.messageId === stories.pendingAssistantMessage?.id ||
        firstNewMessage?.role === 'assistant'
      )
    )
    const shouldShowFirstNewAssistantFrame = Boolean(
      firstNewFrame &&
      isNewAssistantFrame &&
      firstNewFrame.messageId !== previousFrame?.messageId &&
      (previousLength === 0 || visualFrameIndex.value === previousLength - 1)
    )
    if (shouldShowFirstNewAssistantFrame) {
      visualFrameIndex.value = previousLength
      return
    }
    visualFrameIndex.value = resolveVisualNovelFrameIndex(
      visualFrameIndex.value,
      previousLength,
      length,
      settings.settings.visualNovelManualAdvance || !followingVisualReveal.value
    )
  }
)

function showPreviousVisualFrame() {
  if (!canShowPreviousVisualFrame.value) return false
  visualFrameIndex.value -= 1
  followingVisualReveal.value = false
  stories.pauseVisualReveal()
  return true
}

function navigateNextVisualFrame() {
  if (!canShowNextVisualFrame.value) return false
  visualFrameIndex.value += 1
  followingVisualReveal.value = visualFrameIndex.value === visualFrames.value.length - 1
  if (followingVisualReveal.value) stories.resumeVisualReveal()
  return true
}

function completeActiveVisualReveal() {
  if (
    !isActiveVisualFrameRevealing.value ||
    stories.visualRevealWaitingForAdvance
  ) return false
  followingVisualReveal.value = true
  return stories.completeCurrentRevealLine()
}

function revealAndShowPendingVisualFrame() {
  if (
    !isViewingCurrentVisualReveal.value ||
    !stories.visualRevealWaitingForAdvance
  ) return false
  const targetIndex = visualFrameIndex.value + 1
  if (!stories.startNextVisualReveal()) return false
  visualFrameIndex.value = Math.min(targetIndex, Math.max(0, visualFrames.value.length - 1))
  followingVisualReveal.value = visualFrameIndex.value === visualFrames.value.length - 1
  return true
}

function advanceVisualFrame() {
  if (completeActiveVisualReveal()) return true
  if (navigateNextVisualFrame()) return true
  return revealAndShowPendingVisualFrame()
}

async function showStoryStart() {
  if (stories.activeStory?.visualMode) {
    visualFrameIndex.value = 0
    followingVisualReveal.value = visualFrames.value.length <= 1
    if (followingVisualReveal.value) stories.resumeVisualReveal()
    else stories.pauseVisualReveal()
    return
  }
  scrollToTop()
}

async function showStoryEnd() {
  if (stories.activeStory?.visualMode) {
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
    followingVisualReveal.value = true
    stories.resumeVisualReveal()
    return
  }
  await resumeFollowingBottom()
}

function onVisualFrameClick(event: MouseEvent) {
  if (window.innerWidth >= 640) {
    advanceVisualFrame()
    return
  }
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  if (event.clientX < bounds.left + bounds.width / 2) {
    showPreviousVisualFrame()
  } else {
    advanceVisualFrame()
  }
}

function onVisualNovelKeydown(event: KeyboardEvent) {
  if (!stories.activeStory?.visualMode) return
  if (
    event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    storyPreferencesOpen.value || selectedDebugTrace.value || imagePickerTarget.value ||
    confirmDialog.dialog
  ) return
  const target = event.target
  if (
    target instanceof HTMLElement &&
    (
      target.isContentEditable ||
      target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="alertdialog"]')
    )
  ) return

  if (event.key === 'ArrowLeft') {
    if (showPreviousVisualFrame()) event.preventDefault()
  } else if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') {
    if (advanceVisualFrame()) event.preventDefault()
  }
}

onBeforeUnmount(() => {
  timelineContent.value?.removeEventListener('load', onTimelineAssetLoad, true)
  timelineResizeObserver?.disconnect()
  window.removeEventListener('keydown', onVisualNovelKeydown)
  if (followScrollFrame !== null) cancelAnimationFrame(followScrollFrame)
  if (followSettleFrame !== null) cancelAnimationFrame(followSettleFrame)
  if (missingStoryPrivateClickTimer) clearTimeout(missingStoryPrivateClickTimer)
  showMobileChrome()
})
</script>

<template>
  <div v-if="!stories.activeStory" class="flex h-full min-h-0 select-none flex-col p-8">
    <p class="card text-sm">Historia no encontrada.</p>
    <button
      v-if="!privacy.isPrivate"
      type="button"
      class="mt-2 block min-h-24 w-full flex-1 touch-manipulation opacity-0"
      data-testid="missing-story-private-trigger"
      aria-label="Activar modo privado"
      :disabled="privacy.switching"
      @click="onMissingStoryPrivateTrigger"
    />
  </div>

  <div v-else class="flex h-full min-h-0">
    <button
      type="button"
      class="btn-ghost fixed top-[calc(0.75rem+env(safe-area-inset-top))] right-3 z-30 flex h-10 w-10 items-center justify-center bg-[var(--color-surface)]/90 px-0 py-0 shadow-lg backdrop-blur-sm sm:hidden"
      data-testid="mobile-story-menu-toggle"
      aria-controls="app-navigation story-header"
      :aria-expanded="!mobileChromeHidden"
      :aria-label="mobileChromeHidden ? 'Mostrar menú de historia' : 'Ocultar menú de historia'"
      :title="mobileChromeHidden ? 'Mostrar menú de historia' : 'Ocultar menú de historia'"
      @click="toggleMobileChrome"
    >
      <svg
        v-if="mobileChromeHidden"
        aria-hidden="true"
        class="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
      <svg
        v-else
        aria-hidden="true"
        class="h-5 w-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>

    <section class="flex min-w-0 flex-1 flex-col">
      <header
        id="story-header"
        class="flex shrink-0 items-center justify-between border-b border-[var(--color-border-soft)] px-4 transition-[max-height,opacity,padding,transform] duration-200 sm:max-h-none sm:translate-y-0 sm:overflow-visible sm:border-b sm:px-6 sm:py-4 sm:opacity-100"
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
          <button
            type="button"
            class="btn-ghost h-10 w-10 shrink-0 px-0 py-0"
            data-testid="story-start-button"
            :aria-label="stories.activeStory.visualMode ? 'Ir a la primera frase' : 'Volver al principio'"
            :title="stories.activeStory.visualMode ? 'Ir a la primera frase' : 'Volver al principio'"
            :disabled="stories.activeStory.visualMode ? !canShowPreviousVisualFrame : !canScrollToTop"
            @click="showStoryStart"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 4h14M12 20V7m-5 5 5-5 5 5" />
            </svg>
          </button>
          <button
            type="button"
            class="btn-ghost h-10 w-10 shrink-0 px-0 py-0"
            data-testid="story-end-button"
            :aria-label="stories.activeStory.visualMode ? 'Ir a la última frase' : 'Volver al final'"
            :title="stories.activeStory.visualMode ? 'Ir a la última frase' : 'Volver al final'"
            :disabled="stories.activeStory.visualMode ? !canShowNextVisualFrame : !canScrollToBottom"
            @click="showStoryEnd"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 20h14M12 4v13m-5-5 5 5 5-5" />
            </svg>
          </button>
          <span
            v-if="stories.activeStory.visualMode"
            data-testid="visual-novel-counter"
            class="hidden h-10 shrink-0 items-center text-xs text-[var(--color-fg-muted)] sm:flex"
          >
            {{ visualFrames.length ? visualFrameIndex + 1 : 0 }} / {{ visualFrameTotal }}
          </span>
          <button
            v-if="stories.activeStory.visualMode"
            type="button"
            class="btn-ghost h-10 w-10 shrink-0 px-0 py-0"
            :class="settings.settings.visualNovelManualAdvance ? 'bg-brand-500/15 text-brand-500' : ''"
            data-testid="visual-manual-advance-toggle"
            :aria-label="settings.settings.visualNovelManualAdvance ? 'Activar avance automático' : 'Activar avance manual'"
            :title="settings.settings.visualNovelManualAdvance ? 'Avance manual activo. Pulsar para avanzar automáticamente' : 'Avance automático activo. Pulsar para esperar flecha, teclado o toque'"
            :aria-pressed="settings.settings.visualNovelManualAdvance"
            @click="toggleVisualNovelManualAdvance"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m7 5 8 7-8 7V5Z" />
              <path d="M18 5v14" />
            </svg>
          </button>
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
            <span class="hidden sm:inline">{{ stories.activeStory.visualMode ? 'Chat' : 'Novela' }}</span>
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
          <div class="relative min-h-0 flex-1">
            <VisualNovelStage
              :character-ids="visualCharacterIds"
              :character-states="visualCharacterStates"
              :background-id="visualBackground.id"
              :background-tag="visualBackground.tag"
              @select-image="openImageReplacement"
            />

            <div
              v-if="isEmpty"
              class="absolute inset-x-0 top-4 z-10 px-4 text-center text-sm text-slate-200"
            >
              <span>La historia aún no ha empezado. </span>
              <button type="button" class="text-brand-300 underline" @click="generateOpening">
                Deja que el narrador abra la escena
              </button>
              <span> o escribe tú el primer movimiento.</span>
            </div>

            <div
              v-if="stories.waitingForResponse"
              data-testid="visual-thinking-indicator"
              class="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center px-4"
              role="status"
              aria-live="polite"
            >
              <div
                class="flex items-center gap-3 rounded-full border border-white/25 bg-slate-950/85 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
              >
                <span>El Narrador está pensando…</span>
                <span class="flex items-center gap-1" aria-hidden="true">
                  <span class="h-2 w-2 animate-bounce rounded-full bg-brand-400 motion-reduce:animate-none" />
                  <span
                    class="h-2 w-2 animate-bounce rounded-full bg-brand-400 motion-reduce:animate-none"
                    style="animation-delay: 120ms"
                  />
                  <span
                    class="h-2 w-2 animate-bounce rounded-full bg-brand-400 motion-reduce:animate-none"
                    style="animation-delay: 240ms"
                  />
                </span>
              </div>
            </div>
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
                :disabled="!canAdvanceVisualFrame"
                @click="advanceVisualFrame"
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
              :character-names="storyCharacterNames"
              :debug-trace="debugForMessage(item.message.id)"
              :editable="!stories.generating"
              :visual-mode="stories.activeStory.visualMode"
              @debug="selectedDebugTrace = $event"
              @edit="stories.updateMessage(item.message.id, $event)"
              @remove="removeMessage(item.message.id)"
              @regenerate="regenerateFrom(item.message.id)"
              @resend="resendFrom(item.message.id)"
              @select-image="openImageReplacement"
            />

            <div v-else class="group flex min-w-0 items-start gap-2">
              <div
                class="flex w-8 shrink-0 text-red-500 opacity-100 transition max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
            <span>El Narrador está pensando…</span>
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
        <div v-if="visiblePendingImageInstructions.length" class="mb-2 flex flex-wrap gap-2" data-testid="pending-image-instructions">
          <span
            v-for="instruction in visiblePendingImageInstructions"
            :key="instruction.characterId"
            class="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-500/15 px-3 py-1 text-xs text-brand-700"
          >
            <span class="truncate">{{ instruction.characterName }} {{ instruction.tags.map((tag) => `[${tag}]`).join('') }}</span>
            <button
              type="button"
              class="font-bold"
              :aria-label="`Quitar imagen pendiente de ${instruction.characterName}`"
              @click="stories.removePendingImageInstruction(instruction.characterId)"
            >×</button>
          </span>
        </div>
        <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submit">
          <textarea
            v-model="input"
            autocomplete="off"
            class="field min-h-12 min-w-0 resize-none"
            rows="2"
            placeholder="Escribe lo que haces o dices…"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="grid shrink-0 grid-cols-4 gap-2 sm:w-72">
            <button type="submit" class="btn-primary" :disabled="stories.generating">Enviar</button>
            <button
              type="button"
              class="btn-ghost"
              data-testid="pending-image-button"
              aria-label="Preparar imagen para la próxima respuesta"
              :disabled="stories.generating || !stories.activeStory.characterIds.length"
              @click="openPendingImagePicker"
            >
              Imagen
            </button>
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
              class="btn-ghost col-span-4"
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
        :active-tags="lastDialogue?.tags ?? []"
        :active-image-id="lastDialogue?.imageId ?? null"
        :active-image-id-override="lastDialogue?.imageIdOverride === true"
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
              <label class="label" for="storyTitle">Título</label>
              <input
                id="storyTitle"
                v-model="storyTitle"
                autocomplete="off"
                class="field"
                autofocus
                required
              >
            </div>
            <div>
              <label class="label" for="storyPremise">Planteamiento</label>
              <textarea
                id="storyPremise"
                v-model="storyPremise"
                autocomplete="off"
                class="field min-h-32"
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
            <div v-if="availableStoryCharacters.length" class="grid gap-2">
              <span class="label">Añadir personajes</span>
              <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <button
                  v-for="character in availableStoryCharacters"
                  :key="character.id"
                  type="button"
                  class="flex items-center gap-3 rounded-xl border border-[var(--color-border-soft)] p-3 text-left transition hover:border-brand-400"
                  :aria-label="`Añadir ${character.name}`"
                  @click="addStoryCharacter(character.id)"
                >
                  <img
                    v-if="characters.urlFor(characters.defaultImage(character.id)?.id)"
                    :src="characters.urlFor(characters.defaultImage(character.id)?.id)!"
                    alt=""
                    class="h-10 w-10 rounded-full object-cover"
                  >
                  <span v-else class="h-10 w-10 shrink-0 rounded-full bg-brand-500/20" />
                  <span class="min-w-0 truncate font-medium">{{ character.name }}</span>
                </button>
              </div>
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
                  {{ row.customization.name?.trim() || row.character?.name || 'Personaje no disponible' }}
                </h3>
                <div class="mt-3 grid gap-3">
                  <div>
                    <label
                      class="label"
                      :for="`story-settings-character-name-${row.customization.characterId}`"
                    >
                      Nombre en esta historia
                    </label>
                    <input
                      :id="`story-settings-character-name-${row.customization.characterId}`"
                      v-model="row.customization.name"
                      autocomplete="off"
                      class="field"
                    >
                  </div>
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
            <button
              type="submit"
              class="btn-primary"
              :disabled="!storyTitle.trim() || !storyPremise.trim()"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <LlmDebugDialog :trace="selectedDebugTrace" @close="selectedDebugTrace = null" />
    <StoryImagePickerDialog
      :open="Boolean(imagePickerTarget)"
      :mode="imagePickerTarget?.mode ?? 'queue'"
      :character-ids="stories.activeStory.characterIds"
      :initial-character-id="imagePickerTarget?.characterId"
      :initial-image-id="imagePickerTarget?.imageId"
      @close="imagePickerTarget = null"
      @select="applyImageSelection"
    />
  </div>
</template>
