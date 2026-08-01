import { defineStore } from 'pinia'
import type {
  Background,
  Character,
  LlmDebugRequest,
  LlmDebugTrace,
  Message,
  ProtagonistPreferencesMode,
  ResponseSpeed,
  Story
} from '#shared/types'
import {
  deleteMessage as dbDeleteMessage,
  deleteMessages as dbDeleteMessages,
  deleteStory,
  listLlmDebugTraces,
  listMessages,
  listStories,
  newId,
  putLlmDebugTrace,
  putMessage,
  putStory
} from '~/lib/db'
import { buildChatMessages, resolveProtagonistPreferences } from '~/lib/promptBuilder'
import { buildMockResponse } from '~/lib/mockLlm'
import { parseSegments } from '~/lib/streamParser'

const RESPONSE_CHARACTERS_PER_SECOND: Record<Exclude<ResponseSpeed, 'instant'>, number> = {
  slow: 20,
  medium: 50,
  high: 100
}

interface GraphemeSegment {
  segment: string
}

interface LlmCallError extends Error {
  status?: number
  detail?: string
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

async function createLlmCallError(response: Response): Promise<LlmCallError> {
  const raw = await response.text().catch(() => '')
  let message = `Error ${response.status} al llamar al modelo`
  let detail = raw.slice(0, 500)

  try {
    const payload = JSON.parse(raw) as {
      statusMessage?: unknown
      message?: unknown
      data?: unknown
    }
    if (typeof payload.statusMessage === 'string') message = payload.statusMessage
    else if (typeof payload.message === 'string') message = payload.message
    if (typeof payload.data === 'string') detail = payload.data.slice(0, 500)
    else if (payload.data !== undefined) detail = JSON.stringify(payload.data).slice(0, 500)
    else detail = ''
  } catch {
    // El cuerpo no siempre es JSON; se conserva una muestra limitada.
  }

  return Object.assign(new Error(message), {
    status: response.status,
    detail: detail || undefined
  })
}

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref<Story[]>([])
  const loaded = ref(false)

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
  const debugTraces = ref<LlmDebugTrace[]>([])
  const generating = ref(false)
  const error = ref<string | null>(null)

  let controller: AbortController | null = null
  let waitingForResponse = false
  let animationFrame: number | null = null
  let finishAnimation: ((completed: boolean) => void) | null = null
  let animationDraft: Message | null = null

  async function resetForScope() {
    await stop()
    stories.value = []
    loaded.value = false
    activeStory.value = null
    messages.value = []
    debugTraces.value = []
    error.value = null
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    stories.value = await listStories()
    loaded.value = true
  }

  async function createStory(input: {
    title: string
    premise: string
    protagonistPreferences: string
    protagonistPreferencesMode: ProtagonistPreferencesMode
    characterIds: string[]
    initialBackgroundId: string | null
    presetId: string | null
  }) {
    const now = Date.now()
    const story: Story = {
      id: newId(),
      title: input.title.trim() || 'Historia sin título',
      premise: input.premise.trim(),
      protagonistPreferences: input.protagonistPreferences.trim(),
      protagonistPreferencesMode: input.protagonistPreferencesMode,
      characterIds: [...input.characterIds],
      initialBackgroundId: input.initialBackgroundId,
      presetId: input.presetId,
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
    }
  }

  async function openStory(id: string) {
    await load()
    activeStory.value = stories.value.find((story) => story.id === id) ?? null
    const [storedMessages, storedTraces] = activeStory.value
      ? await Promise.all([listMessages(id), listLlmDebugTraces(id)])
      : [[], []]
    messages.value = storedMessages
    debugTraces.value = storedTraces
    error.value = null
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
    if (!current) return
    const characters = useCharactersStore()
    const backgrounds = useBackgroundsStore()
    const storyCharacters = characters.characters.filter((character) =>
      activeStory.value?.characterIds.includes(character.id)
    )
    const updated: Message = {
      ...current,
      raw,
      segments:
        current.role === 'assistant'
          ? parseSegments(raw, storyCharacters, backgrounds.backgrounds)
          : []
    }
    await persist(updated)
  }

  async function removeMessage(id: string) {
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

  function removeLocalTracesForMessages(ids: string[]) {
    const idSet = new Set(ids)
    debugTraces.value = debugTraces.value.filter(
      (trace) =>
        !(trace.responseMessageId && idSet.has(trace.responseMessageId)) &&
        !(
          trace.status === 'error' &&
          trace.requestMessageId &&
          idSet.has(trace.requestMessageId)
        )
    )
  }

  async function updateStoryPreferences(
    protagonistPreferences: string,
    protagonistPreferencesMode: ProtagonistPreferencesMode
  ) {
    if (!activeStory.value) return
    const updated: Story = {
      ...activeStory.value,
      protagonistPreferences: protagonistPreferences.trim(),
      protagonistPreferencesMode,
      updatedAt: Date.now()
    }
    await putStory(updated)
    activeStory.value = updated
    stories.value = stories.value.map((story) => (story.id === updated.id ? updated : story))
  }

  function cancelAnimation() {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame)
    animationFrame = null
    const finish = finishAnimation
    finishAnimation = null
    finish?.(false)
  }

  async function stop() {
    const wasWaiting = waitingForResponse
    const draft = animationDraft
    const wasAnimating = finishAnimation !== null
    if (!wasWaiting && !wasAnimating) return

    if (wasWaiting) controller?.abort()
    controller = null
    waitingForResponse = false
    cancelAnimation()
    animationDraft = null

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
    speed: Exclude<ResponseSpeed, 'instant'>
  ) {
    const graphemes = splitGraphemes(raw)
    const charactersPerSecond = RESPONSE_CHARACTERS_PER_SECOND[speed]
    const startedAt = performance.now()
    let visibleCount = 0

    replaceDraft(assistantMessage)

    return new Promise<boolean>((resolve) => {
      finishAnimation = resolve

      const revealFrame = (now: number) => {
        const targetCount = Math.min(
          graphemes.length,
          Math.max(1, Math.floor(((now - startedAt) * charactersPerSecond) / 1000) + 1)
        )

        if (targetCount > visibleCount) {
          visibleCount = targetCount
          const visibleRaw = graphemes.slice(0, visibleCount).join('')
          replaceDraft({
            ...assistantMessage,
            raw: visibleRaw,
            segments: parseSegments(visibleRaw, storyCharacters, storyBackgrounds)
          })
        }

        if (visibleCount >= graphemes.length) {
          animationFrame = null
          finishAnimation = null
          animationDraft = null
          resolve(true)
          return
        }

        animationFrame = requestAnimationFrame(revealFrame)
      }

      animationFrame = requestAnimationFrame(revealFrame)
    })
  }

  async function generate() {
    if (!activeStory.value || generating.value) return
    const story = activeStory.value
    const settingsStore = useSettingsStore()
    const presetsStore = usePresetsStore()
    const charactersStore = useCharactersStore()
    const backgroundsStore = useBackgroundsStore()

    await Promise.all([
      settingsStore.load(),
      presetsStore.load(),
      charactersStore.load(),
      backgroundsStore.load()
    ])

    const settings = settingsStore.settings
    const mock = settings.mockMode
    if (!mock && !settings.model) {
      error.value = 'Configura primero el modelo en Ajustes.'
      return
    }

    const storyCharacters = charactersStore.characters.filter((character) =>
      story.characterIds.includes(character.id)
    )
    const preset = presetsStore.byId(story.presetId ?? settingsStore.activePresetId)
    if (!mock && !preset) {
      error.value = 'No hay ningún prompt de preparación disponible.'
      return
    }

    error.value = null
    generating.value = true
    const requestController = new AbortController()
    controller = requestController
    const assistantMessage: Message = {
      id: newId(),
      storyId: story.id,
      role: 'assistant',
      raw: '',
      segments: [],
      createdAt: Date.now()
    }
    const requestMessageId = [...messages.value]
      .reverse()
      .find((message) => message.role === 'user')?.id
    let debugRequest: LlmDebugRequest | null = null

    try {
      let raw = ''
      let finishReason: string | null = null

      if (mock) {
        raw = buildMockResponse(
          storyCharacters,
          charactersStore.images,
          backgroundsStore.backgrounds,
          story.initialBackgroundId ?? null
        )
      } else {
        const payload = buildChatMessages({
          presetContent: preset!.content,
          story,
          characters: storyCharacters,
          images: charactersStore.images,
          backgrounds: backgroundsStore.backgrounds,
          messages: messages.value,
          historyBudget: settings.historyBudget,
          userName: settings.userName?.trim() || 'Protagonista',
          protagonistPreferences: resolveProtagonistPreferences(
            settings.protagonistPreferences ?? '',
            story.protagonistPreferences ?? '',
            story.protagonistPreferencesMode ?? 'append'
          )
        })

        debugRequest = {
          model: settings.model,
          messages: payload,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          stream: false
        }

        waitingForResponse = true
        const response = await fetch('/api/llm/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: payload,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
          }),
          signal: requestController.signal
        })

        if (!response.ok) {
          throw await createLlmCallError(response)
        }

        const result = (await response.json()) as {
          content?: unknown
          finishReason?: unknown
        }
        raw = typeof result.content === 'string' ? result.content : ''
        finishReason = typeof result.finishReason === 'string' ? result.finishReason : null
        waitingForResponse = false

        const stored = await persistDebugTrace({
          id: newId(),
          storyId: story.id,
          requestMessageId,
          responseMessageId: raw.trim() ? assistantMessage.id : undefined,
          status: 'success',
          request: debugRequest,
          response: { content: raw, finishReason },
          createdAt: Date.now()
        })
        if (!stored) error.value = 'La respuesta llegó, pero no se pudo guardar su traza de debug.'
      }

      if (raw.trim()) {
        if (requestController.signal.aborted) return
        if (settings.responseSpeed !== 'instant') {
          const completed = await revealAssistantResponse(
            raw,
            assistantMessage,
            storyCharacters,
            backgroundsStore.backgrounds,
            settings.responseSpeed
          )
          if (!completed) return
        }
        await persist({
          ...assistantMessage,
          raw,
          segments: parseSegments(raw, storyCharacters, backgroundsStore.backgrounds)
        })
        if (requestController.signal.aborted) {
          await dbDeleteMessage(assistantMessage.id)
          messages.value = messages.value.filter((message) => message.id !== assistantMessage.id)
          return
        }
        await touchStory()
        if (requestController.signal.aborted) {
          await dbDeleteMessage(assistantMessage.id)
          messages.value = messages.value.filter((message) => message.id !== assistantMessage.id)
          return
        }
      }
      if (finishReason === 'length' && raw.trim()) {
        error.value = 'La respuesta alcanzó el máximo de tokens. Se ha conservado el contenido parcial.'
      } else if (!raw.trim() && !debugRequest) {
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
      waitingForResponse = false
      if (controller === requestController) {
        generating.value = false
        controller = null
      }
    }
  }

  async function send(text: string) {
    if (!text.trim() || generating.value) return
    await addUserMessage(text)
    await generate()
  }

  async function regenerateFrom(id: string) {
    if (generating.value) return
    const index = messages.value.findIndex((message) => message.id === id)
    if (index < 0 || messages.value[index]?.role !== 'assistant') return
    const ids = messages.value.slice(index).map((message) => message.id)
    await dbDeleteMessages(ids)
    messages.value = messages.value.slice(0, index)
    removeLocalTracesForMessages(ids)
    await touchStory()
    await generate()
  }

  return {
    stories,
    loaded,
    activeStory,
    messages,
    debugTraces,
    generating,
    error,
    load,
    createStory,
    updateStoryPreferences,
    removeStory,
    openStory,
    addUserMessage,
    updateMessage,
    removeMessage,
    send,
    generate,
    regenerateFrom,
    stop,
    resetForScope
  }
})
