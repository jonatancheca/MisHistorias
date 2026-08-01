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
import { mockDeltas } from '~/lib/mockLlm'
import { parseSegments, readSseDeltas } from '~/lib/streamParser'

export const useStoriesStore = defineStore('stories', () => {
  const stories = ref<Story[]>([])
  const loaded = ref(false)

  const activeStory = ref<Story | null>(null)
  const messages = ref<Message[]>([])
  const draft = ref<Message | null>(null)
  const streaming = ref(false)
  const error = ref<string | null>(null)

  let controller: AbortController | null = null

  function resetForScope() {
    stop()
    stories.value = []
    loaded.value = false
    activeStory.value = null
    messages.value = []
    draft.value = null
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
    draft.value = null
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
    streaming.value = false
  }

  async function generate() {
    if (!activeStory.value || streaming.value) return
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
    streaming.value = true
    controller = new AbortController()

    draft.value = {
      id: newId(),
      storyId: story.id,
      role: 'assistant',
      raw: '',
      segments: [],
      createdAt: Date.now()
    }

    try {
      let stream: AsyncIterable<string>

      if (mock) {
        stream = mockDeltas(storyCharacters, charactersStore.images, controller.signal)
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
          signal: controller.signal
        })

        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => '')
          throw new Error(detail || `Error ${response.status} al llamar al modelo`)
        }

        stream = readSseDeltas(response.body)
      }

      let raw = ''
      for await (const delta of stream) {
        raw += delta
        draft.value = {
          ...draft.value!,
          raw,
          segments: parseSegments(raw, storyCharacters)
        }
      }

      if (raw.trim()) {
        await persist({ ...draft.value!, raw, segments: parseSegments(raw, storyCharacters) })
        await touchStory()
      }
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        error.value = (caught as Error).message || 'Fallo al generar la respuesta'
      } else if (draft.value?.raw.trim()) {
        await persist(draft.value)
      }
    } finally {
      draft.value = null
      streaming.value = false
      controller = null
    }
  }

  async function send(text: string) {
    if (!text.trim() || streaming.value) return
    await addUserMessage(text)
    await generate()
  }

  async function regenerateLast() {
    if (streaming.value) return
    const last = messages.value[messages.value.length - 1]
    if (last?.role === 'assistant') await removeMessage(last.id)
    await generate()
  }

  return {
    stories,
    loaded,
    activeStory,
    messages,
    draft,
    streaming,
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
