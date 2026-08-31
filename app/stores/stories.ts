import { defineStore } from 'pinia'
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
  ResponseSpeed,
  Story,
  StorySaveSlot,
  StoryCharacterCustomization,
  StoryPendingImageInstruction
} from '#shared/types'
import {
  deleteMessage as dbDeleteMessage,
  deleteMessages as dbDeleteMessages,
  deleteLlmDebugTrace as dbDeleteLlmDebugTrace,
  deleteStory,
  deleteStorySave as dbDeleteStorySave,
  createStorySave as dbCreateStorySave,
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
  resolveProtagonistPreferences
} from '~/lib/promptBuilder'
import { buildMockResponse } from '~/lib/mockLlm'
import { readSwarmDiagnostic } from '../../shared/utils/swarmError.ts'
import { DEFAULT_PRESET_CONTENT } from '~/lib/defaultPreset'
import { fetchLlmChat, type LlmCallError } from '~/lib/llm'
import { fetchChromeLlmChat } from '~/lib/chromeLlm'
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

function normalizeCharacterCustomizations(
  characterIds: string[],
  characters: Character[],
  customizations: StoryCharacterCustomization[] = []
) {
  const requested = new Map(customizations.map((item) => [item.characterId, item]))
  const available = new Map(characters.map((character) => [character.id, character]))
  return characterIds.flatMap((characterId) => {
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
  sounds: ReturnType<typeof useSoundsStore>
) {
  segments.forEach((segment, index) => {
    if (segment.type !== 'sound' || !segment.soundId) return
    const key = `${index}:${segment.soundId}`
    if (played.has(key)) return
    played.add(key)
    sounds.play(segment.soundId)
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

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
  const debugTraces = ref<LlmDebugTrace[]>([])
  const saveSlots = ref<StorySaveSlot[]>([])
  const generating = ref(false)
  const waitingForResponse = ref(false)
  const compacting = ref(false)
  const pendingAssistantMessage = ref<Message | null>(null)
  const visualRevealWaitingForAdvance = ref(false)
  const visualRevealNavigationPaused = ref(false)
  const error = ref<string | null>(null)
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
    cancelImageGeneration({ abandonResponse: true })
    await stop()
    stories.value = []
    loaded.value = false
    activeStory.value = null
    messages.value = []
    debugTraces.value = []
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
    stories.value = await listStories()
    loaded.value = true
  }

  async function createStory(input: {
    title: string
    premise: string
    visualMode?: boolean
    autoGenerateImages?: boolean
    protagonistPreferences: string
    protagonistPreferencesMode: ProtagonistPreferencesMode
    characterIds: string[]
    characterCustomizations: StoryCharacterCustomization[]
    initialBackgroundId: string | null
  }) {
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const now = Date.now()
    const story: Story = {
      id: newId(),
      title: input.title.trim() || 'Historia sin título',
      premise: input.premise.trim(),
      visualMode: input.visualMode === true,
      autoGenerateImages: input.autoGenerateImages === true,
      protagonistPreferences: input.protagonistPreferences.trim(),
      protagonistPreferencesMode: input.protagonistPreferencesMode,
      characterIds: [...input.characterIds],
      characterCustomizations: normalizeCharacterCustomizations(
        input.characterIds,
        charactersStore.characters,
        input.characterCustomizations
      ),
      initialBackgroundId: input.initialBackgroundId,
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
      activeStory.value = null
      messages.value = []
      debugTraces.value = []
      saveSlots.value = []
    }
  }

  async function openStory(id: string) {
    await load()
    visualRevealNavigationPaused.value = false
    visualRevealWaitingForAdvance.value = false
    activeStory.value = stories.value.find((story) => story.id === id) ?? null
    const [storedMessages, storedTraces, storedSaves] = activeStory.value
      ? await Promise.all([listMessages(id), listLlmDebugTraces(id), listStorySaves(id)])
      : [[], [], []]
    const charactersStore = useCharactersStore()
    await charactersStore.load()
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
    if (changed.length) await Promise.all(changed.map((message) => putMessage(message)))
    messages.value = normalizedMessages
    debugTraces.value = storedTraces
    saveSlots.value = storedSaves
    error.value = null
  }

  async function createSaveSlot(name: string, thumbnailDataUrl: string) {
    if (!activeStory.value) return null
    const save = await dbCreateStorySave(activeStory.value.id, name, thumbnailDataUrl)
    saveSlots.value = [save, ...saveSlots.value]
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
    await dbDeleteStorySave(id)
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
    const updated: Message = {
      ...current,
      raw,
      segments:
        current.role === 'assistant'
          ? parseSegments(
              raw,
              storyCharacters,
              backgrounds.backgrounds,
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

  async function persistDebugTrace(trace: LlmDebugTrace) {
    try {
      await putLlmDebugTrace(trace)
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
    story: Story
    presetContent: string
    storyCharacters: Character[]
    images: CharacterImage[]
    backgrounds: Background[]
    sounds: Sound[]
    historyBudget: number
    userName: string
    protagonistPreferences: string
    model: string
    temperature: number
    maxTokens: number
    mock: boolean
    useChromeLlm: boolean
    signal: AbortSignal
    triggerMessageId: string
  }) {
    if (options.historyBudget <= 0 || options.mock || options.signal.aborted) return
    const story = activeStory.value?.id === options.story.id ? activeStory.value : options.story
    const fullContext = buildChatMessages({
      presetContent: options.presetContent,
      story,
      characters: options.storyCharacters,
      images: options.images,
      backgrounds: options.backgrounds,
      sounds: options.sounds,
      messages: messages.value,
      historyBudget: 0,
      userName: options.userName,
      protagonistPreferences: options.protagonistPreferences,
      generationMode: 'normal'
    })
    const contextSize = fullContext.reduce((total, message) => total + message.content.length, 0)
    const throughIndex = story.contextSummaryThroughMessageId
      ? messages.value.findIndex((message) => message.id === story.contextSummaryThroughMessageId)
      : -1
    if (contextSize <= options.historyBudget || throughIndex >= messages.value.length - 1) return

    const compactionMessages = buildCompactionMessages({
      previousSummary: story.contextSummary,
      throughMessageId: story.contextSummaryThroughMessageId,
      messages: messages.value,
      characters: options.storyCharacters,
      userName: options.userName
    })
    const debugRequest: LlmDebugRequest = {
      provider: options.useChromeLlm ? 'chrome' : 'lmstudio',
      purpose: 'compaction',
      model: options.useChromeLlm ? 'chrome-prompt-api' : options.model,
      messages: compactionMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false
    }
    compacting.value = true

    try {
      const result = options.useChromeLlm
        ? await fetchChromeLlmChat({ messages: compactionMessages, signal: options.signal })
        : await fetchLlmChat({
            model: options.model,
            messages: compactionMessages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            signal: options.signal
          })
      const summary = result.content.trim()
      if (!summary) throw new Error('El modelo no devolvió un resumen visible.')
      await persistStoryState({
        ...story,
        contextSummary: summary,
        contextSummaryThroughMessageId: options.triggerMessageId,
        updatedAt: Date.now()
      })
      const stored = await persistDebugTrace({
        id: newId(),
        storyId: story.id,
        requestMessageId: options.triggerMessageId,
        status: 'success',
        request: debugRequest,
        response: { content: result.content, finishReason: result.finishReason },
        createdAt: Date.now()
      })
      if (!stored) error.value = 'El historial se compactó, pero no se pudo guardar su traza de debug.'
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return
      const callError = caught as LlmCallError
      const message = callError.message || 'No se pudo compactar el historial.'
      await persistDebugTrace({
        id: newId(),
        storyId: story.id,
        requestMessageId: options.triggerMessageId,
        status: 'error',
        request: debugRequest,
        response: {
          error: message,
          status: callError.status,
          detail: callError.detail
        },
        createdAt: Date.now()
      })
      error.value = message
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
    autoGenerateImages: boolean,
    protagonistPreferences: string,
    protagonistPreferencesMode: ProtagonistPreferencesMode,
    characterIds: string[],
    characterCustomizations: StoryCharacterCustomization[]
  ) {
    if (!activeStory.value || !title.trim() || !premise.trim()) return
    const charactersStore = useCharactersStore()
    await charactersStore.load()
    const updated: Story = {
      ...activeStory.value,
      title: title.trim(),
      premise: premise.trim(),
      autoGenerateImages,
      protagonistPreferences: protagonistPreferences.trim(),
      protagonistPreferencesMode,
      characterIds: [...characterIds],
      characterCustomizations: normalizeCharacterCustomizations(
        characterIds,
        charactersStore.characters,
        characterCustomizations
      ),
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
  }

  function cancelAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    animationFrame = null
    completeRevealLine = null
    setRevealNavigationPaused = null
    setRevealManualAdvance = null
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
    if (options.preserveAutoResponse && generationModeInProgress === 'auto') return

    const wasWaiting = waitingForResponse.value
    const wasCompacting = compacting.value
    const draft = animationDraft
    const wasAnimating = finishAnimation !== null
    if (!wasWaiting && !wasAnimating && !wasCompacting) return

    if (wasWaiting || wasCompacting) controller?.abort()
    controller = null
    waitingForResponse.value = false
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
    const visualMode = activeStory.value?.visualMode === true
    const charactersPerSecond = responseCharactersPerSecond(
      speed,
      visualMode
    )
    let startedAt = performance.now()
    let startCount = 0
    let visibleCount = 0
    let manualAdvance = visualMode && initialManualAdvance
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

      const applyVisibleCount = (nextCount: number) => {
        if (nextCount <= visibleCount) return
        visibleCount = Math.min(nextCount, graphemes.length)
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
        if (!visualMode) playNewSounds(segments, playedSounds, soundsStore)
        replaceDraft({
          ...assistantMessage,
          raw: visibleRaw,
          segments
        })
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
        manualAdvance = visualMode && enabled
        if (!manualAdvance) {
          pauseReasons.delete('manual')
          visualRevealWaitingForAdvance.value = false
          requestRevealFrame()
        }
        return true
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
    options: { consumePendingImageInstructions?: boolean } = {}
  ) {
    if (!activeStory.value || generating.value) return
    const story = activeStory.value
    const scope = getActiveDataScope()
    const generationLifecycle = imageGenerationLifecycle
    const settingsStore = useSettingsStore()
    const charactersStore = useCharactersStore()
    const backgroundsStore = useBackgroundsStore()
    const soundsStore = useSoundsStore()

    await Promise.all([
      settingsStore.load(),
      charactersStore.load(),
      backgroundsStore.load(),
      soundsStore.load()
    ])

    const settings = settingsStore.settings
    const model = settingsStore.activeModel
    const temperature = settingsStore.activeTemperature
    const maxTokens = settingsStore.activeMaxTokens
    const historyBudget = settingsStore.activeHistoryBudget
    const mock = settings.mockMode
    const useChromeLlm = settingsStore.activeUseChromeLlm
    if (!mock && !useChromeLlm && !model) {
      error.value = 'Configura primero el modelo en Ajustes.'
      return
    }

    const storyCharacters = storyCharactersWithCustomNames(story, charactersStore.characters)
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
        (!sound.characterId && !sound.backgroundId) ||
        Boolean(
          sound.characterId &&
          story.characterIds.includes(sound.characterId) &&
          storyCharacters.some((character) => character.id === sound.characterId)
        ) ||
        Boolean(
          sound.backgroundId &&
          backgroundsStore.backgrounds.some((background) => background.id === sound.backgroundId)
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

    error.value = null
    imageGenerationError.value = null
    generating.value = true
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
    const requestMessageId = [...messages.value]
      .reverse()
      .find((message) => message.role === 'user')?.id
    let debugRequest: LlmDebugRequest | null = null
    let visibleRaw: string
    let pendingVariantJobs: CharacterImageJob[] = []
    let imageCharacters = storyCharacters
    let imageProgress: ImageGenerationProgress | null = null
    let imageBatchWarnings: string[] = []

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
      let raw = ''
      let finishReason: string | null = null

      if (mock) {
        raw = buildMockResponse(
          storyCharacters,
          charactersStore.images,
          backgroundsStore.backgrounds,
          storySounds,
          story.initialBackgroundId ?? null,
          generationMode,
          settingsStore.activeUserName,
          pendingForRequest
        )
      } else {
        const payload = buildChatMessages({
          presetContent: DEFAULT_PRESET_CONTENT,
          story,
          characters: storyCharacters,
          images: charactersStore.images,
          backgrounds: backgroundsStore.backgrounds,
          sounds: storySounds,
          messages: messages.value,
          historyBudget,
          userName: settingsStore.activeUserName,
          protagonistPreferences: resolveProtagonistPreferences(
            settingsStore.activeProtagonistPreferences,
            story.protagonistPreferences ?? '',
            story.protagonistPreferencesMode ?? 'append'
          ),
          generationMode,
          imageCatalogChange: imageCatalogChange
            ? formatStoryImageCatalogChange(imageCatalogChange)
            : null,
          pendingImageInstructions: pendingForRequest
        })

        debugRequest = {
          provider: useChromeLlm ? 'chrome' : 'lmstudio',
          purpose: 'chat',
          model: useChromeLlm ? 'chrome-prompt-api' : model,
          messages: payload,
          temperature,
          max_tokens: maxTokens,
          stream: false
        }

        waitingForResponse.value = true
        const result = useChromeLlm
          ? await fetchChromeLlmChat({
              messages: payload,
              signal: requestController.signal
            })
          : await fetchLlmChat({
              model,
              messages: payload,
              temperature,
              maxTokens,
              signal: requestController.signal
            })
        raw = result.content
        finishReason = result.finishReason
        waitingForResponse.value = false

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
        })
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
          backgroundsStore.backgrounds,
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
            backgroundsStore.backgrounds,
            charactersStore.images,
            storySounds,
            settingsStore.activeUserName,
            settings.responseSpeed,
            settings.visualNovelManualAdvance
          )
          if (!completed) return
        }
        if (settings.responseSpeed === 'instant' && !story.visualMode) {
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
        if (!mock && generationStillActive()) {
          await compactHistoryIfNeeded({
            story: activeStory.value ?? story,
            presetContent: DEFAULT_PRESET_CONTENT,
            storyCharacters,
            images: charactersStore.images,
            backgrounds: backgroundsStore.backgrounds,
            sounds: storySounds,
            historyBudget,
            userName: settingsStore.activeUserName,
            protagonistPreferences: resolveProtagonistPreferences(
              settingsStore.activeProtagonistPreferences,
              story.protagonistPreferences ?? '',
              story.protagonistPreferencesMode ?? 'append'
            ),
            model,
            temperature,
            maxTokens,
            mock,
            useChromeLlm,
            signal: requestController.signal,
            triggerMessageId: completedMessage.id
          })
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
      } else if (!visibleRaw.trim() && !debugRequest && !imageBatchWarnings.length) {
        error.value = 'El modelo no devolvió contenido visible.'
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        const callError = caught as LlmCallError
        const message = callError.message || 'Fallo al generar la respuesta'
        if (debugRequest) {
          const stored = await persistDebugTrace({
            id: newId(),
            storyId: story.id,
            requestMessageId,
            status: 'error',
            request: debugRequest,
            response: {
              error: message,
              status: callError.status,
              detail: callError.detail
            },
            createdAt: Date.now()
          })
          if (!stored) error.value = message
        } else {
          error.value = message
        }
      }
    } finally {
      waitingForResponse.value = false
      if (pendingAssistantMessage.value?.id === assistantMessage.id) {
        pendingAssistantMessage.value = null
      }
      if (generationModeInProgress === generationMode) generationModeInProgress = null
      if (controller === requestController) {
        generating.value = false
        controller = null
      }
    }
  }

  async function send(text: string) {
    if (!text.trim() || generating.value) return
    await addUserMessage(text)
    await generate('normal', { consumePendingImageInstructions: true })
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
    generating,
    waitingForResponse,
    compacting,
    pendingAssistantMessage,
    visualRevealWaitingForAdvance,
    error,
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
    removeStory,
    openStory,
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
