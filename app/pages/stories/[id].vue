<script setup lang="ts">
import type {
  GenerationMode,
  LlmDebugTrace,
  Message,
  ResponseStyleAmount,
  StoryCharacterCustomization
} from '#shared/types'
import { DEFAULT_USER_COLOR, normalizeColor } from '~/lib/colors'
import { primaryTag } from '~/lib/tags'
import { isAiInstruction } from '~/lib/chatInstructions'
import { storyOriginalText } from '~/lib/storyOriginalText'
import { createStoryThumbnail } from '~/lib/storyThumbnail'
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
const access = useAccessStore()
const modelPreload = useLlmModelPreloadStore()
const {
  hidden: mobileChromeHidden,
  atTop: mobileChromeAtTop,
  hide: hideMobileChrome,
  show: showMobileChrome,
  toggle: toggleMobileChrome,
  setAtTop: setMobileChromeAtTop
} = useMobileChrome()

hideMobileChrome()

await Promise.all([
  characters.load(),
  backgrounds.load(),
  sounds.load(),
  settings.load(),
  stories.openStory(String(route.params.id))
])

if (privacy.isDemo && !stories.activeStory?.visibleInDemo) {
  await navigateTo('/')
}

const input = ref('')
const composerInput = ref<HTMLTextAreaElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const timelineContent = ref<HTMLElement | null>(null)
const canScrollToTop = ref(false)
const canScrollToBottom = ref(false)
const selectedDebugTrace = ref<LlmDebugTrace | null>(null)
const compactionDeleteError = ref<string | null>(null)
const manualCompactionOpen = ref(false)
const compactionHistoryOpen = ref(false)
const charactersDialogOpen = ref(false)
const presenceBusy = ref(false)
const presenceError = ref<string | null>(null)
async function changeCharacterPresence(characterId: string, present: boolean) {
  if (presenceBusy.value || stories.generating || stories.activeStory?.readOnly) return
  presenceBusy.value = true
  presenceError.value = null
  try {
    await stories.setCharacterPresence(characterId, present)
    await nextTick()
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
  } catch {
    presenceError.value = 'No se pudo guardar la presencia. Inténtalo de nuevo.'
  } finally { presenceBusy.value = false }
}
const editingVisualMessage = ref<Message | null>(null)
const desktopStoryControls = useStoryDesktopControls()
const readerOptionsInNavigation = ref(false)
let readerOptionsMedia: MediaQueryList | null = null
function syncReaderOptionsPlacement() {
  readerOptionsInNavigation.value = readerOptionsMedia?.matches ?? false
}
const debugEnabled = ref(false)
const originalTextAvailable = computed(() => desktopStoryControls.value || debugEnabled.value)
const originalTextOpenIds = ref(new Set<string>())
const hiddenMessagesOpen = ref(false)
const originalMessages = computed(() =>
  withPendingAssistantMessage(stories.messages, stories.pendingAssistantMessage)
)
const originalMessagesById = computed(() =>
  new Map(originalMessages.value.map((message) => [message.id, message]))
)

function toggleStoryOriginal(id: string) {
  const expanded = new Set(originalTextOpenIds.value)
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
  originalTextOpenIds.value = expanded
}

watch(() => stories.activeStory?.id, () => {
  debugEnabled.value = false
  selectedDebugTrace.value = null
  compactionDeleteError.value = null
  manualCompactionOpen.value = false
  compactionHistoryOpen.value = false
  charactersDialogOpen.value = false
  presenceError.value = null
  originalTextOpenIds.value = new Set()
  hiddenMessagesOpen.value = false
})
watch(() => stories.activeStory?.visualMode, () => {
  hiddenMessagesOpen.value = false
})

async function saveVisualMessage(id: string, raw: string) {
  if (stories.generating) return
  const segmentIndex = activeVisualFrame.value?.segmentIndex
  await stories.updateMessage(id, raw)
  await nextTick()
  const messageFrames = visualFrames.value.flatMap((frame, index) =>
    frame.messageId === id ? [{ frame, index }] : []
  )
  const editedFrame = messageFrames.find(({ frame }) => frame.segmentIndex === segmentIndex)
    ?? messageFrames.at(-1)
  if (editedFrame) {
    visualFrameIndex.value = editedFrame.index
    followingVisualReveal.value = false
  }
  editingVisualMessage.value = null
}
const storySavesOpen = ref(false)
const storySavesBusy = ref(false)
const storySavesError = ref<string | null>(null)
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
const storyVisualMode = ref(false)
const autoGenerateImages = ref(false)
const storyPreferences = ref('')
const storyPreferencesMode = ref<'append' | 'replace'>('append')
const dialogueStyle = ref<ResponseStyleAmount>('unspecified')
const narrationStyle = ref<ResponseStyleAmount>('unspecified')
const storyInitialBackgroundId = ref<string | null>(null)
const storyBackgroundStyle = ref<string | null>(null)
const storyVisibleInDemo = ref(false)
const copyingSharedStory = ref(false)
const copySharedStoryError = ref<string | null>(null)

useDialogEscape(
  () => storyPreferencesOpen.value,
  () => { storyPreferencesOpen.value = false }
)
const storyCharacterIds = ref<string[]>([])
const storyCharacterCustomizations = ref<StoryCharacterCustomization[]>([])
const storyCharacterNames = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (stories.activeStory?.characterCustomizations ?? []).map((customization) => [
      customization.characterId,
      customization.name?.trim() || characters.byId(customization.characterId)?.name || 'Personaje'
    ])
  )
)
const storyCharacterColors = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (stories.activeStory?.characterCustomizations ?? []).map((customization) => [
      customization.characterId,
      normalizeColor(customization.color, characters.colorOf(customization.characterId))
    ])
  )
)
const followingBottom = ref(true)
let lastScrollTop = 0
let accumulatedScroll = 0
let autoScrollTarget: number | null = null
let timelineResizeObserver: ResizeObserver | null = null
let followScrollFrame: number | null = null
let followSettleFrame: number | null = null
let missingStoryPrivateClickCount = 0
let missingStoryPrivateClickTimer: ReturnType<typeof setTimeout> | null = null

type TimelineItem =
  | { kind: 'message'; id: string; createdAt: number; message: Message }
  | { kind: 'trace'; id: string; createdAt: number; trace: LlmDebugTrace }
  | { kind: 'compaction'; id: string; createdAt: number; trace: LlmDebugTrace }

const compactionTraces = computed(() => stories.compactionTraces)

const timeline = computed<TimelineItem[]>(() => {
  const items: TimelineItem[] = [
    ...stories.messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      createdAt: message.createdAt,
      message
    })),
    ...stories.debugTraces
      .filter((trace) =>
        trace.request.purpose !== 'compaction' &&
        !trace.request.generation?.automaticallyRetried &&
        (trace.status === 'error' || !trace.responseMessageId)
      )
      .map((trace) => ({
        kind: 'trace' as const,
        id: trace.id,
        createdAt: trace.createdAt,
        trace
      }))
  ].sort((a, b) => a.createdAt - b.createdAt)
  if (!debugEnabled.value) return items
  const messageIds = new Set(stories.messages.map((message) => message.id))
  const markers = compactionTraces.value.map((trace): TimelineItem & { kind: 'compaction' } => ({
    kind: 'compaction', id: trace.id, createdAt: trace.createdAt, trace
  }))
  const anchored = new Map<string, typeof markers>()
  for (const marker of markers) {
    const anchor = marker.trace.requestMessageId
    if (!anchor || !messageIds.has(anchor)) items.push(marker)
    else anchored.set(anchor, [...(anchored.get(anchor) ?? []), marker])
  }
  return items.sort((a, b) => a.createdAt - b.createdAt).flatMap<TimelineItem>((item) =>
    item.kind === 'message' ? [item, ...(anchored.get(item.id) ?? [])] : [item]
  )
})

function debugForMessage(id: string) {
  return stories.debugTraces.find((trace) =>
    trace.request.purpose !== 'compaction' && trace.responseMessageId === id
  ) ?? null
}

function compactionDebugForMessage(id: string) {
  return stories.debugTraces.findLast((trace) =>
    trace.request.purpose === 'compaction' && trace.requestMessageId === id
  ) ?? null
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
      if ((segment.type === 'dialogue' || segment.type === 'thought') && segment.characterId) return segment
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
  setMobileChromeAtTop(true)
  if (window.innerWidth < 640) showMobileChrome()
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
  if (!stories.activeStory || stories.activeStory.readOnly) return
  const visualMode = !stories.activeStory.visualMode
  await stories.setVisualMode(visualMode)
  if (visualMode) {
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
    followingVisualReveal.value = true
    stories.resumeVisualReveal()
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
  if (stories.activeStory?.readOnly || presenceBusy.value) return
  void sounds.unlock()
  const text = input.value
  if (!text.trim() || stories.generating) return
  const showSubmittedVisualFrame = Boolean(
    stories.activeStory?.visualMode && settings.settings.visualNovelManualAdvance
  )
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.send(text, async () => {
    if (input.value === text) input.value = ''
    if (showSubmittedVisualFrame) {
      await nextTick()
      visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
      followingVisualReveal.value = true
      stories.resumeVisualReveal()
    }
  })
}

function onComposerEnter(event: KeyboardEvent) {
  if (!desktopStoryControls.value) return
  onSubmitShortcut(event)
}

function onSubmitShortcut(event: KeyboardEvent) {
  if (event.repeat || event.isComposing) return
  event.preventDefault()
  void submit()
}

async function generateOpening() {
  if (stories.activeStory?.readOnly || presenceBusy.value) return
  void sounds.unlock()
  followingBottom.value = true
  scheduleFollowBottom()
  await stories.generate()
}

async function retryFailedGeneration() {
  if (stories.generating || presenceBusy.value || stories.activeStory?.readOnly) return
  void sounds.unlock()
  followingBottom.value = true
  followingVisualReveal.value = true
  stories.resumeVisualReveal()
  scheduleFollowBottom()
  await stories.retryFailedGeneration()
}

async function compactInBlocks() {
  if (stories.generating || presenceBusy.value || stories.activeStory?.readOnly) return
  void sounds.unlock()
  followingBottom.value = true
  followingVisualReveal.value = true
  stories.resumeVisualReveal()
  scheduleFollowBottom()
  await stories.compactInBlocks(input.value)
}

async function generateContinuation(mode: Exclude<GenerationMode, 'normal'>) {
  if (stories.activeStory?.readOnly || presenceBusy.value) return
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
  if (stories.activeStory?.readOnly || presenceBusy.value) return
  imagePickerTarget.value = {
    mode: 'replace',
    characterId: target.characterId,
    messageId: target.messageId ?? target.sourceMessageId ?? null,
    segmentIndex: target.segmentIndex ?? target.sourceSegmentIndex ?? null,
    imageId: target.imageId
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
const storyModelPreload = computed(() => {
  const attempt = modelPreload.currentAttempt
  return attempt?.storyId === stories.activeStory?.id ? attempt : null
})
const {
  visible: modelLoadAvailable,
  loading: modelLoading,
  error: modelLoadError,
  load: loadStoryModel
} = useStoryModelLoad()
const modelLoadTargetId = computed(() => timeline.value.findLast((item) =>
  item.kind === 'trace' || (item.kind === 'message' && !item.message.swarmError && debugForMessage(item.id) &&
    (originalTextAvailable.value || !isAiInstruction(item.message.raw)))
)?.id ?? null)
const modelLoadInNavigation = computed(() =>
  modelLoadAvailable.value && !stories.activeStory?.visualMode && !modelLoadTargetId.value
)

function storyControlTitle(label: string, shortcuts: string) {
  return desktopStoryControls.value ? `${label} (${shortcuts})` : label
}

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
  // La marca del menú cambia la altura disponible unos 52px. Usa un margen
  // distinto al salir del inicio para que ese cambio no vuelva a alternarla.
  const atTop = current <= (mobileChromeAtTop.value ? 64 : 8)

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

  setMobileChromeAtTop(atTop)

  if (delta < -1) {
    followingBottom.value = false
  }
  updateScrollControls()

  if (window.innerWidth >= 640) {
    accumulatedScroll = 0
    return
  }
  if (atTop) {
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
  if (!stories.activeStory || stories.activeStory.readOnly) return
  storyTitle.value = stories.activeStory.title
  storyPremise.value = stories.activeStory.premise
  storyVisualMode.value = stories.activeStory.visualMode
  autoGenerateImages.value = stories.activeStory.autoGenerateImages === true
  storyPreferences.value = stories.activeStory.protagonistPreferences ?? ''
  storyPreferencesMode.value = stories.activeStory.protagonistPreferencesMode ?? 'append'
  dialogueStyle.value = stories.activeStory.dialogueStyle ?? 'unspecified'
  narrationStyle.value = stories.activeStory.narrationStyle ?? 'unspecified'
  storyInitialBackgroundId.value = stories.activeStory.initialBackgroundId ?? null
  storyBackgroundStyle.value = stories.activeStory.backgroundStyle ?? null
  storyVisibleInDemo.value = stories.activeStory.visibleInDemo
  storyCharacterIds.value = [...stories.activeStory.characterIds]
  storyCharacterCustomizations.value = (stories.activeStory.characterCustomizations ?? [])
    .map((customization) => ({ ...customization, tags: [...customization.tags] }))
  storyPreferencesOpen.value = true
}

async function saveStoryPreferences() {
  if (!storyTitle.value.trim() || !storyPremise.value.trim() || !storyCharacterIds.value.length) return
  await stories.updateStorySettings(
    storyTitle.value,
    storyPremise.value,
    storyVisualMode.value,
    autoGenerateImages.value,
    storyPreferences.value,
    storyPreferencesMode.value,
    dialogueStyle.value,
    narrationStyle.value,
    storyCharacterIds.value,
    storyCharacterCustomizations.value.map((item) => ({ ...item, tags: [...item.tags] })),
    storyInitialBackgroundId.value,
    storyBackgroundStyle.value,
    storyVisibleInDemo.value
  )
  storyPreferencesOpen.value = false
}

async function copySharedStory() {
  const story = stories.activeStory
  if (!story?.readOnly || copyingSharedStory.value) return
  const destination = access.session.identity?.email
    ? `la colección privada de ${access.session.identity.email}`
    : 'tu colección privada'
  const accepted = await confirmDialog.ask({
    title: 'Copiar historia demo',
    message: `Se creará una copia independiente de «${story.title}» en ${destination}, incluidos sus mensajes y los recursos necesarios. La historia original no cambiará.`,
    confirmLabel: 'Copiar a mi colección'
  })
  if (!accepted) return

  copyingSharedStory.value = true
  copySharedStoryError.value = null
  try {
    const copied = await stories.copySharedDemoStory(story.id)
    if (!copied) throw new Error('La historia ya no está disponible para copiar.')
    await navigateTo(`/stories/${copied.id}`)
  } catch (caught) {
    copySharedStoryError.value = (caught as Error).message || 'No se pudo copiar la historia demo.'
  } finally {
    copyingSharedStory.value = false
  }
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

async function removeCompaction(trace: LlmDebugTrace) {
  if (stories.activeStory?.readOnly || stories.generating || stories.deletingCompaction) return
  const story = stories.activeStory
  const applied = trace.status === 'success' && trace.request.compaction?.applied !== false
  const accepted = await confirmDialog.ask({
    title: 'Borrar compactación',
    message: applied
      ? 'Se borrará este registro y se dejará de usar el resumen activo, que puede incluir esta compactación. La IA volverá a utilizar los mensajes originales y podrá compactarlos de nuevo si superan el límite. Los mensajes y los demás registros se conservarán.'
      : 'Se borrará el registro de esta compactación fallida. El resumen activo y los mensajes originales se conservarán.',
    confirmLabel: 'Borrar'
  })
  if (!accepted || stories.activeStory !== story) return
  compactionDeleteError.value = null
  try {
    await stories.removeCompaction(trace.id)
    if (selectedDebugTrace.value?.id === trace.id) selectedDebugTrace.value = null
  } catch {
    if (stories.activeStory === story) compactionDeleteError.value = 'No se pudo borrar la compactación. Inténtalo de nuevo.'
  }
}

async function removeMessage(id: string) {
  if (stories.activeStory?.readOnly || presenceBusy.value) return
  const accepted = await confirmDialog.ask({
    title: 'Borrar mensaje',
    message: 'Este mensaje se borrará definitivamente.'
  })
  if (accepted) await stories.removeMessage(id)
}

async function regenerateFrom(id: string) {
  if (stories.activeStory?.readOnly || presenceBusy.value) return
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
  if (stories.activeStory?.readOnly || presenceBusy.value) return
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

onMounted(async () => {
  readerOptionsMedia = window.matchMedia('(min-width: 640px)')
  syncReaderOptionsPlacement()
  readerOptionsMedia.addEventListener('change', syncReaderOptionsPlacement)
  timelineResizeObserver = new ResizeObserver(scheduleFollowBottom)
  if (timelineContent.value) timelineResizeObserver.observe(timelineContent.value)
  if (scroller.value) timelineResizeObserver.observe(scroller.value)
  timelineContent.value?.addEventListener('load', onTimelineAssetLoad, true)
  window.addEventListener('keydown', onStoryKeydown)
  if (!stories.activeStory?.visualMode) {
    await scrollToBottom()
    const current = scroller.value?.scrollTop ?? 0
    lastScrollTop = current
    setMobileChromeAtTop(current <= 8)
    if (current <= 8) showMobileChrome()
  }
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
    resolveBackgroundId: (tag) => backgrounds.byTag(tag)?.id ?? null,
    resolveSoundId: (tag) => sounds.byTag(tag)?.id ?? null,
    compactionTraces: debugEnabled.value ? compactionTraces.value : [],
    currentAbsentCharacterIds: stories.activeStory?.absentCharacterIds ?? []
  })
)
const completeVisualFrames = computed(() =>
  buildVisualNovelFrames(
    withPendingAssistantMessage(stories.messages, stories.pendingAssistantMessage),
    {
      initialBackgroundId: stories.activeStory?.initialBackgroundId ?? null,
      initialBackgroundTag: primaryTag(initialBackground.value),
      resolveBackgroundId: (tag) => backgrounds.byTag(tag)?.id ?? null,
      resolveSoundId: (tag) => sounds.byTag(tag)?.id ?? null,
      compactionTraces: debugEnabled.value ? compactionTraces.value : [],
      currentAbsentCharacterIds: stories.activeStory?.absentCharacterIds ?? []
    }
  )
)
const messagesWithoutVisualFrame = computed(() => {
  const representedIds = new Set(completeVisualFrames.value.map((frame) => frame.messageId))
  return originalMessages.value.filter((message) =>
    !message.swarmError && message.raw.trim() && !representedIds.has(message.id)
  )
})
const hiddenMessagesDialogOpen = computed(() =>
  hiddenMessagesOpen.value && originalTextAvailable.value && stories.activeStory?.visualMode === true
)
const visualFrameTotal = computed(() =>
  Math.max(visualFrames.value.length, completeVisualFrames.value.length)
)
const visualFrameIndex = ref(Math.max(0, visualFrames.value.length - 1))
const followingVisualReveal = ref(true)
const activeVisualFrame = computed(() => visualFrames.value[visualFrameIndex.value] ?? null)
const activeVisualMessage = computed(() =>
  stories.messages.find((message) => message.id === activeVisualFrame.value?.messageId) ?? null
)
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
  (activeVisualFrame.value ? visualCharacterStates.value.map((state) => state.characterId) : stories.activeStory?.characterIds ?? [])
    .filter((id) => !(activeVisualFrame.value?.absentCharacterIds ?? stories.activeStory?.absentCharacterIds ?? []).includes(id))
)
const visualSoundUrl = computed(() =>
  activeVisualFrame.value?.kind === 'sound'
    ? sounds.urlFor(activeVisualFrame.value.soundId)
    : null
)
const visualSoundPlayer = ref<HTMLAudioElement | null>(null)
let visualSoundWatcherInitialized = false
const visualIsThought = computed(() =>
  activeVisualFrame.value?.kind === 'thought' || activeVisualFrame.value?.kind === 'protagonist-thought'
)
const visualSpeaker = computed(() => {
  const frame = activeVisualFrame.value
  if (!frame || frame.kind === 'narration' || frame.kind === 'sound' || frame.kind === 'compaction' || frame.kind === 'presence') return null
  const speakerState = frame.characterStates[frame.characterStates.length - 1]
  if ((frame.kind === 'dialogue' || frame.kind === 'thought') && speakerState) {
    return {
      name: storyCharacterNames.value[speakerState.characterId] ?? 'Personaje',
      color: storyCharacterColors.value[speakerState.characterId] ?? characters.colorOf(speakerState.characterId)
    }
  }
  return {
    name: settings.activeUserName,
    color: normalizeColor(settings.settings.userColor, DEFAULT_USER_COLOR)
  }
})

watch(
  [() => activeVisualFrame.value?.id, () => stories.activeStory?.visualMode],
  async ([, visualMode], [, previousMode]) => {
    const initialRun = !visualSoundWatcherInitialized
    visualSoundWatcherInitialized = true
    if (!visualMode || previousMode === false || activeVisualFrame.value?.kind !== 'sound') return
    const sound = sounds.byId(activeVisualFrame.value.soundId)
    if (sound?.isBackground === true) {
      if (!initialRun) sounds.playBackground(sound.id)
      return
    }
    await nextTick()
    if (!visualSoundPlayer.value) return
    visualSoundPlayer.value.currentTime = 0
    void visualSoundPlayer.value.play().catch(() => undefined)
  },
  { immediate: true }
)

const thumbnailCharacterUrls = computed(() => {
  if (stories.activeStory?.visualMode) {
    return visualCharacterStates.value.filter((state) => visualCharacterIds.value.includes(state.characterId)).map((state) => {
      const image = characters.resolveImage(
        state.characterId,
        state.tags?.length ? state.tags : state.tag,
        state.imageId,
        '',
        state.imageIdOverride
      )
      return characters.urlFor(image?.id)
    })
  }
  return (stories.activeStory?.characterIds ?? []).filter((id) => !(stories.activeStory?.absentCharacterIds ?? []).includes(id)).map((characterId) => {
    const active = lastDialogue.value?.characterId === characterId ? lastDialogue.value : null
    const image = characters.resolveImage(
      characterId,
      active?.tags?.length ? active.tags : active?.tag ?? null,
      active?.imageId,
      '',
      active?.imageIdOverride === true
    )
    return characters.urlFor(image?.id)
  })
})

async function saveStorySlot(name: string) {
  if (!stories.activeStory || stories.activeStory.readOnly || storySavesBusy.value) return
  storySavesBusy.value = true
  storySavesError.value = null
  try {
    const lastMessage = stories.messages[stories.messages.length - 1]
    const thumbnailDataUrl = await createStoryThumbnail({
      backgroundUrl: backgrounds.urlFor(
        stories.activeStory.visualMode ? visualBackground.value.id : currentBackground.value.id
      ),
      characterUrls: thumbnailCharacterUrls.value,
      title: stories.activeStory.title,
      text: activeVisualFrame.value?.text ?? lastMessage?.raw ?? stories.activeStory.premise
    })
    await stories.createSaveSlot(name, thumbnailDataUrl)
  } catch (caught) {
    storySavesError.value = (caught as Error).message || 'No se pudo guardar la partida.'
  } finally {
    storySavesBusy.value = false
  }
}

async function loadStorySlot(id: string) {
  if (storySavesBusy.value) return
  const accepted = await confirmDialog.ask({
    title: 'Cargar partida',
    message: 'El progreso actual se reemplazará por esta partida. Las partidas guardadas se conservarán.',
    confirmLabel: 'Cargar'
  })
  if (!accepted) return
  storySavesBusy.value = true
  storySavesError.value = null
  try {
    await stories.loadSaveSlot(id)
    visualFrameIndex.value = Math.max(0, visualFrames.value.length - 1)
    followingVisualReveal.value = true
    storySavesOpen.value = false
    await scrollToBottom()
  } catch (caught) {
    storySavesError.value = (caught as Error).message || 'No se pudo cargar la partida.'
  } finally {
    storySavesBusy.value = false
  }
}

async function removeStorySlot(id: string) {
  if (storySavesBusy.value) return
  const accepted = await confirmDialog.ask({
    title: 'Borrar partida',
    message: 'Esta partida se borrará definitivamente.',
    confirmLabel: 'Borrar'
  })
  if (!accepted) return
  storySavesBusy.value = true
  storySavesError.value = null
  try {
    await stories.removeSaveSlot(id)
  } catch (caught) {
    storySavesError.value = (caught as Error).message || 'No se pudo borrar la partida.'
  } finally {
    storySavesBusy.value = false
  }
}

let previousVisualDebugEnabled = debugEnabled.value
watch(
  visualFrames,
  (frames, previousFrames) => {
    const length = frames.length
    const previousLength = previousFrames.length
    const currentFrame = previousFrames[visualFrameIndex.value]
    const retainedIndex = frames.findIndex((frame) => frame.id === currentFrame?.id)
    const debugChanged = previousVisualDebugEnabled !== debugEnabled.value
    previousVisualDebugEnabled = debugEnabled.value
    if (retainedIndex >= 0 && (debugChanged || retainedIndex !== visualFrameIndex.value)) {
      visualFrameIndex.value = retainedIndex
      return
    }
    if (currentFrame?.kind === 'compaction' && retainedIndex < 0) {
      const remainingIds = new Set(frames.map((frame) => frame.id))
      const nearest = previousFrames.slice(visualFrameIndex.value + 1).find((frame) => remainingIds.has(frame.id)) ??
        previousFrames.slice(0, visualFrameIndex.value).findLast((frame) => remainingIds.has(frame.id))
      visualFrameIndex.value = Math.max(0, frames.findIndex((frame) => frame.id === nearest?.id))
      return
    }
    const firstNewFrame = frames[previousLength]
    const previousFrame = previousFrames[previousLength - 1]
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

function navigateChatMessage(direction: -1 | 1) {
  const container = scroller.value
  if (!container) return false
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>('[data-story-message-id]')
  )
  if (!elements.length) return false
  const containerTop = container.getBoundingClientRect().top
  const currentIndex = elements.reduce((bestIndex, element, index) => {
    const bestDistance = Math.abs(
      elements[bestIndex]!.getBoundingClientRect().top - containerTop
    )
    const distance = Math.abs(element.getBoundingClientRect().top - containerTop)
    return distance < bestDistance ? index : bestIndex
  }, 0)
  const targetIndex = currentIndex + direction
  if (targetIndex < 0 || targetIndex >= elements.length) return false
  const target = elements[targetIndex]!
  followingBottom.value = false
  const targetTop = container.scrollTop + target.getBoundingClientRect().top - containerTop
  autoScrollTarget = targetTop
  container.scrollTo({ top: targetTop, behavior: 'smooth' })
  updateScrollControls()
  return true
}

function onStoryKeydown(event: KeyboardEvent) {
  if (!stories.activeStory || event.defaultPrevented) return
  if (
    storyPreferencesOpen.value || selectedDebugTrace.value || imagePickerTarget.value || editingVisualMessage.value ||
    storySavesOpen.value || compactionHistoryOpen.value || charactersDialogOpen.value || hiddenMessagesDialogOpen.value || confirmDialog.dialog
  ) return

  const target = event.target
  if (event.key === 'Home' || event.key === 'End') {
    if (event.altKey || event.metaKey || event.shiftKey) return
    if (target instanceof HTMLElement && target.closest('[role="dialog"], [role="alertdialog"]')) return
    if (composerInput.value && target === composerInput.value) {
      if (!event.ctrlKey) return
    } else if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))
    ) return

    event.preventDefault()
    if (event.key === 'Home') void showStoryStart()
    else void showStoryEnd()
    return
  }

  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

  if (event.key === 'PageUp' || event.key === 'PageDown') {
    const handled = stories.activeStory.visualMode
      ? event.key === 'PageUp'
        ? showPreviousVisualFrame()
        : advanceVisualFrame()
      : event.key === 'PageDown' && stories.completeCurrentRevealLine()
        ? true
        : navigateChatMessage(event.key === 'PageUp' ? -1 : 1)
    if (handled) event.preventDefault()
    return
  }

  if (!stories.activeStory.visualMode) return
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
  readerOptionsMedia?.removeEventListener('change', syncReaderOptionsPlacement)
  stories.cancelImageGeneration({ abandonResponse: true })
  sounds.stopBackground()
  timelineContent.value?.removeEventListener('load', onTimelineAssetLoad, true)
  timelineResizeObserver?.disconnect()
  window.removeEventListener('keydown', onStoryKeydown)
  if (followScrollFrame !== null) cancelAnimationFrame(followScrollFrame)
  if (followSettleFrame !== null) cancelAnimationFrame(followSettleFrame)
  if (missingStoryPrivateClickTimer) clearTimeout(missingStoryPrivateClickTimer)
  showMobileChrome()
})

onBeforeRouteLeave(() => {
  stories.cancelStoryAuxiliary()
  stories.cancelImageGeneration({ abandonResponse: true })
  sounds.stopBackground()
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
    <section class="flex min-w-0 flex-1 flex-col">
      <header id="story-header" class="story-header">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            class="btn-ghost h-11 w-11 shrink-0 px-0 py-0 sm:hidden"
            data-testid="mobile-story-menu-toggle"
            aria-controls="app-navigation"
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
          <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-bold sm:text-lg">
            {{ stories.activeStory.title }}
            <span
              v-if="settings.settings.mockMode"
              class="ml-2 rounded-full bg-brand-500/15 px-2 py-0.5 align-middle text-xs font-semibold text-brand-600"
            >
              modo prueba
            </span>
          </h1>
          <p class="hidden truncate text-xs sm:block text-[var(--color-fg-muted)]">
            {{ stories.activeStory.premise }}
          </p>
          <p
            v-if="stories.activeStory.readOnly && stories.activeStory.visibleInDemo"
            class="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300"
          >
            Historia demo compartida · solo lectura
          </p>
        </div>
          <div id="story-mobile-context" class="shrink-0 sm:hidden" />
        </div>
        <div class="story-header-options">
          <Teleport defer to="#story-reader-options" :disabled="!readerOptionsInNavigation">
          <div class="story-reader-options flex min-w-0 items-center justify-start gap-2">
          <div v-if="!stories.activeStory.readOnly" class="story-mode-switch" role="group" aria-label="Modo de lectura">
            <button
              type="button"
              :class="{ 'is-active': !stories.activeStory.visualMode }"
              :data-testid="stories.activeStory.visualMode ? 'visual-mode-toggle' : undefined"
              aria-label="Desactivar modo novela visual"
              :aria-pressed="!stories.activeStory.visualMode"
              :disabled="presenceBusy"
              @click="stories.activeStory.visualMode && toggleVisualMode()"
            >
              <svg aria-hidden="true" class="hidden h-4 w-4 sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z" /></svg>
              Chat
            </button>
            <button
              type="button"
              :class="{ 'is-active': stories.activeStory.visualMode }"
              :data-testid="!stories.activeStory.visualMode ? 'visual-mode-toggle' : undefined"
              aria-label="Activar modo novela visual"
              :aria-pressed="stories.activeStory.visualMode"
              :disabled="presenceBusy"
              @click="!stories.activeStory.visualMode && toggleVisualMode()"
            >
              <svg aria-hidden="true" class="hidden h-4 w-4 sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m3 15 5-5 4 4 3-3 6 6M8 8h.01" /></svg>
              Novela
            </button>
          </div>
          <span v-else class="text-sm text-[var(--color-fg-muted)]">Solo lectura</span>
          <StoryToolsMenu :active="debugEnabled" :placement="readerOptionsInNavigation ? 'top' : 'bottom'">
            <button v-if="!stories.activeStory.readOnly" type="button" class="btn-ghost" :disabled="stories.generating || presenceBusy" data-testid="story-presence-button" @click="charactersDialogOpen = true">
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" /></svg>
              <span>Personajes</span>
            </button>
            <button
              v-if="!stories.activeStory.readOnly"
              type="button"
              class="btn-ghost"
              :disabled="stories.generating || stories.deletingCompaction || settings.settings.mockMode"
              @click="manualCompactionOpen = true"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16h4" />
              </svg>
              <span>Compactar historia</span>
            </button>
            <button
              v-if="!stories.activeStory.readOnly"
              type="button"
              class="btn-ghost h-10 shrink-0 px-2 sm:px-3"
              aria-label="Partidas"
              title="Partidas"
              :disabled="stories.generating || presenceBusy"
              @click="storySavesOpen = true; storySavesError = null"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 3h12l2 2v16H5V3Z" />
                <path d="M8 3v6h8V3M8 21v-7h8v7" />
              </svg>
              <span>Partidas</span>
            </button>
            <button
              v-if="!stories.activeStory.readOnly"
              type="button"
              class="btn-ghost"
              aria-label="Ajustes de la historia"
              title="Ajustes de la historia"
              :disabled="stories.generating || presenceBusy"
              @click="openStoryPreferences"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
              </svg>
              <span>Ajustes</span>
            </button>
            <button
            v-if="stories.activeStory.visualMode && !stories.activeStory.readOnly"
            type="button"
            class="btn-ghost"
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
          <span>{{ settings.settings.visualNovelManualAdvance ? 'Avance manual' : 'Avance automático' }}</span>
            </button>
            <button
              type="button"
              class="btn-ghost h-10 shrink-0 px-2 sm:px-3"
              :class="debugEnabled ? 'bg-violet-500/15 text-violet-600' : ''"
              data-testid="story-debug-toggle"
              aria-label="Debug"
              title="Debug: compactaciones, texto original y controles de mensajes"
              :aria-pressed="debugEnabled"
              @click="debugEnabled = !debugEnabled"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M8 2h8M9 2v3m6-3v3M4 13h3m10 0h3M5 7l3 2m11-2-3 2M5 19l3-2m11 2-3-2" />
                <rect x="7" y="5" width="10" height="16" rx="5" />
                <path d="M9 11h6m-6 4h6" />
              </svg>
              <span>Debug</span>
            </button>
            <button
              v-if="stories.activeStory.readOnly && stories.activeStory.visibleInDemo"
              type="button"
              class="btn-primary h-10 w-10 shrink-0 px-0 py-0 sm:w-auto sm:px-3"
              data-testid="copy-shared-story"
              aria-label="Copiar a mi colección privada"
              title="Copiar a mi colección privada"
              :disabled="copyingSharedStory"
              @click="copySharedStory"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </svg>
              <span>{{ copyingSharedStory ? 'Copiando…' : 'Copiar' }}</span>
            </button>
          </StoryToolsMenu>
          <Teleport defer to="#story-mobile-context" :disabled="readerOptionsInNavigation">
            <StoryContextIndicators :placement="readerOptionsInNavigation ? 'top' : 'bottom'" @history="compactionHistoryOpen = true" />
          </Teleport>
          </div>
          </Teleport>
        </div>
      </header>

      <div class="relative min-h-0 flex-1 overflow-hidden" data-testid="story-reader">
        <div
          v-if="stories.activeStory.visualMode"
          data-testid="visual-novel-view"
          class="visual-novel-view flex h-full min-h-0 flex-col bg-slate-950"
        >
          <div class="relative min-h-0 flex-1">
            <VisualNovelStage
              :character-ids="visualCharacterIds"
              :character-states="visualCharacterStates"
              :background-id="visualBackground.id"
              :background-tag="visualBackground.tag"
              @select-image="openImageReplacement"
            />

            <StoryCompactionMarker
              v-if="activeVisualFrame?.compactionTrace"
              :trace="activeVisualFrame.compactionTrace"
              :editable="!stories.generating && !presenceBusy && !stories.deletingCompaction && !stories.activeStory.readOnly"
              class="absolute right-3 bottom-3 left-3 z-20 border-white/15 bg-slate-950/80 text-slate-300 shadow-lg backdrop-blur-sm sm:left-auto"
              @inspect="selectedDebugTrace = $event"
              @remove="removeCompaction"
            />

            <MessageActions
              v-if="activeVisualMessage"
              :message="activeVisualMessage"
              :editable="!stories.generating && !presenceBusy && !stories.activeStory.readOnly"
              :debug-trace="!stories.activeStory.readOnly ? debugForMessage(activeVisualMessage.id) : null"
              :compaction-trace="!stories.activeStory.readOnly ? compactionDebugForMessage(activeVisualMessage.id) : null"
              :original-text-available="originalTextAvailable"
              :original-text-open="originalTextOpenIds.has(activeVisualMessage.id)"
              :original-text-controls="`visual-original-${activeVisualMessage.id}`"
              data-testid="visual-message-actions"
              class="visual-message-actions absolute right-3 bottom-3 z-20 max-w-[calc(100%-1.5rem)] rounded-xl border border-white/15 bg-slate-950/80 p-1 text-slate-300 shadow-lg backdrop-blur-sm"
              :class="debugEnabled ? 'debug-visible' : ''"
              @debug="selectedDebugTrace = $event"
              @edit="editingVisualMessage = activeVisualMessage"
              @remove="removeMessage(activeVisualMessage.id)"
              @regenerate="regenerateFrom(activeVisualMessage.id)"
              @resend="resendFrom(activeVisualMessage.id)"
              @toggle-original="toggleStoryOriginal(activeVisualMessage.id)"
            />

            <StoryOriginalText
              v-if="originalTextAvailable && activeVisualMessage && originalTextOpenIds.has(activeVisualMessage.id)"
              :id="`visual-original-${activeVisualMessage.id}`"
              :text="storyOriginalText(originalMessagesById.get(activeVisualMessage.id) ?? activeVisualMessage, stories.debugTraces)"
              class="absolute inset-x-3 bottom-14 z-20 max-h-[calc(100%-4rem)] overflow-y-auto"
            />

            <button
              v-if="originalTextAvailable && messagesWithoutVisualFrame.length"
              type="button"
              class="absolute top-3 right-3 z-20 rounded-xl border border-white/15 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
              data-testid="story-hidden-messages-button"
              aria-label="Ver mensajes sin cuadro"
              :aria-expanded="hiddenMessagesDialogOpen"
              @click="hiddenMessagesOpen = !hiddenMessagesOpen"
            >Contenido oculto ({{ messagesWithoutVisualFrame.length }})</button>

            <button
              v-if="sounds.backgroundPlaying"
              type="button"
              class="absolute right-3 bottom-16 z-20 rounded-xl border border-white/15 bg-slate-950/80 px-3 py-2 text-sm text-white shadow-lg backdrop-blur-sm"
              data-testid="stop-background-sound"
              aria-label="Detener sonido de fondo"
              @click="sounds.stopBackground()"
            >Stop</button>

            <div
              v-if="isEmpty"
              class="absolute inset-x-0 top-4 z-10 px-4 text-center text-sm text-slate-200"
            >
              <span>La historia aún no ha empezado. </span>
              <button
                v-if="!stories.activeStory.readOnly"
                type="button"
                class="text-brand-300 underline"
                @click="generateOpening"
              >
                Deja que la história empiece sola
              </button>
              <span v-if="!stories.activeStory.readOnly"> o escribe tú el primer movimiento.</span>
            </div>

          </div>

          <section
            data-testid="visual-novel-dialogue"
            class="h-24 shrink-0 overflow-hidden border-t border-white/20 bg-slate-950 text-white shadow-[0_-10px_30px_rgba(0,0,0,0.35)] sm:h-[120px]"
            aria-live="polite"
          >
            <div class="h-full">


              <div
                data-testid="visual-novel-frame"
                :data-compaction-trace-id="activeVisualFrame?.compactionTrace?.id"
                class="h-full min-w-0 overflow-y-auto px-4 py-3 text-center sm:px-6 sm:py-4"
                @click="onVisualFrameClick"
              >
                <template v-if="activeVisualFrame">
                  <div
                    v-if="activeVisualFrame.kind === 'sound'"
                    class="mx-auto flex max-w-xl items-center gap-2 text-left"
                    data-testid="visual-novel-sound"
                    @click.stop
                  >
                    <span class="shrink-0 text-xs font-medium text-slate-300">
                      {{ sounds.byId(activeVisualFrame.soundId)?.isBackground ? 'Sonido de fondo' : 'Sonido' }}
                    </span>
                    <audio
                      v-if="visualSoundUrl"
                      ref="visualSoundPlayer"
                      :key="activeVisualFrame.id"
                      :src="visualSoundUrl"
                      controls
                      preload="metadata"
                      class="min-w-0 flex-1"
                    />
                    <span v-else class="text-sm text-slate-300">Sonido no disponible</span>
                  </div>
                  <p
                    v-else
                    class="text-[15px] leading-relaxed whitespace-pre-wrap sm:text-base"
                    :class="activeVisualFrame.kind === 'narration' ? 'italic text-slate-300' : activeVisualFrame.kind === 'compaction' ? 'break-words [overflow-wrap:anywhere]' : ''"
                    :style="visualSpeaker ? { color: visualSpeaker.color } : undefined"
                  >
                    <span v-if="activeVisualFrame.kind === 'compaction'" class="font-semibold">Compactación: </span><span v-else-if="visualSpeaker" class="font-semibold">{{ `${visualSpeaker.name}: ` }}</span><span
                      :class="{ italic: visualIsThought }"
                      :data-testid="visualIsThought ? 'story-thought' : undefined"
                    >{{ visualIsThought ? `(${activeVisualFrame.text})` : activeVisualFrame.text }}</span>
                  </p>
                </template>
                <p v-else class="text-sm text-slate-300">La historia aún no ha empezado.</p>
              </div>


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
              fit-to-viewport
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
            <button
              v-if="!stories.activeStory.readOnly"
              type="button"
              class="text-brand-600 underline"
              @click="generateOpening"
            >
              Deja que la história empiece sola
            </button>
            <template v-if="!stories.activeStory.readOnly"> o escribe tú el primer movimiento.</template>
          </div>

          <template v-for="item in timeline" :key="`${item.kind}-${item.id}`">
            <StoryCompactionMarker
              v-if="item.kind === 'compaction'"
              :trace="item.trace"
              :editable="!stories.generating && !presenceBusy && !stories.deletingCompaction && !stories.activeStory.readOnly"
              @inspect="selectedDebugTrace = $event"
              @remove="removeCompaction"
            />
            <MessageBubble
              v-else-if="item.kind === 'message'"
              :message="item.message"
              :character-names="storyCharacterNames"
              :character-colors="storyCharacterColors"
              :debug-trace="!stories.activeStory.readOnly ? debugForMessage(item.message.id) : null"
              :compaction-trace="!stories.activeStory.readOnly ? compactionDebugForMessage(item.message.id) : null"
              :editable="!stories.generating && !presenceBusy && !stories.activeStory.readOnly"
              :visual-mode="stories.activeStory.visualMode"
              :debug-enabled="debugEnabled"
              :original-text-available="originalTextAvailable && !item.message.swarmError"
              :original-text-open="originalTextOpenIds.has(item.message.id)"
              :original-text="storyOriginalText(originalMessagesById.get(item.message.id) ?? item.message, stories.debugTraces)"
              :model-load-available="modelLoadAvailable && !stories.activeStory.visualMode && item.id === modelLoadTargetId"
              :model-loading="modelLoading"
              :model-load-disabled="stories.generating"
              @debug="selectedDebugTrace = $event"
              @edit="stories.updateMessage(item.message.id, $event)"
              @remove="removeMessage(item.message.id)"
              @regenerate="regenerateFrom(item.message.id)"
              @resend="resendFrom(item.message.id)"
              @select-image="openImageReplacement"
              @toggle-original="toggleStoryOriginal(item.message.id)"
              @load-model="loadStoryModel"
            />

            <div v-else class="group flex min-w-0 items-start gap-2">
              <div
                class="flex shrink-0 text-red-500 transition"
                :class="debugEnabled ? 'opacity-100' : 'opacity-100 max-sm:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'"
              >
                <StoryModelLoadButton
                  v-if="modelLoadAvailable && !stories.activeStory.visualMode && item.id === modelLoadTargetId"
                  :loading="modelLoading"
                  :disabled="stories.generating || presenceBusy"
                  @load="loadStoryModel"
                />
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

          </div>
        </div>
        <button
          v-if="!stories.activeStory.visualMode && sounds.backgroundPlaying"
          type="button"
          class="absolute right-3 bottom-3 z-20 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] px-3 py-2 text-sm shadow-lg"
          data-testid="stop-background-sound"
          aria-label="Detener sonido de fondo"
          @click="sounds.stopBackground()"
        >Stop</button>
        <StoryNoticeOverlay :visual-mode="stories.activeStory.visualMode">
          <p v-if="compactionDeleteError" class="story-notice story-notice-error text-sm" role="alert">
            {{ compactionDeleteError }}
          </p>
          <p v-if="copySharedStoryError" class="story-notice story-notice-error text-sm" role="alert">
            {{ copySharedStoryError }}
          </p>
          <template v-if="!stories.activeStory.readOnly">
            <p
              v-if="modelLoadError"
              data-testid="story-model-load-error"
              class="story-notice story-notice-error text-sm break-words"
              role="alert"
            >{{ modelLoadError }}</p>
            <p
              v-if="storyModelPreload?.status === 'loading'"
              data-testid="story-model-preload"
              class="story-notice text-center text-sm"
              role="status"
            >
              {{ storyModelPreload.message }}
            </p>
            <p
              v-if="stories.compacting"
              data-testid="compacting-indicator"
              class="story-notice text-center text-sm"
              role="status"
              aria-live="polite"
            >El Narrador está compactando el historial</p>
            <div
              v-if="stories.waitingForResponse && storyModelPreload?.status !== 'loading'"
              data-testid="thinking-indicator"
              class="story-notice flex items-center justify-center text-sm"
              role="status"
              aria-live="polite"
            >
              <div
                class="flex min-w-0 items-center gap-3"
              >
                <span>Creando historia…{{ stories.retryingEmptyResponse ? ' (reintentando)' : '' }}</span>
                <span class="flex shrink-0 items-center gap-1" aria-hidden="true">
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
            </div>
            <div
              v-if="stories.generatingImages"
              class="story-notice flex flex-wrap items-center gap-3 text-sm"
              data-testid="image-generation-status"
              role="status"
              aria-live="polite"
            >
              <span class="min-w-0 flex-1 break-words">
                Creando imagen de {{ stories.imageGenerationCharacter }}
                {{ stories.imageGenerationTags.map((tag) => `[${tag}]`).join('') }}
                ({{ stories.imageGenerationCompleted }} / {{ stories.imageGenerationTotal }})
              </span>
              <button
                type="button"
                class="btn-ghost shrink-0 px-2 py-1 text-xs"
                data-testid="cancel-image-generation"
                @click="stories.cancelImageGeneration()"
              >
                Cancelar imágenes
              </button>
            </div>
            <p
              v-if="stories.imageGenerationError"
              class="story-notice story-notice-warning text-sm"
              data-testid="image-generation-warning"
              role="alert"
            >
              {{ stories.imageGenerationError }}
            </p>
            <div
              v-if="!stories.generating && (stories.generationFeedback || stories.error)"
              :data-testid="stories.activeStory.visualMode ? 'visual-generation-feedback' : 'story-generation-feedback'"
              class="story-notice flex flex-wrap items-center gap-3 text-sm"
              :class="stories.generationFeedback?.warning
                ? 'story-notice-warning'
                : 'story-notice-error'"
              role="alert"
            >
              <p class="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {{ stories.generationFeedback?.message ?? stories.error }}
              </p>
              <button
                v-if="stories.generationFeedback?.retry"
                type="button"
                class="btn-ghost shrink-0 px-3 py-2"
                @click="retryFailedGeneration"
              >Reintentar</button>
              <button v-if="stories.canCompactInBlocks" type="button" class="btn-ghost shrink-0 px-3 py-2" @click="compactInBlocks">Compactar por bloques</button>
            </div>
          </template>
        </StoryNoticeOverlay>
      </div>

      <nav class="story-reader-controls" aria-label="Navegación de la historia" data-testid="story-reader-controls">
        <div class="story-reader-leading">
        <div class="story-frame-navigation story-frame-navigation-start">
        <button
          type="button"
          class="story-nav-button"
          data-testid="story-start-button"
          :aria-label="stories.activeStory.visualMode ? 'Ir a la primera frase' : 'Volver al principio'"
          :title="storyControlTitle(stories.activeStory.visualMode ? 'Ir a la primera frase' : 'Volver al principio', 'Inicio; Ctrl+Inicio al escribir')"
          aria-keyshortcuts="Home Control+Home"
          :disabled="stories.activeStory.visualMode ? !canShowPreviousVisualFrame : !canScrollToTop"
          @click="showStoryStart"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="stories.activeStory.visualMode ? 'M5 5v14m14-14-8 7 8 7' : 'M5 4h14M12 20V7m-5 5 5-5 5 5'" />
          </svg>
        <span v-if="!stories.activeStory.visualMode">Inicio</span></button>
        <button
          v-if="stories.activeStory.visualMode"
          type="button"
          class="story-nav-button"
          data-testid="visual-novel-previous"
          aria-label="Frase anterior"
          :title="storyControlTitle('Frase anterior', '← / Re Pág')"
          aria-keyshortcuts="ArrowLeft PageUp"
          :disabled="!canShowPreviousVisualFrame"
          @click="showPreviousVisualFrame"
        >
          <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m15 18-6-6 6-6" />
          </svg>
        <span class="hidden md:inline">Anterior</span></button>
        <StoryModelLoadButton
          v-if="modelLoadAvailable && (stories.activeStory.visualMode || modelLoadInNavigation)"
          class="story-nav-button"
          compact-on-mobile
          :loading="modelLoading"
          :disabled="stories.generating || presenceBusy"
          @load="loadStoryModel"
        />
        </div>
        <div id="story-reader-options" class="story-reader-options-target" />
        </div>
        <div class="story-frame-navigation story-frame-navigation-end">
        <div class="story-frame-position shrink-0 text-right text-xs text-[var(--color-fg-muted)]">
          <template v-if="stories.activeStory.visualMode">
            <span data-testid="visual-novel-counter" class="block whitespace-nowrap text-xs sm:text-sm font-bold tabular-nums text-[var(--color-fg)]">{{ visualFrames.length ? visualFrameIndex + 1 : 0 }} / {{ visualFrameTotal }}</span>
          </template>
          <span v-else>Historia</span>
        </div>
        <button
          v-if="stories.activeStory.visualMode"
          type="button"
          class="story-nav-button story-nav-next"
          data-testid="visual-novel-next"
          aria-label="Frase siguiente"
          :title="storyControlTitle('Frase siguiente', '→ / Av Pág / Espacio / Enter')"
          aria-keyshortcuts="ArrowRight PageDown Space Enter"
          :disabled="!canAdvanceVisualFrame"
          @click="advanceVisualFrame"
        >
          <svg aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6" />
          </svg>
        <span class="hidden md:inline">Siguiente</span></button>
        <button
          type="button"
          class="story-nav-button"
          data-testid="story-end-button"
          :aria-label="stories.activeStory.visualMode ? 'Ir a la última frase' : 'Volver al final'"
          :title="storyControlTitle(stories.activeStory.visualMode ? 'Ir a la última frase' : 'Volver al final', 'Fin; Ctrl+Fin al escribir')"
          aria-keyshortcuts="End Control+End"
          :disabled="stories.activeStory.visualMode ? !canShowNextVisualFrame : !canScrollToBottom"
          @click="showStoryEnd"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path :d="stories.activeStory.visualMode ? 'M19 5v14M5 5l8 7-8 7' : 'M5 20h14M12 4v13m-5-5 5 5 5-5'" />
          </svg>
        <span v-if="!stories.activeStory.visualMode">Final</span></button>
        </div>
      </nav>

      <footer
        v-if="!stories.activeStory.readOnly"
        class="story-composer-footer relative shrink-0 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-3"
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
        <form class="story-composer" @submit.prevent="submit">
          <div class="story-write-box">
            <label for="story-composer-input" class="sr-only">Tu intervención</label>
            <textarea
              id="story-composer-input"
              ref="composerInput"
              v-model="input"
              autocomplete="off"
              class="story-write-input"
              rows="2"
              placeholder="Escribe lo que haces o dices…"
              @keydown.enter.exact="onComposerEnter"
              @keydown.ctrl.enter.exact="onSubmitShortcut"
            />
            <button
              v-if="!stories.generating"
              type="submit"
              class="btn-primary story-send-button"
              :disabled="stories.generating || presenceBusy"
              :aria-keyshortcuts="desktopStoryControls ? 'Enter Control+Enter' : 'Control+Enter'"
              :title="storyControlTitle('Enviar', 'Enter / Ctrl+Enter')"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" /></svg>
              Enviar
            </button>
            <button
              v-else
              type="button"
              class="btn-danger story-send-button"
              @click="stories.stop({ preserveAutoResponse: true })"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
              Parar
            </button>
          </div>
          <div class="story-generation-controls">
            <button
              type="button"
              class="story-generate-button"
              data-testid="continue-button"
              aria-label="Continuar sin decidir por el protagonista"
              title="Continúa la historia sin que la IA hable ni decida por el protagonista."
              :disabled="stories.generating || presenceBusy"
              @click="generateContinuation('continue')"
            >
              <svg aria-hidden="true" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7" /></svg>
              <span><strong>Más</strong><small>Explica más</small></span>
            </button>
            <button
              type="button"
              class="story-generate-button"
              data-testid="auto-button"
              aria-label="Continuar permitiendo que la IA decida por el protagonista"
              title="Continúa la historia y permite que la IA decida acciones o diálogos del protagonista."
              :disabled="stories.generating || presenceBusy"
              @click="generateContinuation('auto')"
            >
              <svg aria-hidden="true" class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /></svg>
              <span><strong>Auto</strong><small>La IA decide</small></span>
            </button>
          </div>
        </form>
      </footer>
      <footer
        v-else
        class="border-t border-[var(--color-border-soft)] p-3 text-center text-sm font-semibold text-[var(--color-fg-muted)] sm:p-4"
      >
        Solo lectura. Copia sus recursos demo para usarlos en tu colección privada.
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
        :character-names="storyCharacterNames"
        :absent-character-ids="stories.activeStory.absentCharacterIds ?? []"
        :presence-editable="!stories.activeStory.readOnly"
        :presence-disabled="stories.generating || presenceBusy"
        @change-presence="changeCharacterPresence"
      />
      <p v-if="presenceError" role="alert" class="mt-2 text-sm text-red-500">{{ presenceError }}</p>
    </div>

    <StoryPresenceDialog
      :open="charactersDialogOpen"
      :character-ids="stories.activeStory.characterIds"
      :absent-character-ids="stories.activeStory.absentCharacterIds ?? []"
      :character-names="storyCharacterNames"
      :protagonist-name="settings.activeUserName"
      :disabled="stories.generating || presenceBusy || stories.activeStory.readOnly === true"
      :error="presenceError"
      @close="charactersDialogOpen = false"
      @change="changeCharacterPresence"
    />

    <StoryHiddenMessagesDialog
      :open="hiddenMessagesDialogOpen"
      :messages="messagesWithoutVisualFrame"
      :expanded-ids="originalTextOpenIds"
      :debug-enabled="debugEnabled"
      :editable="!stories.generating && !presenceBusy && !stories.activeStory.readOnly"
      :debug-traces="!stories.activeStory.readOnly ? stories.debugTraces : []"
      @close="hiddenMessagesOpen = false"
      @toggle-original="toggleStoryOriginal"
      @edit="hiddenMessagesOpen = false; editingVisualMessage = $event"
      @remove="removeMessage"
      @regenerate="hiddenMessagesOpen = false; regenerateFrom($event)"
      @resend="hiddenMessagesOpen = false; resendFrom($event)"
      @debug="selectedDebugTrace = $event"
    />

    <StoryCompactionDialog :open="manualCompactionOpen" @close="manualCompactionOpen = false" />
    <StoryCompactionHistoryDialog :open="compactionHistoryOpen" @close="compactionHistoryOpen = false" />

    <StorySavesDialog
      :open="storySavesOpen"
      :saves="stories.saveSlots"
      :loading="stories.saveSlotsLoading"
      :busy="storySavesBusy"
      :error="storySavesError || stories.saveSlotsError"
      @close="storySavesOpen = false"
      @save="saveStorySlot"
      @load="loadStorySlot"
      @remove="removeStorySlot"
    />

    <Teleport to="body">
      <div
        v-if="storyPreferencesOpen"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
        @click.self="storyPreferencesOpen = false"
        @keydown.esc.stop.prevent="storyPreferencesOpen = false"
      >
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="story-settings-title"
          class="max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-[var(--color-border-soft)] bg-[var(--color-surface)] p-5 shadow-2xl"
          @submit.prevent="saveStoryPreferences"
        >
          <h2 id="story-settings-title" class="text-lg font-bold">Ajustes de la historia</h2>
          <StorySetupForm
            v-model:title="storyTitle"
            v-model:premise="storyPremise"
            v-model:visual-mode="storyVisualMode"
            v-model:auto-generate-images="autoGenerateImages"
            v-model:protagonist-preferences="storyPreferences"
            v-model:protagonist-preferences-mode="storyPreferencesMode"
            v-model:dialogue-style="dialogueStyle"
            v-model:narration-style="narrationStyle"
            v-model:character-ids="storyCharacterIds"
            v-model:character-customizations="storyCharacterCustomizations"
            v-model:initial-background-id="storyInitialBackgroundId"
            v-model:background-style="storyBackgroundStyle"
            v-model:visible-in-demo="storyVisibleInDemo"
            id-prefix="story-settings-character"
            title-required
            :show-visible-in-demo="privacy.isPrivateMode"
            class="mt-4"
          />
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn-ghost" @click="storyPreferencesOpen = false">Cancelar</button>
            <button
              type="submit"
              class="btn-primary"
              :disabled="!storyTitle.trim() || !storyPremise.trim() || !storyCharacterIds.length"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    </Teleport>

    <MessageEditDialog
      :message="editingVisualMessage"
      :disabled="stories.generating || presenceBusy"
      @close="editingVisualMessage = null"
      @save="saveVisualMessage"
    />
    <LlmDebugDialog
      :trace="selectedDebugTrace"
      :history-budget="settings.activeHistoryBudget"
      @close="selectedDebugTrace = null"
    />
    <StoryImagePickerDialog
      :open="Boolean(imagePickerTarget)"
      :mode="imagePickerTarget?.mode ?? 'queue'"
      :character-ids="stories.activeStory.characterIds"
      :character-names="storyCharacterNames"
      :initial-character-id="imagePickerTarget?.characterId"
      :initial-image-id="imagePickerTarget?.imageId"
      @close="imagePickerTarget = null"
      @select="applyImageSelection"
    />
  </div>
</template>

<style scoped>

.story-header {
  position: relative;
  z-index: 30;
  display: grid;
  flex-shrink: 0;
  gap: 0.625rem;
  border-bottom: 1px solid var(--color-border-soft);
  background: var(--color-surface);
  padding: 0.75rem;
}

.story-header-options:empty { display: none; }
.story-reader-options { width: 100%; }
.story-reader-options-target { display: none; }

.story-mode-switch {
  display: flex;
  min-width: 0;
  gap: 0.25rem;
  border: 1px solid var(--color-border-soft);
  border-radius: 0.875rem;
  background: var(--color-surface-alt);
  padding: 0.25rem;
}

.story-mode-switch button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 0.625rem;
  padding: 0.375rem 0.75rem;
  color: var(--color-fg-muted);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.story-mode-switch button.is-active {
  background: var(--color-brand-600);
  color: white;
  box-shadow: 0 2px 5px rgb(0 0 0 / 12%);
}

.story-mode-switch button:not(.is-active):hover {
  background: var(--color-surface);
  color: var(--color-fg);
}

.story-reader-controls {
  position: relative;
  z-index: 30;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  flex-shrink: 0;
  align-items: center;
  gap: 0.375rem;
  border-block: 1px solid var(--color-border-soft);
  background: var(--color-surface);
  padding: 0.375rem 0.75rem;
}

.story-frame-navigation {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
}

.story-reader-leading { display: contents; }
.story-frame-navigation-start { grid-column: 1; flex-wrap: wrap; }
.story-frame-navigation-end { grid-column: 2; justify-content: flex-end; }
.story-frame-position { min-width: 2.75rem; }

.story-nav-button {
  display: inline-flex;
  min-width: 44px;
  min-height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid var(--color-border-soft);
  border-radius: 0.75rem;
  background: var(--color-surface-alt);
  padding: 0.5rem 0.75rem;
  color: var(--color-fg);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.story-nav-next {
  border-color: var(--color-brand-600);
  background: var(--color-brand-600);
  color: white;
}

.story-nav-button:hover:not(:disabled) { border-color: var(--color-brand-400); }
.story-nav-button:disabled { cursor: default; opacity: 0.4; }

.story-composer-footer { background: var(--color-surface); }
.story-composer { display: grid; gap: 0.625rem; }

.story-write-box {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--color-border-soft);
  border-radius: 1rem;
  background: var(--color-field);
  padding: 0.5rem;
}

.story-write-box:focus-within {
  border-color: var(--color-brand-400);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-brand-500) 12%, transparent);
}

.story-write-input {
  width: 100%;
  min-width: 0;
  min-height: 60px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 0.375rem;
  font-size: 0.875rem;
  line-height: 1.5;
}
.story-write-input::placeholder { color: var(--color-fg-muted); }
.story-send-button { width: 96px; min-height: 44px; flex-shrink: 0; padding-inline: 0.75rem; box-shadow: none; }
.story-generation-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }

.story-generate-button {
  display: flex;
  min-width: 0;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  border: 1px solid var(--color-border-soft);
  border-radius: 0.875rem;
  background: var(--color-surface-alt);
  padding: 0.5rem 0.75rem;
  color: var(--color-fg);
  text-align: left;
  cursor: pointer;
}
.story-generate-button strong { display: block; font-size: 0.8125rem; }
.story-generate-button small { display: block; color: var(--color-fg-muted); font-size: 0.6875rem; }
.story-generate-button > svg { color: var(--color-brand-500); }
.story-generate-button:hover:not(:disabled) { border-color: var(--color-brand-400); background: var(--color-surface); }
.story-generate-button:disabled { opacity: 0.45; cursor: not-allowed; }

@media (min-width: 640px) {
  .story-header { padding: 0.75rem 1.25rem; }
  .story-reader-controls { column-gap: 0.5rem; padding-inline: 1.25rem; }
  .story-reader-options-target { display: block; grid-column: 1 / -1; grid-row: 1; min-width: 0; }
  .story-frame-navigation-start, .story-frame-navigation-end { grid-row: 2; }
}

@media (min-width: 1280px) {
  .story-reader-leading { display: flex; grid-column: 1; grid-row: 1; min-width: 0; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .story-reader-options-target { flex: 0 1 auto; }
  .story-frame-navigation-start { flex: 0 0 auto; }
  .story-frame-navigation-end { grid-row: 1; }
  .story-header { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
  .story-composer { grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; }
  .story-generation-controls { min-width: 240px; }
}


.visual-message-actions {
  display: none;
}

.visual-message-actions.debug-visible {
  display: flex;
  opacity: 1;
  pointer-events: auto;
}

@media (min-width: 640px) and (hover: hover) and (pointer: fine) {
  .visual-message-actions {
    display: flex;
    opacity: 0;
    pointer-events: none;
    transition: opacity 150ms ease;
  }

  .visual-novel-view:hover .visual-message-actions,
  .visual-message-actions:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
