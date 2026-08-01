import { defineStore } from 'pinia'
import type {
  Background,
  Character,
  Message,
  ProtagonistPreferencesMode,
  ResponseSpeed,
  Story
} from '#shared/types'
import {
  deleteMessage as dbDeleteMessage,
  deleteMessages as dbDeleteMessages,
  deleteStory,
  listMessages,
  listStories,
  newId,
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

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref<Story[]>([])
  const loaded = ref(false)

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
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
    }
  }

  async function openStory(id: string) {
    await load()
    activeStory.value = stories.value.find((story) => story.id === id) ?? null
    messages.value = activeStory.value ? await listMessages(id) : []
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
  }

  function replaceDraft(message: Message) {
    animationDraft = message
    const index = messages.value.findIndex((item) => item.id === message.id)
    if (index >= 0) messages.value[index] = message
    else messages.value.push(message)
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
          const detail = await response.text().catch(() => '')
          throw new Error(detail || `Error ${response.status} al llamar al modelo`)
        }

        const result = (await response.json()) as {
          content?: unknown
          finishReason?: unknown
        }
        raw = typeof result.content === 'string' ? result.content : ''
        finishReason = typeof result.finishReason === 'string' ? result.finishReason : null
        waitingForResponse = false
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
      if (finishReason === 'length') {
        error.value = raw.trim()
          ? 'La respuesta alcanzó el máximo de tokens. Se ha conservado el contenido parcial.'
          : 'El modelo alcanzó el máximo de tokens antes de devolver contenido. Aumenta "Máx. tokens" en Ajustes.'
      } else if (!raw.trim()) {
        error.value = 'El modelo no devolvió contenido visible.'
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        error.value = (caught as Error).message || 'Fallo al generar la respuesta'
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
    await touchStory()
    await generate()
  }

  return {
    stories,
    loaded,
    activeStory,
    messages,
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
