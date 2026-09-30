import { getActiveDataScope } from '~/lib/db'
import { fetchLlmModelStatus } from '~/lib/llm'

export function useStoryModelLoad() {
  const settings = useSettingsStore()
  const access = useAccessStore()
  const privacy = usePrivacyStore()
  const stories = useStoriesStore()
  const preload = useLlmModelPreloadStore()
  const status = ref<'unknown' | 'loaded' | 'unloaded'>('unknown')
  const error = ref('')
  const loadFailure = ref('')
  const enabled = computed(() => Boolean(stories.activeStory && !stories.activeStory.readOnly) &&
    !privacy.isDemo && !settings.settings.mockMode && !settings.activeUseChromeLlm &&
    (!access.session.multiUserEnabled || access.session.isAdmin))
  const loading = computed(() => enabled.value && preload.currentAttempt?.status === 'loading')
  const visible = computed(() => enabled.value && (loading.value || status.value !== 'loaded'))
  const errorMessage = computed(() => enabled.value ? loadFailure.value || error.value : '')
  const configuration = computed(() => JSON.stringify([
    enabled.value, stories.activeStory?.id, getActiveDataScope(),
    settings.activeBaseUrl, settings.activeModel
  ]))
  let mounted = false
  let check: AbortController | null = null
  let interval: ReturnType<typeof setInterval> | null = null

  function cancelCheck() {
    check?.abort()
    check = null
  }

  async function refresh() {
    if (!mounted || !enabled.value || document.hidden || loading.value || check) return
    const key = configuration.value
    const controller = new AbortController()
    check = controller
    try {
      const result = await fetchLlmModelStatus(getActiveDataScope(), controller.signal)
      if (check !== controller || configuration.value !== key || loading.value) return
      status.value = result.loaded ? 'loaded' : 'unloaded'
      error.value = ''
      if (result.loaded) loadFailure.value = ''
    } catch (caught) {
      if (check !== controller || configuration.value !== key || controller.signal.aborted) return
      status.value = 'unknown'
      error.value = (caught as Error).message || 'No se pudo comprobar el estado de LM Studio.'
    } finally {
      if (check === controller) check = null
    }
  }

  function syncPolling() {
    if (interval) clearInterval(interval)
    interval = null
    if (!mounted || !enabled.value || document.hidden) {
      cancelCheck()
      return
    }
    void refresh()
    interval = setInterval(() => void refresh(), 30_000)
  }

  async function load() {
    if (!enabled.value || loading.value || stories.generating) return
    cancelCheck()
    error.value = ''
    loadFailure.value = ''
    const key = configuration.value
    const request = preload.start()
    if (stories.activeStory) preload.attachStory(stories.activeStory.id)
    await request
    if (configuration.value !== key) return
    const attempt = preload.currentAttempt
    status.value = attempt?.status === 'loaded' ? 'loaded' : 'unknown'
    if (attempt?.status === 'error') loadFailure.value = attempt.message
  }

  watch(configuration, () => {
    cancelCheck()
    status.value = 'unknown'
    error.value = ''
    loadFailure.value = ''
    syncPolling()
  })
  watch(loading, (value) => {
    if (value) cancelCheck()
    else void refresh()
  })
  onMounted(() => {
    mounted = true
    window.addEventListener('focus', syncPolling)
    document.addEventListener('visibilitychange', syncPolling)
    syncPolling()
  })
  onBeforeUnmount(() => {
    mounted = false
    cancelCheck()
    if (interval) clearInterval(interval)
    window.removeEventListener('focus', syncPolling)
    document.removeEventListener('visibilitychange', syncPolling)
  })
  return { visible, loading, error: errorMessage, load }
}
