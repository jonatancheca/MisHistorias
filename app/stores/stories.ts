import { defineStore } from 'pinia'
import { reportClientErrorTrace } from '~/lib/errorTraces'
import type {
  Background,
  Character,
  CharacterImage,
  GenerationMode,
  LlmDebugRequest,
  LlmDebugTrace,
  Message,
  Sound,
  ProtagonistPreferencesMode,
  ResponseStyleAmount,
  ResponseSpeed,
  Story,
  StorySaveSlot,
  StoryCharacterCustomization,
  StoryPendingImageInstruction,
  StoryGenerationAttempt,
  ContextUsage
} from '#shared/types'
import {
  deleteMessage as dbDeleteMessage,
  deleteMessages as dbDeleteMessages,
  deleteLlmDebugTrace as dbDeleteLlmDebugTrace,
  deleteStory,
  deleteStorySave as dbDeleteStorySave,
  createStorySave as dbCreateStorySave,
  copySharedDemoStory as dbCopySharedDemoStory,
  loadStorySave as dbLoadStorySave,
  listLlmDebugTraces,
  listMessages,
  listStorySaves,
  listStories,
  newId,
  putLlmDebugTrace,
  putMessage,
  putStory,
  putStoryInScope,
  getActiveDataScope,
  getCharacter,
  type DataScope,
  type StoredImage
} from '~/lib/db'
import {
  buildChatMessages,
  buildCompactionMessages,
  buildHistory,
  type ChatMessage,
  chatContextSize,
  resolveProtagonistPreferences
} from '~/lib/promptBuilder'
import { buildMockResponse } from '~/lib/mockLlm'
import { readSwarmDiagnostic } from '../../shared/utils/swarmError.ts'
import { fetchLlmChat, fetchLlmContext, type LlmCallError } from '~/lib/llm'
import { fetchChromeLlmChat, measureChromeLlmContext } from '~/lib/chromeLlm'
import { contextFits, exceededContextLimit, tokenContextUsage, summarizeInBlocks, CompactionCapacityError } from '~/lib/contextBudget'
import { hideIncompleteVisualDirectivePrefix, parseSegments } from '~/lib/streamParser'
import { selectCharacterImage } from '~/lib/imageSelection'
import { sanitizeTags } from '~/lib/tags'
import { DEFAULT_CHARACTER_COLOR, normalizeColor } from '~/lib/colors'
import { responseCharactersPerSecond } from '~/lib/responseSpeed'
import {
  currentRevealLine,
  isHiddenVisualRevealLine
} from '~/lib/progressiveReveal'
import { replaceFollowingMatchingDialogueImages } from '~/lib/messageImages'
import {
  buildStoryImageCatalog,
  compareStoryImageCatalogs,
  formatStoryImageCatalogChange
} from '~/lib/imageCatalog'
import {
  createStoryImageJobs,
  generateCharacterImage,
  parseStoryImageRequests,
  type CharacterImageJob
} from '~/lib/storyImageGeneration'
import { storyCustomizationIds } from '~/lib/storyCharacterCustomizations'
import {
  latestStoryGenerationFeedback,
  storyGenerationErrorMessage,
  type StoryGenerationFeedback
} from '~/lib/storyGenerationFeedback'
import { matchesBackgroundStyle, normalizeBackgroundStyle } from '~/lib/backgroundStyles'

function normalizeCharacterCustomizations(
  characterIds: string[],
  characters: Character[],
  customizations: StoryCharacterCustomization[] = []
) {
  const requested = new Map(customizations.map((item) => [item.characterId, item]))
  const available = new Map(characters.map((character) => [character.id, character]))
  const customizationIds = storyCustomizationIds(characterIds, customizations)
  return customizationIds.flatMap((characterId) => {
    const source = requested.get(characterId) ?? available.get(characterId)
    return source
      ? [
          {
            characterId,
            name: source.name?.trim() || available.get(characterId)?.name || '',
            color: normalizeColor(
              source.color,
              normalizeColor(available.get(characterId)?.color, DEFAULT_CHARACTER_COLOR)
            ),
            prompt: source.prompt,
            tags: sanitizeTags(source.tags)
          }
        ]
      : []
  })
}

function storyCharactersWithCustomNames(story: Story, characters: Character[]) {
  const customizations = new Map(
    (story.characterCustomizations ?? []).map((item) => [item.characterId, item])
  )
  return characters
    .filter((character) => story.characterIds.includes(character.id))
    .map((character) => ({
      ...character,
      name: customizations.get(character.id)?.name?.trim() || character.name,
      color: normalizeColor(customizations.get(character.id)?.color, character.color)
    }))
}

interface GraphemeSegment {
  segment: string
}

type SegmenterConstructor = new (
  locale?: string | string[],
  options?: { granularity: 'grapheme' }
) => { segment: (value: string) => Iterable<GraphemeSegment> }

function splitGraphemes(value: string) {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
  if (!Segmenter) return Array.from(value)
  return Array.from(
    new Segmenter(undefined, { granularity: 'grapheme' }).segment(value),
    ({ segment }) => segment
  )
}

function validPendingImageInstructions(
  story: Story,
  images: CharacterImage[]
): StoryPendingImageInstruction[] {
  const storyCharacters = new Set(story.characterIds)
  const imagesById = new Map(images.map((image) => [image.id, image]))
  return (story.pendingImageInstructions ?? []).filter((instruction) => {
    const image = imagesById.get(instruction.imageId)
    return Boolean(
      storyCharacters.has(instruction.characterId) &&
      image?.characterId === instruction.characterId &&
      instruction.tags.length
    )
  })
}

function playNewSounds(
  segments: Message['segments'],
  played: Set<string>,
  sounds: ReturnType<typeof useSoundsStore>,
  audible = true
) {
  segments.forEach((segment, index) => {
    if (segment.type !== 'sound' || !segment.soundId) return
    const key = `${index}:${segment.soundId}`
    if (played.has(key)) return
    played.add(key)
    if (audible) sounds.play(segment.soundId)
  })
}

interface ImageGenerationProgress {
  completed: number
  total: number
  error?: Error
  canceled?: boolean
}

interface ImageGenerationBatch {
  pending: number
  progress: ImageGenerationProgress
  stopped: boolean
  resolve: (result: ImageGenerationBatchResult) => void
  result?: ImageGenerationBatchResult
}

interface ImageGenerationBatchResult {
  completed: number
  error?: Error
  canceled?: boolean
}

interface QueuedImageGenerationTask {
  lifecycle: number
  batch: ImageGenerationBatch
  priority: number
  storyId: string
  scope: DataScope
  character: Character
  job: CharacterImageJob
  charactersStore: ReturnType<typeof useCharactersStore>
  onSaved?: (image: StoredImage, job: CharacterImageJob, signal: AbortSignal) => void | Promise<void>
}

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref<Story[]>([])
  const loaded = ref(false)
  let loadRevision = 0

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
  const debugTraces = ref<LlmDebugTrace[]>([])
  const saveSlots = ref<StorySaveSlot[]>([])
  const saveSlotsLoading = ref(false)
  const saveSlotsError = ref<string | null>(null)
  let storyOpenRevision = 0
  let auxiliaryController: AbortController | null = null
  let pendingTraceLoad: Promise<void> | null = null
  let debugLoadError: string | null = null
  const removedMessageIds = new Set<string>()
  const removedSaveIds = new Set<string>()
  const generating = ref(false)
  const waitingForResponse = ref(false)
  const retryingEmptyResponse = ref(false)
  const compacting = ref(false)
  const canCompactInBlocks = ref(false)
  let blockRetry: (() => Promise<void>) | null = null
  let blockPendingText: string | null = null
  watch(() => activeStory.value?.id, () => {
    canCompactInBlocks.value = false
    blockRetry = null
    blockPendingText = null
  })
  const pendingAssistantMessage = ref<Message | null>(null)
  const visualRevealWaitingForAdvance = ref(false)
  const visualRevealNavigationPaused = ref(false)
  const error = ref<string | null>(null)
  const transientGenerationFeedback = ref<StoryGenerationFeedback | null>(null)
  const generationFeedback = computed(() =>
    transientGenerationFeedback.value ?? latestStoryGenerationFeedback(debugTraces.value, messages.value)
  )
  const generatingImages = ref(false)
  const imageGenerationCharacter = ref('')
  const imageGenerationTags = ref<string[]>([])
  const imageGenerationCompleted = ref(0)
  const imageGenerationTotal = ref(0)
  const imageGenerationError = ref<string | null>(null)

  let controller: AbortController | null = null
  let animationFrame: number | null = null
  let finishAnimation: ((completed: boolean) => void) | null = null
  let completeRevealLine: (() => boolean) | null = null
  let setRevealNavigationPaused: ((paused: boolean) => boolean) | null = null
  let setRevealManualAdvance: ((enabled: boolean) => boolean) | null = null
  let setRevealVisualMode: ((enabled: boolean) => void) | null = null
  let startNextRevealLine: (() => boolean) | null = null
  let animationDraft: Message | null = null
  let generationModeInProgress: GenerationMode | null = null
  let imageQueue: QueuedImageGenerationTask[] = []
  let imageQueueRunning = false
  let imageTaskController: AbortController | null = null
  let imageTask: QueuedImageGenerationTask | null = null
  let imageGenerationLifecycle = 0

  function imageCancellationError() {
    const cancellation = new Error('Generación de imágenes cancelada.')
    cancellation.name = 'AbortError'
    return cancellation
  }

  function isImageTaskActive(task: QueuedImageGenerationTask) {
    return task.lifecycle === imageGenerationLifecycle &&
      task.scope === getActiveDataScope() && activeStory.value?.id === task.storyId
  }

  async function persistSwarmFailure(task: QueuedImageGenerationTask, caught: unknown, signal: AbortSignal) {
    const call = readSwarmDiagnostic((caught as { diagnostic?: unknown })?.diagnostic)
    if (!call || signal.aborted || !isImageTaskActive(task)) return
    const message: Message = {
      id: newId(), storyId: task.storyId, role: 'assistant',
      raw: `Error de SwarmUI para ${task.job.characterName}: ${call.message}`,
      segments: [], createdAt: Date.now(),
      swarmError: { characterId: task.job.characterId, characterName: task.job.characterName, tags: [...task.job.tags], call }
    }
    try {
      // Esperar la escritura permite borrarla después de navegar, sin competir con un PUT abortado.
      await putMessage(message, task.scope)
      if (signal.aborted || !isImageTaskActive(task)) {
        await dbDeleteMessage(message.id, task.scope)
        return
      }
      messages.value.push(message)
      messages.value.sort((left, right) => left.createdAt - right.createdAt)
    } catch (failure) {
      if (signal.aborted || !isImageTaskActive(task)) {
        await dbDeleteMessage(message.id, task.scope).catch(() => undefined)
        return
      }
      if ((failure as Error).name !== 'AbortError' && isImageTaskActive(task)) {
        error.value = 'No se pudo guardar el diagnóstico de SwarmUI.'
      }
    }
  }

  function updateImageQueueState() {
    generatingImages.value = Boolean(imageTaskController || imageQueue.length)
    if (!generatingImages.value) {
      imageGenerationCharacter.value = ''
      imageGenerationTags.value = []
    }
  }

  function finishImageBatchTask(task: QueuedImageGenerationTask) {
    task.batch.pending -= 1
    if (task.batch.pending > 0 || task.batch.result) return
    const result: ImageGenerationBatchResult = {
      completed: task.batch.progress.completed,
      ...(task.batch.progress.error ? { error: task.batch.progress.error } : {}),
      ...(task.batch.progress.canceled ? { canceled: true } : {})
    }
    task.batch.result = result
    task.batch.resolve(result)
  }

  function stopQueuedImageBatch(batch: ImageGenerationBatch, cause: unknown, canceled: boolean) {
    const pending = imageQueue.filter((task) => task.batch === batch)
    imageQueue = imageQueue.filter((task) => task.batch !== batch)
    if (canceled) batch.progress.canceled = true
    if (cause instanceof Error && !batch.progress.error) batch.progress.error = cause
    pending.forEach(() => { batch.pending -= 1 })
    if (batch.pending <= 0 && !batch.result) {
      const result: ImageGenerationBatchResult = {
        completed: batch.progress.completed,
        ...(batch.progress.error ? { error: batch.progress.error } : {}),
        ...(batch.progress.canceled ? { canceled: true } : {})
      }
      batch.result = result
      batch.resolve(result)
    }
    updateImageQueueState()
  }

  async function processImageQueue() {
    if (imageQueueRunning) return
    imageQueueRunning = true
    updateImageQueueState()
    try {
      while (imageQueue.length) {
        imageQueue.sort((left, right) => left.priority - right.priority)
        const task = imageQueue.shift()!
        if (task.batch.stopped) {
          finishImageBatchTask(task)
          continue
        }
        if (!isImageTaskActive(task)) {
          task.batch.stopped = true
          stopQueuedImageBatch(task.batch, imageCancellationError(), true)
          finishImageBatchTask(task)
          continue
        }
        imageTask = task
        imageGenerationCharacter.value = task.job.characterName
        imageGenerationTags.value = [...task.job.tags]
        imageGenerationCompleted.value = task.batch.progress.completed
        imageGenerationTotal.value = task.batch.progress.total
        const taskController = new AbortController()
        imageTaskController = taskController
        updateImageQueueState()
        try {
          const generated = await generateCharacterImage({
            character: task.character,
            job: task.job,
            signal: taskController.signal
          })
          if (taskController.signal.aborted || !isImageTaskActive(task)) {
            throw imageCancellationError()
          }
          const stored = await task.charactersStore.addImage(
            task.job.characterId,
            generated.blob,
            task.job.tags,
            undefined,
            {
              scope: task.scope,
              generation: generated.generation,
              signal: taskController.signal
            }
          )
          if (!isImageTaskActive(task)) throw imageCancellationError()
          task.batch.progress.completed += 1
          imageGenerationCompleted.value = task.batch.progress.completed
          await task.onSaved?.(stored, task.job, taskController.signal)
        } catch (caught) {
          const cancellation = (caught as Error).name === 'AbortError' || taskController.signal.aborted
          if (!cancellation) await persistSwarmFailure(task, caught, taskController.signal)
          task.batch.stopped = true
          stopQueuedImageBatch(task.batch, caught, cancellation)
        } finally {
          imageTask = null
          imageTaskController = null
          finishImageBatchTask(task)
          updateImageQueueState()
        }
      }
    } finally {
      imageQueueRunning = false
      updateImageQueueState()
    }
  }

  function enqueueImageJobs(input: {
    storyId: string
    scope: DataScope
    jobs: CharacterImageJob[]
    priority: number
    charactersStore: ReturnType<typeof useCharactersStore>
    characters: Character[]
    progress: ImageGenerationProgress
    onSaved?: (image: StoredImage, job: CharacterImageJob, signal: AbortSignal) => void | Promise<void>
  }) {
    if (!input.jobs.length) {
      return Promise.resolve<ImageGenerationBatchResult>({
        completed: input.progress.completed,
        ...(input.progress.error ? { error: input.progress.error } : {}),
        ...(input.progress.canceled ? { canceled: true } : {})
      })
    }
    let resolve!: (result: ImageGenerationBatchResult) => void
    const promise = new Promise<ImageGenerationBatchResult>((done) => { resolve = done })
    const batch: ImageGenerationBatch = {
      pending: input.jobs.length,
      progress: input.progress,
      stopped: false,
      resolve
    }
    input.jobs.forEach((job) => {
      const character = input.characters.find((candidate) => candidate.id === job.characterId)
      if (!character) {
        batch.progress.error ??= new Error(`Personaje no disponible: ${job.characterName}.`)
        batch.pending -= 1
        return
      }
      imageQueue.push({
        lifecycle: imageGenerationLifecycle,
        batch,
        priority: input.priority,
        storyId: input.storyId,
        scope: input.scope,
        character,
        job,
        charactersStore: input.charactersStore,
        onSaved: input.onSaved
      })
    })
    if (batch.pending <= 0) {
      const result: ImageGenerationBatchResult = {
        completed: input.progress.completed,
        ...(input.progress.error ? { error: input.progress.error } : {})
      }
      batch.result = result
      resolve(result)
    } else {
      void processImageQueue()
    }
    updateImageQueueState()
    return promise
  }

  function cancelImageGeneration(options: { abandonResponse?: boolean } = {}) {
    if (options.abandonResponse) imageGenerationLifecycle += 1
    const batches = new Set<ImageGenerationBatch>()
    if (imageTask) batches.add(imageTask.batch)
    imageQueue.forEach((task) => batches.add(task.batch))
    if (!batches.size) return
    batches.forEach((batch) => {
      batch.stopped = true
      batch.progress.canceled = true
      stopQueuedImageBatch(batch, imageCancellationError(), true)
    })
    imageTaskController?.abort()
    imageGenerationError.value = 'Generación de imágenes cancelada.'
    updateImageQueueState()
  }

  watch(getActiveDataScope, () => cancelImageGeneration(), { flush: 'sync' })

  async function resetForScope() {
    cancelStoryAuxiliary()
    loadRevision += 1
    cancelImageGeneration({ abandonResponse: true })
    await stop()
    stories.value = []
    loaded.value = false
    activeStory.value = null
    messages.value = []
    debugTraces.value = []
    transientGenerationFeedback.value = null
    saveSlots.value = []
    pendingAssistantMessage.value = null
    compacting.value = false
    visualRevealWaitingForAdvance.value = false
    visualRevealNavigationPaused.value = false
    error.value = null
    generatingImages.value = false
    imageGenerationCharacter.value = ''
    imageGenerationTags.value = []
    imageGenerationCompleted.value = 0
    imageGenerationTotal.value = 0
    imageGenerationError.value = null
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const scope = getActiveDataScope()
    const revision = ++loadRevision
    const result = await listStories(scope)
    if (scope !== getActiveDataScope() || revision !== loadRevision) return
    stories.value = result
    loaded.value = true
  }

  async function createStory(input: {
    title: string
    premise: string
    visualMode?: boolean
    autoGenerateImages?: boolean
    protagonistPreferences: string
    protagonistPreferencesMode: ProtagonistPreferencesMode
    dialogueStyle: ResponseStyleAmount
    narrationStyle: ResponseStyleAmount
    characterIds: string[]
    characterCustomizations: StoryCharacterCustomization[]
    initialBackgroundId: string | null
    backgroundStyle: string | null
  }) {
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const now = Date.now()
    const story: Story = {
      id: newId(),
      title: input.title.trim() || 'Historia sin título',
      premise: input.premise.trim(),
      visualMode: input.visualMode === true,
      archived: false,
      visibleInDemo: usePrivacyStore().isDemo,
      autoGenerateImages: input.autoGenerateImages === true,
      protagonistPreferences: input.protagonistPreferences.trim(),
      protagonistPreferencesMode: input.protagonistPreferencesMode,
      dialogueStyle: input.dialogueStyle,
      narrationStyle: input.narrationStyle,
      characterIds: [...input.characterIds],
      characterCustomizations: normalizeCharacterCustomizations(
        input.characterIds,
        charactersStore.characters,
        input.characterCustomizations
      ),
      initialBackgroundId: input.initialBackgroundId,
      backgroundStyle: normalizeBackgroundStyle(input.backgroundStyle) || null,
      imageCatalogSnapshot: buildStoryImageCatalog(
        input.characterIds,
        charactersStore.characters,
        charactersStore.images
      ),
      pendingImageInstructions: [],
      createdAt: now,
      updatedAt: now
    }
    await putStory(story)
    stories.value = [story, ...stories.value]
    return story
  }

  async function removeStory(id: string) {
    await deleteStory(id)
    stories.value = stories.value.filter((story) => story.id !== id)
    if (activeStory.value?.id === id) {
      cancelStoryAuxiliary()
      activeStory.value = null
      messages.value = []
      debugTraces.value = []
      transientGenerationFeedback.value = null
      saveSlots.value = []
    }
  }

  async function copySharedDemoStory(id: string) {
    const source = stories.value.find((story) => story.id === id)
    if (!source?.readOnly || !source.visibleInDemo) return null
    const copied = await dbCopySharedDemoStory(id)
    await Promise.all([
      load(true),
      useCharactersStore().load(true),
      useBackgroundsStore().load(true),
      useSoundsStore().load(true)
    ])
    return copied
  }

  async function setArchived(id: string, archived: boolean) {
    const story = stories.value.find((item) => item.id === id)
    if (!story || story.archived === archived) return
    const updated: Story = {
      ...story,
      archived,
      updatedAt: Math.max(Date.now(), ...stories.value.map((item) => item.updatedAt + 1))
    }
    await putStory(updated)
    if (activeStory.value?.id === id) activeStory.value = updated
    stories.value = stories.value
      .map((item) => (item.id === id ? updated : item))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function setDemoVisibility(id: string, visibleInDemo: boolean) {
    const story = stories.value.find((item) => item.id === id)
    if (!story || story.visibleInDemo === visibleInDemo) return story ?? null
    const updated: Story = { ...story, visibleInDemo, updatedAt: Date.now() }
    await putStory(updated)
    if (activeStory.value?.id === id) activeStory.value = updated
    stories.value = stories.value.map((item) => (item.id === id ? updated : item))
    return updated
  }

  function cancelStoryAuxiliary() {
    storyOpenRevision += 1
    auxiliaryController?.abort()
    auxiliaryController = null
    pendingTraceLoad = null
    saveSlotsLoading.value = false
  }

  function loadStoryAuxiliary(id: string, scope: DataScope, opening: number) {
    const controller = new AbortController()
    auxiliaryController = controller
    const current = () => !controller.signal.aborted && opening === storyOpenRevision &&
      scope === getActiveDataScope() && activeStory.value?.id === id
    saveSlotsLoading.value = true
    const traces = listLlmDebugTraces(id, scope, controller.signal)
      .then(stored => {
        if (!current()) return
        const merged = new Map(stored.map(trace => [trace.id, trace]))
        for (const trace of debugTraces.value) merged.set(trace.id, trace)
        debugTraces.value = [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
        removeLocalTracesForMessages([...removedMessageIds])
      })
      .catch((caught: unknown) => {
        if (!current()) return
        debugLoadError = (caught as Error).message || 'No se pudieron cargar los datos de Debug.'
        void reportClientErrorTrace({ source: 'client', operation: 'stories.debug.load', scope,
          message: debugLoadError, response: caught })
      })
    pendingTraceLoad = traces
    const saves = listStorySaves(id, scope, controller.signal)
      .then(stored => {
        if (!current()) return
        const merged = new Map(stored.map(save => [save.id, save]))
        for (const save of saveSlots.value) merged.set(save.id, save)
        saveSlots.value = [...merged.values()].filter(save => !removedSaveIds.has(save.id))
          .sort((a, b) => b.createdAt - a.createdAt)
      })
      .catch((caught: unknown) => {
        if (!current()) return
        saveSlotsError.value = 'No se pudieron cargar las partidas. Vuelve a abrir la historia para reintentar.'
        void reportClientErrorTrace({ source: 'client', operation: 'stories.saves.load', scope,
          message: (caught as Error).message || saveSlotsError.value, response: caught })
      })
      .finally(() => {
        if (current()) saveSlotsLoading.value = false
      })
    void Promise.all([traces, saves]).then(() => {
      if (auxiliaryController === controller) auxiliaryController = null
      if (pendingTraceLoad === traces) pendingTraceLoad = null
    })
  }

  async function openStory(id: string) {
    cancelStoryAuxiliary()
    const opening = storyOpenRevision
    const scope = getActiveDataScope()
    await load()
    if (scope !== getActiveDataScope() || opening !== storyOpenRevision) return
    const revision = loadRevision
    visualRevealNavigationPaused.value = false
    visualRevealWaitingForAdvance.value = false
    activeStory.value = stories.value.find((story) => story.id === id) ?? null
    messages.value = []
    debugTraces.value = []
    saveSlots.value = []
    saveSlotsError.value = null
    debugLoadError = null
    removedMessageIds.clear()
    removedSaveIds.clear()
    const storedMessages = activeStory.value ? await listMessages(id, scope) : []
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    if (scope !== getActiveDataScope() || revision !== loadRevision || opening !== storyOpenRevision) return
    const changed: Message[] = []
    const normalizedMessages = storedMessages.map((message) => {
      if (message.role !== 'assistant' || message.swarmError) return message
      let didChange = false
      const segments = message.segments.map((segment, index) => {
        if (segment.type !== 'dialogue' || !segment.characterId || segment.imageId !== undefined) {
          return segment
        }
        didChange = true
        return {
          ...segment,
          imageId: selectCharacterImage(
            charactersStore.images,
            segment.characterId,
            segment.tag,
            `${message.id}:${index}`
          )?.id ?? null
        }
      })
      if (!didChange) return message
      const normalized = { ...message, segments }
      changed.push(normalized)
      return normalized
    })
    if (changed.length) await Promise.all(changed.map((message) => putMessage(message, scope)))
    if (scope !== getActiveDataScope() || opening !== storyOpenRevision) return
    messages.value = normalizedMessages
    transientGenerationFeedback.value = null
    error.value = null
    if (activeStory.value) loadStoryAuxiliary(id, scope, opening)
  }

  async function createSaveSlot(name: string, thumbnailDataUrl: string) {
    if (!activeStory.value) return null
    const id = activeStory.value.id
    const opening = storyOpenRevision
    const save = await dbCreateStorySave(id, name, thumbnailDataUrl)
    if (opening === storyOpenRevision && activeStory.value?.id === id) {
      saveSlots.value = [save, ...saveSlots.value]
    }
    return save
  }

  async function loadSaveSlot(id: string) {
    if (!activeStory.value) return null
    await stop()
    const result = await dbLoadStorySave(id)
    await load(true)
    await openStory(result.story.id)
    return result
  }

  async function removeSaveSlot(id: string) {
    const opening = storyOpenRevision
    await dbDeleteStorySave(id)
    if (opening !== storyOpenRevision) return
    removedSaveIds.add(id)
    saveSlots.value = saveSlots.value.filter((save) => save.id !== id)
  }

  async function touchStory() {
    if (!activeStory.value) return
    const updated = { ...activeStory.value, updatedAt: Date.now() }
    await putStory(updated)
    activeStory.value = updated
    stories.value = stories.value
      .map((story) => (story.id === updated.id ? updated : story))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async function persist(message: Message) {
    await putMessage(message)
    const index = messages.value.findIndex((item) => item.id === message.id)
    if (index >= 0) messages.value[index] = message
    else messages.value.push(message)
    messages.value.sort((left, right) => left.createdAt - right.createdAt)
  }

  async function persistStoryState(updated: Story) {
    await putStory(updated)
    if (activeStory.value?.id === updated.id) activeStory.value = updated
    stories.value = stories.value.map((story) => (story.id === updated.id ? updated : story))
  }

  async function invalidateContextSummaryFromIndex(index: number) {
    if (!activeStory.value?.contextSummaryThroughMessageId || index < 0) return
    const throughIndex = messages.value.findIndex(
      (message) => message.id === activeStory.value?.contextSummaryThroughMessageId
    )
    if (throughIndex < 0 || index > throughIndex) return
    await persistStoryState({
      ...activeStory.value,
      contextSummary: undefined,
      contextSummaryThroughMessageId: undefined,
      updatedAt: Date.now()
    })
  }

  async function addUserMessage(text: string) {
    if (!activeStory.value) return null
    const message: Message = {
      id: newId(),
      storyId: activeStory.value.id,
      role: 'user',
      raw: text.trim(),
      segments: [],
      createdAt: Date.now()
    }
    await persist(message)
    return message
  }

  async function updateMessage(id: string, raw: string) {
    const current = messages.value.find((message) => message.id === id)
    if (!current || current.swarmError) return
    await invalidateContextSummaryFromIndex(messages.value.findIndex((message) => message.id === id))
    const characters = useCharactersStore()
    const backgrounds = useBackgroundsStore()
    const sounds = useSoundsStore()
    const settings = useSettingsStore()
    const storyCharacters = activeStory.value
      ? storyCharactersWithCustomNames(activeStory.value, characters.characters)
      : []
    const storyBackgrounds = activeStory.value
      ? backgrounds.backgrounds.filter((background) =>
          matchesBackgroundStyle(background, activeStory.value?.backgroundStyle)
        )
      : backgrounds.backgrounds
    const updated: Message = {
      ...current,
      raw,
      segments:
        current.role === 'assistant'
          ? parseSegments(
              raw,
              storyCharacters,
              storyBackgrounds,
              settings.activeUserName,
              characters.images,
              current.id,
              sounds.sounds
            )
          : []
    }
    await persist(updated)
  }

  async function replaceMessageSegmentImage(messageId: string, segmentIndex: number, imageId: string) {
    const current = messages.value.find((message) => message.id === messageId)
    const segment = current?.segments[segmentIndex]
    if (!current || current.swarmError || current.role !== 'assistant' || segment?.type !== 'dialogue' || !segment.characterId) {
      return false
    }
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const image = charactersStore.images.find((candidate) => candidate.id === imageId)
    if (!image || image.characterId !== segment.characterId) return false
    const updated: Message = {
      ...current,
      segments: replaceFollowingMatchingDialogueImages(current.segments, segmentIndex, imageId)
    }
    await persist(updated)
    return true
  }

  async function setPendingImageInstruction(imageId: string) {
    if (!activeStory.value) return false
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const image = charactersStore.images.find((candidate) => candidate.id === imageId)
    if (!image || !activeStory.value.characterIds.includes(image.characterId)) return false
    const pending = validPendingImageInstructions(activeStory.value, charactersStore.images)
      .filter((instruction) => instruction.characterId !== image.characterId)
    pending.push({ characterId: image.characterId, imageId: image.id, tags: [...image.tags] })
    await persistStoryState({
      ...activeStory.value,
      pendingImageInstructions: pending,
      updatedAt: Date.now()
    })
    return true
  }

  async function removePendingImageInstruction(characterId: string) {
    if (!activeStory.value) return
    const current = activeStory.value.pendingImageInstructions ?? []
    const pending = current.filter((instruction) => instruction.characterId !== characterId)
    if (pending.length === current.length) return
    await persistStoryState({
      ...activeStory.value,
      pendingImageInstructions: pending,
      updatedAt: Date.now()
    })
  }

  async function consumePendingImageInstructions(consumed: StoryPendingImageInstruction[]) {
    if (!activeStory.value || !consumed.length) return
    const keys = new Set(consumed.map((instruction) => `${instruction.characterId}:${instruction.imageId}`))
    const pending = (activeStory.value.pendingImageInstructions ?? [])
      .filter((instruction) => !keys.has(`${instruction.characterId}:${instruction.imageId}`))
    await persistStoryState({
      ...activeStory.value,
      pendingImageInstructions: pending,
      updatedAt: Date.now()
    })
  }

  async function removeMessage(id: string) {
    await invalidateContextSummaryFromIndex(messages.value.findIndex((message) => message.id === id))
    await dbDeleteMessage(id)
    messages.value = messages.value.filter((message) => message.id !== id)
    removeLocalTracesForMessages([id])
  }

  function replaceDraft(message: Message) {
    animationDraft = message
    const index = messages.value.findIndex((item) => item.id === message.id)
    if (index >= 0) messages.value[index] = message
    else messages.value.push(message)
  }

  async function persistDebugTrace(trace: LlmDebugTrace, scope = getActiveDataScope()) {
    try {
      await putLlmDebugTrace(trace, scope)
      if (scope !== getActiveDataScope() || activeStory.value?.id !== trace.storyId) return true
      const index = debugTraces.value.findIndex((item) => item.id === trace.id)
      if (index >= 0) debugTraces.value[index] = trace
      else debugTraces.value.push(trace)
      debugTraces.value.sort((a, b) => a.createdAt - b.createdAt)
      return true
    } catch {
      return false
    }
  }

  async function compactHistoryIfNeeded(options: {
    chatOptions: Parameters<typeof buildChatMessages>[0]
    historyMessages: Message[]
    historyBudget: number
    tokenBudget: number
    allowBlocks: boolean
    onUsage: (usage: ContextUsage) => void
    compactionPrompt: string
    model: string
    temperature: number
    maxTokens: number
    useChromeLlm: boolean
    signal: AbortSignal
    scope: DataScope
    isActive: () => boolean
  }) {
    const { chatOptions } = options
    const story = chatOptions.story
    const measure = async (messages: ChatMessage[], manualLimit = true): Promise<ContextUsage> => {
      options.signal.throwIfAborted()
      if (options.tokenBudget === 0) return {
        unit: 'characters', count: chatContextSize(messages), configuredLimit: options.historyBudget,
        effectiveLimit: manualLimit ? options.historyBudget : 0, model: options.useChromeLlm ? 'chrome-prompt-api' : options.model
      }
      const result = options.useChromeLlm
        ? await measureChromeLlmContext(messages, options.signal)
        : await fetchLlmContext(messages, options.model, options.scope, options.signal)
      if (!options.isActive()) throw new DOMException('Petición cancelada', 'AbortError')
      return {
        ...tokenContextUsage(result.tokens, result.capacity, options.useChromeLlm ? 0 : options.maxTokens,
          manualLimit ? options.tokenBudget : 0, result.model),
        characters: { count: chatContextSize(messages), limit: manualLimit ? options.historyBudget : 0 }
      }
    }
    const contextBefore = buildChatMessages(chatOptions)
    const beforeUsage = await measure(contextBefore)
    options.onUsage(beforeUsage)
    const historyBudget = beforeUsage.effectiveLimit
    if (contextFits(beforeUsage)) {
      return story
    }

    const historicalIds = new Set(options.historyMessages.map((message) => message.id))
    const pendingMessages = chatOptions.messages.filter((message) => !historicalIds.has(message.id))
    // Reserva el encabezado del resumen; el contexto final se vuelve a medir completo.
    const baseline = await measure(buildChatMessages({
      ...chatOptions,
      story: { ...story, contextSummary: 'x', contextSummaryThroughMessageId: undefined },
      messages: pendingMessages
    }))
    const summaryBudget = historyBudget > 0 ? historyBudget - baseline.count + 1 : undefined
    const summaryCharacterBudget = baseline.characters?.limit
      ? baseline.characters.limit - baseline.characters.count + 1 : undefined
    if ((summaryBudget !== undefined && summaryBudget <= 0) ||
        (summaryCharacterBudget !== undefined && summaryCharacterBudget <= 0)) {
      const exceeded = exceededContextLimit(baseline)
      throw new Error(`El mensaje y las instrucciones de la historia superan el límite de ${exceeded.limit} ${exceeded.unit}. Acorta el mensaje o aumenta el límite en Ajustes.`)
    }
    if (!options.historyMessages.length && !story.contextSummary?.trim()) {
      const exceeded = exceededContextLimit(beforeUsage)
      throw new Error(`La petición supera el límite de ${exceeded.limit} ${exceeded.unit} y no hay historial anterior que compactar. Acorta el mensaje o aumenta el límite en Ajustes.`)
    }

    const triggerMessageId = options.historyMessages.at(-1)?.id ?? story.contextSummaryThroughMessageId

    const compactionMessages = buildCompactionMessages({
      previousSummary: story.contextSummary,
      throughMessageId: story.contextSummaryThroughMessageId,
      messages: options.historyMessages,
      characters: chatOptions.characters,
      userName: chatOptions.userName,
      summaryBudget,
      summaryUnit: beforeUsage.unit,
      summaryCharacterBudget,
      prompt: options.compactionPrompt
    })
    const debugRequest: LlmDebugRequest = {
      provider: options.useChromeLlm ? 'chrome' : 'lmstudio',
      purpose: 'compaction',
      model: options.useChromeLlm ? 'chrome-prompt-api' : options.model,
      messages: compactionMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
      compaction: { before: contextBefore, historyBudget, beforeUsage, applied: false }
    }
    compacting.value = true

    try {
      const compactRequest = async (messages: typeof compactionMessages) => {
        const usage = await measure(messages, false)
        debugRequest.messages = messages
        debugRequest.contextUsage = usage
        debugRequest.model = usage.model
        if (!contextFits(usage)) throw new CompactionCapacityError()
        const result = options.useChromeLlm
          ? await fetchChromeLlmChat({
            messages,
            operation: 'story.compaction',
            contextLimit: usage.unit === 'tokens' ? usage.effectiveLimit : undefined,
            signal: options.signal
          })
        : await fetchLlmChat({
            model: usage.model,
            messages,
            operation: 'story.compaction',
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            scope: options.scope,
            signal: options.signal
          })
        if (!options.isActive()) throw new DOMException('Petición cancelada', 'AbortError')
        const summary = result.content.trim()
        if (!summary) throw new Error('El modelo no devolvió un resumen visible.')
        if (result.finishReason === 'length') {
          throw new Error('La compactación es insuficiente: el resumen quedó truncado por el máximo de tokens.')
        }
        if (options.allowBlocks) {
          debugRequest.compaction!.blocks ??= []
          debugRequest.compaction!.blocks.push({ messages, contextUsage: usage, summary })
        }
        return result
      }
      let result: { content: string; finishReason: string | null }
      if (options.allowBlocks && options.tokenBudget > 0) {
        const blockMessages = (previousSummary: string, history: typeof compactionMessages) => [
          compactionMessages[0]!,
          { role: 'user' as const, content: JSON.stringify({ previousSummary, history }) }
        ]
        const summary = await summarizeInBlocks({
          previousSummary: story.contextSummary ?? '',
          history: buildHistory(options.historyMessages, chatOptions.characters, 0, chatOptions.userName, story.contextSummaryThroughMessageId),
          signal: options.signal,
          fits: async (previousSummary, history) => contextFits(await measure(blockMessages(previousSummary, history), false)),
          summarize: async (previousSummary, history) => (await compactRequest(blockMessages(previousSummary, history))).content.trim()
        })
        result = { content: summary, finishReason: 'stop' }
      } else result = await compactRequest(compactionMessages)
      const summary = result.content.trim()
      const updated = {
        ...(activeStory.value?.id === story.id ? activeStory.value : story),
        contextSummary: summary,
        contextSummaryThroughMessageId: triggerMessageId,
        updatedAt: Date.now()
      }
      const contextAfter = buildChatMessages({ ...chatOptions, story: updated })
      debugRequest.compaction!.after = contextAfter
      const afterUsage = await measure(contextAfter)
      debugRequest.compaction!.afterUsage = afterUsage
      if (!contextFits(afterUsage)) {
        const exceeded = exceededContextLimit(afterUsage)
        throw new Error(`La compactación es insuficiente: la petición ocupa ${exceeded.count} ${exceeded.unit} y el límite es ${exceeded.limit}. Acorta el mensaje o aumenta el límite en Ajustes.`)
      }
      options.onUsage(afterUsage)
      await putStoryInScope(updated, options.scope, options.signal)
      if (!options.isActive()) throw new DOMException('Petición cancelada', 'AbortError')
      activeStory.value = updated
      stories.value = stories.value.map((item) => item.id === story.id ? updated : item)
      debugRequest.compaction!.applied = true
      const stored = await persistDebugTrace({
        id: newId(),
        storyId: story.id,
        requestMessageId: triggerMessageId,
        status: 'success',
        request: debugRequest,
        response: { content: result.content, finishReason: result.finishReason },
        createdAt: Date.now()
      }, options.scope)
      if (!stored) error.value = 'El historial se compactó, pero no se pudo guardar su traza de debug.'
      return updated
    } catch (caught) {
      if ((caught as Error).name === 'AbortError' || !options.isActive()) throw caught
      const callError = caught as LlmCallError
      const message = callError.message || 'No se pudo compactar el historial.'
      await persistDebugTrace({
        id: newId(),
        storyId: story.id,
        requestMessageId: triggerMessageId,
        status: 'error',
        request: debugRequest,
        response: {
          error: message,
          status: callError.status,
          detail: callError.detail
        },
        createdAt: Date.now()
      }, options.scope)
      error.value = message
      throw caught
    } finally {
      compacting.value = false
    }
  }

  async function persistImageCatalogSnapshot(
    story: Story,
    snapshot: Story['imageCatalogSnapshot'],
    scope: DataScope = getActiveDataScope(),
    signal?: AbortSignal
  ) {
    if (!snapshot) return false
    if (scope !== getActiveDataScope() || signal?.aborted) return false
    try {
      const source = activeStory.value?.id === story.id ? activeStory.value : story
      const updated = { ...source, imageCatalogSnapshot: snapshot }
      await putStoryInScope(updated, scope, signal)
      if (scope !== getActiveDataScope() || signal?.aborted) return false
      if (activeStory.value?.id === story.id) activeStory.value = updated
      stories.value = stories.value.map((item) => (item.id === story.id ? updated : item))
      return true
    } catch {
      return false
    }
  }

  function removeLocalTracesForMessages(ids: string[]) {
    ids.forEach(id => removedMessageIds.add(id))
    const idSet = new Set(ids)
    debugTraces.value = debugTraces.value.filter(
      (trace) =>
        !(trace.responseMessageId && idSet.has(trace.responseMessageId)) &&
        !(
          (trace.status === 'error' || trace.request.purpose === 'compaction') &&
          trace.requestMessageId &&
          idSet.has(trace.requestMessageId)
        )
    )
  }

  async function updateStorySettings(
    title: string,
    premise: string,
    visualMode: boolean,
    autoGenerateImages: boolean,
    protagonistPreferences: string,
    protagonistPreferencesMode: ProtagonistPreferencesMode,
    dialogueStyle: ResponseStyleAmount,
    narrationStyle: ResponseStyleAmount,
    characterIds: string[],
    characterCustomizations: StoryCharacterCustomization[],
    initialBackgroundId: string | null,
    backgroundStyle: string | null,
    visibleInDemo?: boolean
  ) {
    if (!activeStory.value || !title.trim() || !premise.trim() || !characterIds.length) return
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const updated: Story = {
      ...activeStory.value,
      title: title.trim(),
      premise: premise.trim(),
      visualMode,
      autoGenerateImages,
      visibleInDemo: visibleInDemo ?? activeStory.value.visibleInDemo,
      protagonistPreferences: protagonistPreferences.trim(),
      protagonistPreferencesMode,
      dialogueStyle,
      narrationStyle,
      characterIds: [...characterIds],
      characterCustomizations: normalizeCharacterCustomizations(
        characterIds,
        charactersStore.characters,
        characterCustomizations
      ),
      initialBackgroundId,
      backgroundStyle: normalizeBackgroundStyle(backgroundStyle) || null,
      pendingImageInstructions: (activeStory.value.pendingImageInstructions ?? [])
        .filter((instruction) => characterIds.includes(instruction.characterId)),
      updatedAt: Date.now()
    }
    await putStory(updated)
    activeStory.value = updated
    stories.value = stories.value.map((story) => (story.id === updated.id ? updated : story))
  }

  async function setVisualMode(visualMode: boolean) {
    if (!activeStory.value || activeStory.value.visualMode === visualMode) return
    const updated: Story = { ...activeStory.value, visualMode }
    await putStory(updated)
    activeStory.value = updated
    stories.value = stories.value.map((story) => (story.id === updated.id ? updated : story))
    setRevealVisualMode?.(visualMode)
  }

  function cancelAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    animationFrame = null
    completeRevealLine = null
    setRevealNavigationPaused = null
    setRevealManualAdvance = null
    setRevealVisualMode = null
    startNextRevealLine = null
    visualRevealWaitingForAdvance.value = false
    const finish = finishAnimation
    finishAnimation = null
    finish?.(false)
  }

  function completeCurrentRevealLine() {
    if (!completeRevealLine) return false
    return completeRevealLine()
  }

  function pauseVisualReveal() {
    visualRevealNavigationPaused.value = true
    return setRevealNavigationPaused?.(true) ?? false
  }

  function resumeVisualReveal() {
    visualRevealNavigationPaused.value = false
    return setRevealNavigationPaused?.(false) ?? false
  }

  function setVisualRevealManualAdvance(enabled: boolean) {
    return setRevealManualAdvance?.(enabled) ?? false
  }

  function startNextVisualReveal() {
    return startNextRevealLine?.() ?? false
  }

  async function stop(options: { preserveAutoResponse?: boolean } = {}) {
    if (options.preserveAutoResponse && generationModeInProgress === 'auto' && !retryingEmptyResponse.value && !compacting.value) return

    const wasWaiting = waitingForResponse.value
    const wasCompacting = compacting.value
    const draft = animationDraft
    const wasAnimating = finishAnimation !== null
    if (!generating.value && !wasWaiting && !wasAnimating && !wasCompacting) return

    controller?.abort()
    controller = null
    waitingForResponse.value = false
    retryingEmptyResponse.value = false
    compacting.value = false
    cancelAnimation()
    animationDraft = null
    pendingAssistantMessage.value = null

    try {
      if (draft?.raw.trim()) {
        await persist(draft)
        await touchStory()
      } else if (draft) {
        messages.value = messages.value.filter((message) => message.id !== draft.id)
      }
    } finally {
      generating.value = false
    }
  }

  function revealAssistantResponse(
    raw: string,
    assistantMessage: Message,
    storyCharacters: Character[],
    storyBackgrounds: Background[],
    storyImages: CharacterImage[],
    storySounds: Sound[],
    userName: string,
    speed: Exclude<ResponseSpeed, 'instant'>,
    initialManualAdvance: boolean
  ) {
    const graphemes = splitGraphemes(raw)
    let visualMode = activeStory.value?.visualMode === true
    let charactersPerSecond = responseCharactersPerSecond(
      speed,
      visualMode
    )
    let startedAt = performance.now()
    let startCount = 0
    let visibleCount = 0
    let manualAdvancePreference = initialManualAdvance
    let manualAdvance = visualMode && manualAdvancePreference
    const soundsStore = useSoundsStore()
    const playedSounds = new Set<string>()
    const pauseReasons = new Set<'manual' | 'navigation'>(
      visualMode && visualRevealNavigationPaused.value ? ['navigation'] : []
    )

    replaceDraft(assistantMessage)

    return new Promise<boolean>((resolve) => {
      finishAnimation = resolve

      const clearRevealControls = () => {
        completeRevealLine = null
        setRevealNavigationPaused = null
        setRevealManualAdvance = null
        setRevealVisualMode = null
        startNextRevealLine = null
        visualRevealWaitingForAdvance.value = false
      }

      const finishReveal = () => {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame)
        animationFrame = null
        finishAnimation = null
        animationDraft = null
        clearRevealControls()
        resolve(true)
      }

      const renderVisible = () => {
        const visibleRaw = graphemes.slice(0, visibleCount).join('')
        const parseableRaw = visualMode
          ? hideIncompleteVisualDirectivePrefix(
              visibleRaw,
              raw,
              storyCharacters,
              userName
            )
          : visibleRaw
        const segments = parseSegments(
          parseableRaw,
          storyCharacters,
          storyBackgrounds,
          userName,
          storyImages,
          assistantMessage.id,
          storySounds
        )
        playNewSounds(segments, playedSounds, soundsStore, !visualMode)
        replaceDraft({
          ...assistantMessage,
          raw: visibleRaw,
          segments
        })
      }

      const applyVisibleCount = (nextCount: number) => {
        if (nextCount <= visibleCount) return
        visibleCount = Math.min(nextCount, graphemes.length)
        renderVisible()
      }

      const visibleTextSignature = () => JSON.stringify(
        (animationDraft?.segments ?? [])
          .filter((segment) => segment.type !== 'background' && segment.type !== 'sound')
          .map((segment) => [segment.type, segment.characterId, segment.text])
      )

      const revealNextVisibleStart = () => {
        const previousSignature = visibleTextSignature()
        while (
          visibleCount < graphemes.length &&
          visibleTextSignature() === previousSignature
        ) {
          applyVisibleCount(visibleCount + 1)
        }
      }

      const requestRevealFrame = () => {
        if (animationFrame !== null || pauseReasons.size || visibleCount >= graphemes.length) {
          return false
        }
        startCount = visibleCount
        startedAt = performance.now()
        animationFrame = requestAnimationFrame(revealFrame)
        return true
      }

      const pauseAtManualBoundary = (lineText: string) => {
        if (!manualAdvance || isHiddenVisualRevealLine(lineText)) return false
        pauseReasons.add('manual')
        visualRevealWaitingForAdvance.value = true
        return true
      }

      completeRevealLine = () => {
        if (visibleCount >= graphemes.length || pauseReasons.has('navigation')) return false
        const line = currentRevealLine(graphemes, visibleCount)
        if (line.end <= visibleCount) return false
        if (animationFrame !== null) cancelAnimationFrame(animationFrame)
        animationFrame = null
        applyVisibleCount(line.end)
        if (visibleCount >= graphemes.length) {
          finishReveal()
        } else if (!pauseAtManualBoundary(line.text)) {
          requestRevealFrame()
        }
        return true
      }

      setRevealNavigationPaused = (paused) => {
        visualRevealNavigationPaused.value = paused
        if (paused) {
          pauseReasons.add('navigation')
          if (animationFrame !== null) cancelAnimationFrame(animationFrame)
          animationFrame = null
        } else {
          pauseReasons.delete('navigation')
          requestRevealFrame()
        }
        return true
      }

      setRevealManualAdvance = (enabled) => {
        manualAdvancePreference = enabled
        manualAdvance = visualMode && enabled
        if (!manualAdvance) {
          pauseReasons.delete('manual')
          visualRevealWaitingForAdvance.value = false
          requestRevealFrame()
        }
        return true
      }

      setRevealVisualMode = (enabled) => {
        if (visualMode === enabled) return
        visualMode = enabled
        charactersPerSecond = responseCharactersPerSecond(speed, visualMode)
        manualAdvance = visualMode && manualAdvancePreference
        if (!visualMode) {
          pauseReasons.delete('manual')
          pauseReasons.delete('navigation')
          visualRevealWaitingForAdvance.value = false
          visualRevealNavigationPaused.value = false
        }
        renderVisible()
        if (animationFrame !== null) cancelAnimationFrame(animationFrame)
        animationFrame = null
        requestRevealFrame()
      }

      startNextRevealLine = () => {
        if (!pauseReasons.has('manual') || pauseReasons.has('navigation')) return false
        pauseReasons.delete('manual')
        visualRevealWaitingForAdvance.value = false
        revealNextVisibleStart()
        if (visibleCount >= graphemes.length) finishReveal()
        else requestRevealFrame()
        return true
      }

      function revealFrame(now: number) {
        animationFrame = null
        const line = currentRevealLine(graphemes, visibleCount)
        const targetCount = Math.min(
          graphemes.length,
          line.end,
          Math.max(
            startCount + 1,
            startCount + Math.floor(((now - startedAt) * charactersPerSecond) / 1000) + 1
          )
        )

        applyVisibleCount(targetCount)

        if (visibleCount >= graphemes.length) {
          finishReveal()
          return
        }

        if (visibleCount >= line.end) {
          if (pauseAtManualBoundary(line.text)) return
          startCount = visibleCount
          startedAt = now
        }
        animationFrame = requestAnimationFrame(revealFrame)
      }

      if (visualMode && !pauseReasons.has('navigation')) revealNextVisibleStart()
      if (visibleCount >= graphemes.length) finishReveal()
      else requestRevealFrame()
    })
  }

  async function generate(
    generationMode: GenerationMode = 'normal',
    options: {
      consumePendingImageInstructions?: boolean
      pendingUserMessage?: Message
      onUserMessageStored?: () => void | Promise<void>
      allowCompactionBlocks?: boolean
    } = {}
  ) {
    if (!activeStory.value || activeStory.value.readOnly || generating.value) return
    let story = activeStory.value
    const scope = getActiveDataScope()
    const generationLifecycle = imageGenerationLifecycle
    const settingsStore = useSettingsStore()
    const charactersStore = useCharactersStore()
    const backgroundsStore = useBackgroundsStore()
    const soundsStore = useSoundsStore()
    const previousFeedback = generationFeedback.value
    const attempt: StoryGenerationAttempt = {
      mode: generationMode,
      consumePendingImageInstructions: options.consumePendingImageInstructions === true,
      historyMessageIds: messages.value.filter((message) => !message.swarmError).map((message) => message.id)
    }
    error.value = null
    transientGenerationFeedback.value = null
    canCompactInBlocks.value = false
    blockRetry = null
    blockPendingText = null
    imageGenerationError.value = null
    generating.value = true
    retryingEmptyResponse.value = false
    generationModeInProgress = generationMode
    const requestController = new AbortController()
    controller = requestController
    const generationStillActive = () =>
      !requestController.signal.aborted &&
      generationLifecycle === imageGenerationLifecycle &&
      scope === getActiveDataScope() &&
      activeStory.value?.id === story.id
    const assistantMessage: Message = {
      id: newId(),
      storyId: story.id,
      role: 'assistant',
      raw: '',
      segments: [],
      generationMode,
      createdAt: Date.now()
    }
    const requestMessageId = options.pendingUserMessage?.id ?? [...messages.value]
      .reverse()
      .find((message) => message.role === 'user')?.id
    let debugRequest: LlmDebugRequest | null = null
    let visibleRaw: string
    let pendingVariantJobs: CharacterImageJob[] = []
    let imageCharacters: Character[] = []
    let imageProgress: ImageGenerationProgress | null = null
    let imageBatchWarnings: string[] = []
    let responseTraceStored = false
    let preparingContext = true

    const persistGeneratedImageCatalog = async (
      _image: StoredImage,
      _job: CharacterImageJob,
      signal: AbortSignal
    ) => {
      if (scope !== getActiveDataScope() || activeStory.value?.id !== story.id) return
      await persistImageCatalogSnapshot(
        story,
        buildStoryImageCatalog(story.characterIds, charactersStore.characters, charactersStore.images),
        scope,
        signal
      )
    }

    try {
      if (previousFeedback?.traceId) {
        const previousTrace = debugTraces.value.find((trace) => trace.id === previousFeedback.traceId)
        if (previousTrace) {
          await persistDebugTrace({
            ...previousTrace,
            request: {
              ...previousTrace.request,
              generation: { ...(previousTrace.request.generation ?? attempt), dismissed: true }
            }
          }, scope)
        }
      }
      await Promise.all([
        settingsStore.load(),
        charactersStore.load(),
        backgroundsStore.load(),
        soundsStore.load()
      ])
      if (!generationStillActive()) return
      const settings = settingsStore.settings
      const model = settingsStore.activeModel
      const temperature = settingsStore.activeTemperature
      const maxTokens = settingsStore.activeMaxTokens
      const historyBudget = settingsStore.activeHistoryBudget
      let contextUsage: ContextUsage | undefined
      const mock = settings.mockMode
      const useChromeLlm = settingsStore.activeUseChromeLlm
      if (!mock && !useChromeLlm && !model) {
        throw new Error('Configura primero el modelo en Ajustes.')
      }

      const storyCharacters = storyCharactersWithCustomNames(story, charactersStore.characters)
      const privacy = usePrivacyStore()
      const referencedBackgroundIds = new Set<string>(
        messages.value.flatMap((message) =>
          message.segments.flatMap((segment) => segment.backgroundId ? [segment.backgroundId] : [])
        )
      )
      if (story.initialBackgroundId) referencedBackgroundIds.add(story.initialBackgroundId)
      const matchingBackgrounds = backgroundsStore.backgrounds.filter((background) =>
        matchesBackgroundStyle(background, story.backgroundStyle) &&
        (!background.archived || referencedBackgroundIds.has(background.id))
      )
      const storyBackgrounds = privacy.isDemo
        ? matchingBackgrounds.filter(
            (background) =>
              background.visibleInDemo || referencedBackgroundIds.has(background.id)
          )
        : matchingBackgrounds
      const pendingForRequest = options.consumePendingImageInstructions
        ? validPendingImageInstructions(story, charactersStore.images)
        : []
      if (
        options.consumePendingImageInstructions &&
        pendingForRequest.length !== (story.pendingImageInstructions ?? []).length
      ) {
        await persistStoryState({
          ...story,
          pendingImageInstructions: pendingForRequest,
          updatedAt: Date.now()
        })
      }
      const storySounds = soundsStore.sounds.filter(
        (sound) =>
          (!privacy.isDemo && !sound.characterId && !sound.backgroundId) ||
          Boolean(
            sound.characterId &&
            story.characterIds.includes(sound.characterId) &&
            storyCharacters.some((character) => character.id === sound.characterId)
          ) ||
          Boolean(
            sound.backgroundId &&
            storyBackgrounds.some((background) => background.id === sound.backgroundId)
          )
      )
      const currentImageCatalog = buildStoryImageCatalog(
        story.characterIds,
        charactersStore.characters,
        charactersStore.images
      )
      const imageCatalogChange = story.imageCatalogSnapshot
        ? compareStoryImageCatalogs(story.imageCatalogSnapshot, currentImageCatalog)
        : null
      if (!story.imageCatalogSnapshot) {
        await persistImageCatalogSnapshot(story, currentImageCatalog, scope)
      }

      imageCharacters = storyCharacters

      const requestMessages = options.pendingUserMessage
        ? [...messages.value, options.pendingUserMessage]
        : messages.value
      const chatOptions: Parameters<typeof buildChatMessages>[0] = {
        presetContent: settingsStore.activeNarrativePrompt,
        story: activeStory.value ?? story,
        characters: storyCharacters,
        images: charactersStore.images,
        backgrounds: storyBackgrounds,
        sounds: storySounds,
        messages: requestMessages,
        historyBudget: 0,
        userName: settingsStore.activeUserName,
        protagonistPreferences: resolveProtagonistPreferences(
          settingsStore.activeProtagonistPreferences,
          story.protagonistPreferences ?? '',
          story.protagonistPreferencesMode ?? 'append'
        ),
        generationMode,
        imageCatalogChange: imageCatalogChange ? formatStoryImageCatalogChange(imageCatalogChange) : null,
        pendingImageInstructions: pendingForRequest
      }
      if (!mock) {
        if (!useChromeLlm) {
          waitingForResponse.value = true
          await useLlmModelPreloadStore().waitForStory(
            story.id, scope, settingsStore.activeBaseUrl, model, requestController.signal
          )
          waitingForResponse.value = false
          if (!generationStillActive()) return
        }
        const historyMessages = messages.value.filter((message) => !message.swarmError)
        // Los mensajes de usuario aún sin respuesta deben llegar intactos al narrador.
        const lastAssistantIndex = historyMessages.findLastIndex((message) => message.role === 'assistant')
        const compactableMessages = options.pendingUserMessage
          ? historyMessages
          : historyMessages.slice(0, lastAssistantIndex + 1)
        story = await compactHistoryIfNeeded({
          chatOptions,
          historyMessages: compactableMessages,
          historyBudget,
          tokenBudget: settingsStore.activeContextTokenBudget,
          allowBlocks: options.allowCompactionBlocks === true,
          onUsage: usage => { contextUsage = usage },
          compactionPrompt: settingsStore.effectiveCompactionPrompt,
          model,
          temperature,
          maxTokens,
          useChromeLlm,
          signal: requestController.signal,
          scope,
          isActive: generationStillActive
        })
        if (!generationStillActive()) return
        chatOptions.story = story
      }
      if (options.pendingUserMessage) {
        await persist(options.pendingUserMessage)
        attempt.historyMessageIds.push(options.pendingUserMessage.id)
        if (!generationStillActive()) return
        await options.onUserMessageStored?.()
        if (!generationStillActive()) return
      }
      preparingContext = false

      let raw = ''
      let finishReason: string | null = null

      if (mock) {
        raw = buildMockResponse(
          storyCharacters,
          charactersStore.images,
          storyBackgrounds,
          storySounds,
          story.initialBackgroundId ?? null,
          generationMode,
          settingsStore.activeUserName,
          pendingForRequest
        )
      } else {
        const payload = buildChatMessages(chatOptions)

        debugRequest = {
          provider: useChromeLlm ? 'chrome' : 'lmstudio',
          purpose: 'chat',
          contextUsage,
          generation: attempt,
          model: contextUsage?.model ?? (useChromeLlm ? 'chrome-prompt-api' : model),
          messages: payload,
          temperature,
          max_tokens: maxTokens,
          stream: false
        }

        waitingForResponse.value = true

        for (let responseAttempt = 0; responseAttempt < 2; responseAttempt += 1) {
          const result = useChromeLlm
            ? await fetchChromeLlmChat({
                messages: payload,
                operation: 'story.chat',
                contextLimit: contextUsage?.unit === 'tokens' ? contextUsage.effectiveLimit : undefined,
                signal: requestController.signal
              })
            : await fetchLlmChat({
                model: contextUsage?.model ?? model,
                messages: payload,
                operation: 'story.chat',
                temperature,
                maxTokens,
                signal: requestController.signal
              })
          if (!generationStillActive()) return
          raw = result.content
          finishReason = result.finishReason
          const responseIsEmpty = !parseStoryImageRequests(
            raw,
            storyCharacters,
            story.autoGenerateImages === true
          ).visibleRaw.trim()
          if (!responseIsEmpty || responseAttempt === 1) break

          // El primer resultado vacío no crea imágenes ni consume instrucciones pendientes.
          const stored = await persistDebugTrace({
            id: newId(),
            storyId: story.id,
            requestMessageId,
            status: 'success',
            request: {
              ...debugRequest,
              generation: { ...attempt, dismissed: true, automaticallyRetried: true }
            },
            response: { content: raw, finishReason },
            createdAt: Date.now()
          }, scope)
          if (!stored) error.value = 'La respuesta llegó, pero no se pudo guardar su traza de debug.'
          if (!generationStillActive()) return
          retryingEmptyResponse.value = true
        }
        waitingForResponse.value = false
        retryingEmptyResponse.value = false

        if (!generationStillActive()) return

        const snapshotStored = await persistImageCatalogSnapshot(
          story,
          currentImageCatalog,
          scope,
          requestController.signal
        )
        if (!snapshotStored) {
          error.value = 'La respuesta llegó, pero no se pudo actualizar el catálogo de imágenes.'
        }

      }

      if (!generationStillActive()) return
      const parsedImageResponse = parseStoryImageRequests(
        raw,
        storyCharacters,
        story.autoGenerateImages === true
      )
      visibleRaw = parsedImageResponse.visibleRaw
      imageBatchWarnings = [...parsedImageResponse.warnings]
      if (debugRequest) {
        const stored = await persistDebugTrace({
          id: newId(),
          storyId: story.id,
          requestMessageId,
          responseMessageId: visibleRaw.trim() ? assistantMessage.id : undefined,
          status: 'success',
          request: debugRequest,
          response: { content: raw, finishReason },
          createdAt: Date.now()
        }, scope)
        responseTraceStored = stored
        if (!stored) error.value = 'La respuesta llegó, pero no se pudo guardar su traza de debug.'
      }
      if (story.autoGenerateImages === true && parsedImageResponse.requests.length) {
        if (!settings.swarmBaseUrl.trim()) {
          imageBatchWarnings.push('No se pueden crear imágenes: configura SwarmUI en Ajustes.')
        } else {
          const configuredCharacters = await Promise.all(parsedImageResponse.requests.map(async (request) => {
            try {
              const stored = await getCharacter(request.characterId, scope, requestController.signal)
              const character = storyCharacters.find((candidate) => candidate.id === request.characterId)
              if (stored && character) return { ...stored, name: character.name, color: character.color }
              imageBatchWarnings.push(`Personaje no disponible: ${request.characterName}.`)
            } catch (caught) {
              if ((caught as Error).name === 'AbortError') throw caught
              imageBatchWarnings.push(`No se pudo cargar la configuración de imágenes de ${request.characterName}.`)
            }
            return undefined
          }))
          if (!generationStillActive()) return
          imageCharacters = configuredCharacters.filter((character): character is Character => Boolean(character))
          const eligibleRequests = parsedImageResponse.requests.flatMap((request) => {
            const character = imageCharacters.find((candidate) => candidate.id === request.characterId)
            if (!character) return []
            if (!character.imageGenerationPreset?.trim() && !character.imageGenerationModel?.trim()) {
              imageBatchWarnings.push(`No se creó la imagen de ${character.name}: configura un preset o modelo de SwarmUI.`)
              return []
            }
            return [request]
          })
          if (eligibleRequests.length) {
            const created = createStoryImageJobs(eligibleRequests, imageCharacters)
            const firstJobs = created.jobs.filter((job) => job.generation.variationSeed === undefined)
            pendingVariantJobs = created.jobs.filter((job) => job.generation.variationSeed !== undefined)
            imageProgress = { completed: 0, total: created.total }
            const firstResult = await enqueueImageJobs({
              storyId: story.id,
              scope,
              jobs: firstJobs,
              priority: 0,
              charactersStore,
              characters: imageCharacters,
              progress: imageProgress,
              onSaved: persistGeneratedImageCatalog
            })
            if (firstResult.error) imageBatchWarnings.push(firstResult.error.message)
            if (firstResult.canceled) imageBatchWarnings.push('Generación de imágenes cancelada; se detuvieron las pendientes.')
            if (!generationStillActive()) return
            await persistImageCatalogSnapshot(
              story,
              buildStoryImageCatalog(story.characterIds, charactersStore.characters, charactersStore.images),
              scope,
              requestController.signal
            )
          }
        }
      }
      imageGenerationError.value = imageBatchWarnings.length
        ? [...new Set(imageBatchWarnings)].join(' ')
        : null

      if (visibleRaw.trim()) {
        if (!generationStillActive()) return
        const segments = parseSegments(
          visibleRaw,
          storyCharacters,
          storyBackgrounds,
          settingsStore.activeUserName,
          charactersStore.images,
          assistantMessage.id,
          storySounds
        )
        const completedMessage: Message = {
          ...assistantMessage,
          raw: visibleRaw,
          segments
        }
        if (settings.responseSpeed !== 'instant') {
          pendingAssistantMessage.value = completedMessage
          const completed = await revealAssistantResponse(
            visibleRaw,
            assistantMessage,
            storyCharacters,
            storyBackgrounds,
            charactersStore.images,
            storySounds,
            settingsStore.activeUserName,
            settings.responseSpeed,
            settings.visualNovelManualAdvance
          )
          if (!completed) return
        }
        if (settings.responseSpeed === 'instant' && !activeStory.value?.visualMode) {
          playNewSounds(segments, new Set<string>(), soundsStore)
        }
        await persist(completedMessage)
        pendingAssistantMessage.value = null
        if (!generationStillActive()) {
          await dbDeleteMessage(assistantMessage.id)
          messages.value = messages.value.filter((message) => message.id !== assistantMessage.id)
          return
        }
        if (pendingForRequest.length) await consumePendingImageInstructions(pendingForRequest)
        else await touchStory()
        if (!generationStillActive()) {
          await dbDeleteMessage(assistantMessage.id)
          messages.value = messages.value.filter((message) => message.id !== assistantMessage.id)
          return
        }
      }
      if (pendingVariantJobs.length && imageProgress && !imageProgress.error && !imageProgress.canceled) {
        const variantJobs = pendingVariantJobs
        pendingVariantJobs = []
        void enqueueImageJobs({
          storyId: story.id,
          scope,
          jobs: variantJobs,
          priority: 1,
          charactersStore,
          characters: imageCharacters,
          progress: imageProgress,
          onSaved: persistGeneratedImageCatalog
        }).then((result) => {
          if (!generationStillActive()) return
          const warnings = [
            ...(imageBatchWarnings.length ? imageBatchWarnings : []),
            ...(result.error ? [result.error.message] : []),
            ...(result.canceled ? ['Generación de imágenes cancelada; se detuvieron las pendientes.'] : [])
          ]
          imageGenerationError.value = warnings.length ? [...new Set(warnings)].join(' ') : null
        })
      }
      if (finishReason === 'length' && visibleRaw.trim()) {
        error.value = 'La respuesta alcanzó el máximo de tokens. Se ha conservado el contenido parcial.'
      } else if (!visibleRaw.trim() && !responseTraceStored && !imageBatchWarnings.length) {
        const message = finishReason === 'length'
          ? 'El modelo alcanzó el máximo de tokens antes de devolver contenido visible.'
          : 'El modelo no devolvió contenido visible.'
        error.value = message
        transientGenerationFeedback.value = { message, warning: false, retry: attempt }
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError' && generationStillActive()) {
        const callError = caught as LlmCallError
        const message = callError.message || 'Fallo al generar la respuesta'
        if (preparingContext) {
          if (caught instanceof CompactionCapacityError) {
            canCompactInBlocks.value = true
            blockPendingText = options.pendingUserMessage?.raw ?? null
            const retryStoryId = story.id
            const retryScope = scope
            const retryHistoryIds = messages.value.map(message => message.id).join(',')
            blockRetry = async () => {
              if (activeStory.value?.id !== retryStoryId || getActiveDataScope() !== retryScope) return
              if (messages.value.map(message => message.id).join(',') !== retryHistoryIds) {
                error.value = 'El historial ha cambiado. Vuelve a solicitar la respuesta antes de compactar por bloques.'
                canCompactInBlocks.value = false
                return
              }
              await generate(generationMode, { ...options, allowCompactionBlocks: true })
            }
          }
          error.value = message
          transientGenerationFeedback.value = {
            message: storyGenerationErrorMessage(message, callError.status),
            warning: false,
            retry: options.pendingUserMessage ? undefined : attempt
          }
          return
        }
        const responseMessageId = messages.value.some((item) => item.id === assistantMessage.id)
          ? assistantMessage.id
          : undefined
        const stored = await persistDebugTrace({
          id: newId(),
          storyId: story.id,
          requestMessageId,
          responseMessageId,
          status: 'error',
          request: debugRequest ?? {
            provider: settingsStore.activeUseChromeLlm ? 'chrome' : 'lmstudio',
            purpose: 'chat',
            generation: attempt,
            model: settingsStore.activeModel,
            messages: [],
            temperature: settingsStore.activeTemperature,
            max_tokens: settingsStore.activeMaxTokens,
            stream: false
          },
          response: { error: message, status: callError.status, detail: callError.detail },
          createdAt: Date.now()
        }, scope)
        if (!stored && generationStillActive()) {
          error.value = message
          transientGenerationFeedback.value = {
            message: storyGenerationErrorMessage(message, callError.status),
            warning: false,
            retry: responseMessageId ? undefined : attempt
          }
        }
      }
    } finally {
      waitingForResponse.value = false
      if (pendingAssistantMessage.value?.id === assistantMessage.id) {
        pendingAssistantMessage.value = null
      }
      if (generationModeInProgress === generationMode) generationModeInProgress = null
      if (controller === requestController) {
        retryingEmptyResponse.value = false
        generating.value = false
        controller = null
      }
    }
  }

  async function retryFailedGeneration() {
    const attempt = generationFeedback.value?.retry
    if (!attempt || generating.value || activeStory.value?.readOnly) return
    await generate(attempt.mode, {
      consumePendingImageInstructions: attempt.consumePendingImageInstructions
    })
  }

  async function compactInBlocks(pendingText: string) {
    if (!canCompactInBlocks.value || generating.value || activeStory.value?.readOnly) return
    if (blockPendingText !== null && pendingText.trim() !== blockPendingText) {
      error.value = 'El borrador ha cambiado. Pulsa Enviar para preparar la nueva intervención.'
      transientGenerationFeedback.value = { message: error.value, warning: false }
      canCompactInBlocks.value = false
      return
    }
    await blockRetry?.()
  }

  async function send(text: string, onUserMessageStored?: () => void | Promise<void>) {
    if (!text.trim() || generating.value) return
    if (!activeStory.value || activeStory.value.readOnly) return
    await generate('normal', {
      consumePendingImageInstructions: true,
      pendingUserMessage: {
        id: newId(), storyId: activeStory.value.id, role: 'user',
        raw: text.trim(), segments: [], createdAt: Date.now()
      },
      onUserMessageStored
    })
  }

  async function regenerateFrom(id: string) {
    if (generating.value) return
    const index = messages.value.findIndex((message) => message.id === id)
    if (index < 0 || messages.value[index]?.role !== 'assistant' || messages.value[index]?.swarmError) return
    const generationMode = messages.value[index]?.generationMode ?? 'normal'
    const ids = messages.value.slice(index).map((message) => message.id)
    await invalidateContextSummaryFromIndex(index)
    await dbDeleteMessages(ids)
    messages.value = messages.value.slice(0, index)
    removeLocalTracesForMessages(ids)
    await touchStory()
    await generate(generationMode)
  }

  async function resendFrom(id: string) {
    if (generating.value) return
    const opening = storyOpenRevision
    await pendingTraceLoad
    if (opening !== storyOpenRevision || generating.value) return
    if (debugLoadError) throw new Error(debugLoadError)
    const index = messages.value.findIndex((message) => message.id === id)
    if (index < 0 || messages.value[index]?.role !== 'user') return
    const ids = messages.value.slice(index + 1).map((message) => message.id)
    const traceIds = debugTraces.value
      .filter((trace) => trace.requestMessageId === id)
      .map((trace) => trace.id)
    await invalidateContextSummaryFromIndex(index + 1)
    await dbDeleteMessages(ids)
    await Promise.all(traceIds.map((traceId) => dbDeleteLlmDebugTrace(traceId)))
    messages.value = messages.value.slice(0, index + 1)
    const traceIdSet = new Set(traceIds)
    debugTraces.value = debugTraces.value.filter((trace) => !traceIdSet.has(trace.id))
    removeLocalTracesForMessages(ids)
    await touchStory()
    await generate('normal')
  }

  return {
    stories,
    loaded,
    activeStory,
    messages,
    debugTraces,
    saveSlots,
    saveSlotsLoading,
    saveSlotsError,
    generating,
    waitingForResponse,
    retryingEmptyResponse,
    compacting,
    canCompactInBlocks,
    compactInBlocks,
    pendingAssistantMessage,
    visualRevealWaitingForAdvance,
    error,
    generationFeedback,
    generatingImages,
    imageGenerationCharacter,
    imageGenerationTags,
    imageGenerationCompleted,
    imageGenerationTotal,
    imageGenerationError,
    load,
    createStory,
    updateStorySettings,
    setVisualMode,
    setArchived,
    setDemoVisibility,
    removeStory,
    copySharedDemoStory,
    openStory,
    cancelStoryAuxiliary,
    createSaveSlot,
    loadSaveSlot,
    removeSaveSlot,
    addUserMessage,
    updateMessage,
    replaceMessageSegmentImage,
    setPendingImageInstruction,
    removePendingImageInstruction,
    removeMessage,
    send,
    generate,
    retryFailedGeneration,
    cancelImageGeneration,
    regenerateFrom,
    resendFrom,
    stop,
    completeCurrentRevealLine,
    pauseVisualReveal,
    resumeVisualReveal,
    setVisualRevealManualAdvance,
    startNextVisualReveal,
    resetForScope
  }
})
