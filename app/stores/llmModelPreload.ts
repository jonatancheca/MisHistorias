import { defineStore } from 'pinia'
import { getActiveDataScope, type DataScope } from '~/lib/db'
import { preloadLlmModel } from '~/lib/llm'

type PreloadStatus = 'loading' | 'loaded' | 'error'

interface PreloadAttempt {
  key: string
  storyId: string | null
  status: PreloadStatus
  message: string
}

export const useLlmModelPreloadStore = defineStore('llmModelPreload', () => {
  const attempt = ref<PreloadAttempt | null>(null)
  const pending = new Map<string, Promise<void>>()

  function keyFor(scope: DataScope, baseUrl: string, model: string) {
    return JSON.stringify([scope, baseUrl.trim(), model.trim()])
  }

  function activeKey() {
    const settings = useSettingsStore()
    return keyFor(getActiveDataScope(), settings.activeBaseUrl, settings.activeModel)
  }

  const currentAttempt = computed(() =>
    attempt.value?.key === activeKey() ? attempt.value : null
  )

  function start() {
    const settings = useSettingsStore()
    const access = useAccessStore()
    if (settings.settings.mockMode || settings.activeUseChromeLlm ||
        (access.session.multiUserEnabled && !access.session.isAdmin)) {
      attempt.value = null
      return
    }

    const scope = getActiveDataScope()
    const model = settings.activeModel.trim()
    const key = keyFor(scope, settings.activeBaseUrl, model)
    if (!model) {
      attempt.value = {
        key,
        storyId: null,
        status: 'error',
        message: 'Configura primero el modelo en Ajustes para precargarlo.'
      }
      return
    }

    attempt.value = {
      key,
      storyId: null,
      status: 'loading',
      message: 'Cargando modelo de LM Studio…'
    }
    if (pending.has(key)) return

    const request = preloadLlmModel(scope)
      .then((result) => {
        if (attempt.value?.key !== key) return
        attempt.value = {
          ...attempt.value,
          status: 'loaded',
          message: result.status === 'already-loaded'
            ? 'El modelo de LM Studio ya está cargado.'
            : 'Modelo de LM Studio cargado.'
        }
      })
      .catch((caught: unknown) => {
        if (attempt.value?.key !== key) return
        attempt.value = {
          ...attempt.value,
          status: 'error',
          message: (caught as Error).message || 'No se pudo cargar el modelo de LM Studio.'
        }
      })
      .finally(() => {
        pending.delete(key)
      })
    pending.set(key, request)
  }

  function attachStory(storyId: string) {
    if (currentAttempt.value) attempt.value = { ...currentAttempt.value, storyId }
  }

  async function waitForStory(
    storyId: string,
    scope: DataScope,
    baseUrl: string,
    model: string,
    signal: AbortSignal
  ) {
    const key = keyFor(scope, baseUrl, model)
    if (attempt.value?.key !== key || attempt.value.storyId !== storyId) return
    const request = pending.get(key)
    if (!request || signal.aborted) return
    await new Promise<void>((resolve) => {
      const finish = () => {
        signal.removeEventListener('abort', finish)
        resolve()
      }
      signal.addEventListener('abort', finish, { once: true })
      void request.then(finish)
    })
  }

  return { currentAttempt, start, attachStory, waitForStory }
})
