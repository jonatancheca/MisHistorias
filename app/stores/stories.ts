import { defineStore } from 'pinia'
import type { Message, Story } from '#shared/types'
import {
  deleteMessage as dbDeleteMessage,
  deleteStory,
  listMessages,
  listStories,
  newId,
  putMessage,
  putStory
} from '~/lib/db'
import { buildChatMessages } from '~/lib/promptBuilder'
import { buildMockResponse } from '~/lib/mockLlm'
import { parseSegments } from '~/lib/streamParser'

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref<Story[]>([])
  const loaded = ref(false)

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
  const generating = ref(false)
  const error = ref<string | null>(null)

  let controller: AbortController | null = null

  function resetForScope() {
    stop()
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
    characterIds: string[]
    presetId: string | null
  }) {
    const now = Date.now()
    const story: Story = {
      id: newId(),
      title: input.title.trim() || 'Historia sin título',
      premise: input.premise.trim(),
      characterIds: [...input.characterIds],
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
    const storyCharacters = characters.characters.filter((character) =>
      activeStory.value?.characterIds.includes(character.id)
    )
    const updated: Message = {
      ...current,
      raw,
      segments: current.role === 'assistant' ? parseSegments(raw, storyCharacters) : []
    }
    await persist(updated)
  }

  async function removeMessage(id: string) {
    await dbDeleteMessage(id)
    messages.value = messages.value.filter((message) => message.id !== id)
  }

  function stop() {
    controller?.abort()
    controller = null
    generating.value = false
  }

  async function generate() {
    if (!activeStory.value || generating.value) return
    const story = activeStory.value
    const settingsStore = useSettingsStore()
    const presetsStore = usePresetsStore()
    const charactersStore = useCharactersStore()

    await Promise.all([settingsStore.load(), presetsStore.load(), charactersStore.load()])

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
        raw = buildMockResponse(storyCharacters, charactersStore.images)
      } else {
        const payload = buildChatMessages({
          presetContent: preset!.content,
          story,
          characters: storyCharacters,
          images: charactersStore.images,
          messages: messages.value,
          historyBudget: settings.historyBudget,
          userName: settings.userName?.trim() || 'Usuario'
        })

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
      }

      if (raw.trim()) {
        if (requestController.signal.aborted) return
        await persist({
          ...assistantMessage,
          raw,
          segments: parseSegments(raw, storyCharacters)
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

  async function regenerateLast() {
    if (generating.value) return
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant') await removeMessage(last.id)
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
    removeStory,
    openStory,
    addUserMessage,
    updateMessage,
    removeMessage,
    send,
    generate,
    regenerateLast,
    stop,
    resetForScope
  }
})
