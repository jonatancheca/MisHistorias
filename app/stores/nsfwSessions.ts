import { defineStore } from 'pinia'
import type { NarrativeModelAvailability } from '../../shared/types/nsfw/model.ts'
import type {
  CreateStorySessionInput,
  GenerationProfile,
  NsfwGenerationAttempt,
  NsfwStorySession,
  PlayerInput,
  SessionPlayState
} from '../../shared/types/nsfw/session.ts'

export const useNsfwSessionsStore = defineStore('nsfwSessions', () => {
  const sessions = ref<NsfwStorySession[]>([])
  const archivedSessions = ref<NsfwStorySession[]>([])
  const play = ref<SessionPlayState | null>(null)
  const models = ref<NarrativeModelAvailability[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadSessions() {
    const result = await $fetch<{ sessions: NsfwStorySession[] }>('/api/private/sessions')
    sessions.value = result.sessions
  }

  async function loadArchived() {
    const result = await $fetch<{ sessions: NsfwStorySession[] }>('/api/private/sessions', {
      query: { archived: '1' }
    })
    archivedSessions.value = result.sessions
  }

  async function loadModels() {
    const result = await $fetch<{ models: NarrativeModelAvailability[] }>('/api/private/models')
    models.value = result.models
  }

  async function createSession(input: CreateStorySessionInput) {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ session: NsfwStorySession }>('/api/private/sessions', {
        method: 'POST',
        body: input
      })
      await loadSessions()
      return result.session
    } catch (caught) {
      error.value = (caught as Error).message || 'No se pudo crear la sesión'
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function loadPlay(sessionId: string) {
    loading.value = true
    error.value = null
    try {
      play.value = await $fetch<SessionPlayState>(`/api/private/sessions/${sessionId}`)
      return play.value
    } catch (caught) {
      error.value = (caught as Error).message || 'No se pudo cargar la sesión'
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function generate(sessionId: string, payload: {
    input: PlayerInput
    modelAlias: string
    generationProfile: GenerationProfile
  }) {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ attempt: NsfwGenerationAttempt }>(
        `/api/private/sessions/${sessionId}/generate`,
        { method: 'POST', body: payload }
      )
      await loadPlay(sessionId)
      return result.attempt
    } catch (caught) {
      error.value = (caught as Error).message || 'Falló la generación'
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function accept(sessionId: string, attemptId: string) {
    play.value = await $fetch<SessionPlayState>(
      `/api/private/sessions/${sessionId}/attempts/${attemptId}/accept`,
      { method: 'POST' }
    )
    return play.value
  }

  async function discard(sessionId: string, attemptId: string) {
    await $fetch(`/api/private/sessions/${sessionId}/attempts/${attemptId}/discard`, {
      method: 'POST'
    })
    await loadPlay(sessionId)
  }

  async function retry(sessionId: string, attemptId: string) {
    await $fetch(`/api/private/sessions/${sessionId}/attempts/${attemptId}/retry`, {
      method: 'POST'
    })
    await loadPlay(sessionId)
  }

  async function reroll(
    sessionId: string,
    attemptId: string,
    options: { modelAlias?: string; generationProfile?: GenerationProfile } = {}
  ) {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/private/sessions/${sessionId}/reroll`, {
        method: 'POST',
        body: { attemptId, ...options }
      })
      await loadPlay(sessionId)
    } catch (caught) {
      error.value = (caught as Error).message || 'No se pudo re-lanzar'
      throw caught
    } finally {
      loading.value = false
    }
  }

  async function selectSibling(sessionId: string, attemptId: string) {
    play.value = await $fetch<SessionPlayState>(
      `/api/private/sessions/${sessionId}/attempts/${attemptId}/select`,
      { method: 'POST' }
    )
  }

  async function forkBeat(beatId: string, branchLabel?: string) {
    const result = await $fetch<{ session: NsfwStorySession }>(`/api/private/beats/${beatId}/fork`, {
      method: 'POST',
      body: { branchLabel }
    })
    await loadSessions()
    return result.session
  }

  async function sequel(sessionId: string) {
    const result = await $fetch<{ session: NsfwStorySession }>(
      `/api/private/sessions/${sessionId}/sequel`,
      { method: 'POST' }
    )
    await loadSessions()
    return result.session
  }

  async function finalize(sessionId: string) {
    const result = await $fetch<{ session: NsfwStorySession }>(
      `/api/private/sessions/${sessionId}/finalize`,
      { method: 'POST' }
    )
    if (play.value?.session.id === sessionId) {
      play.value = { ...play.value, session: result.session }
    }
    return result.session
  }

  async function archive(sessionId: string, archived: boolean) {
    await $fetch(`/api/private/sessions/${sessionId}/archive`, {
      method: 'POST',
      body: { archived }
    })
    await Promise.all([loadSessions(), loadArchived()])
  }

  async function addBibleFact(
    sessionId: string,
    fact: { entity: string; text: string; secret?: boolean; knownByProtagonist?: boolean }
  ) {
    const result = await $fetch<{ session: NsfwStorySession }>(
      `/api/private/sessions/${sessionId}/bible`,
      { method: 'PATCH', body: fact }
    )
    await loadPlay(sessionId)
    return result.session
  }

  return {
    sessions,
    archivedSessions,
    play,
    models,
    loading,
    error,
    loadSessions,
    loadArchived,
    loadModels,
    createSession,
    loadPlay,
    generate,
    accept,
    discard,
    retry,
    reroll,
    selectSibling,
    forkBeat,
    sequel,
    finalize,
    archive,
    addBibleFact
  }
})
