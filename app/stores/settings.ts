import { defineStore } from 'pinia'
import type { AppSettings } from '#shared/types'
import { activeDataScope, readSettings, writeSettings } from '~/lib/db'
import { DEFAULT_USER_COLOR } from '~/lib/colors'

const DEFAULTS: AppSettings = {
  baseUrl: 'http://localhost:1234',
  apiKey: '',
  apiKeyConfigured: false,
  privateLlmSettingsEnabled: false,
  privateBaseUrl: null,
  privateApiKey: '',
  privateApiKeyConfigured: false,
  privateModel: null,
  privateTemperature: null,
  privateMaxTokens: null,
  privateHistoryBudget: null,
  swarmBaseUrl: 'http://localhost:7801',
  swarmAuthToken: '',
  swarmAuthConfigured: false,
  useChromeLlm: false,
  privateUseChromeLlm: null,
  model: '',
  temperature: 0.8,
  maxTokens: 10000,
  historyBudget: 12000,
  activePresetId: null,
  privateActivePresetId: null,
  defaultPresetVersion: 0,
  privateDefaultPresetVersion: 0,
  defaultSoundVersion: 0,
  privateDefaultSoundVersion: 0,
  theme: 'system',
  responseSpeed: 'high',
  visualNovelManualAdvance: false,
  mockMode: false,
  userName: 'Protagonista',
  privateUserName: null,
  userColor: DEFAULT_USER_COLOR,
  protagonistPreferences: '',
  privateProtagonistPreferences: null
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS })
  const activePresetId = computed(() =>
    activeDataScope.value === 'private'
      ? settings.value.privateActivePresetId
      : settings.value.activePresetId
  )
  const activeUseChromeLlm = computed(() =>
    activeDataScope.value === 'private'
      ? (settings.value.privateUseChromeLlm ?? settings.value.useChromeLlm)
      : settings.value.useChromeLlm
  )
  const usePrivateLlmSettings = computed(() =>
    activeDataScope.value === 'private' && settings.value.privateLlmSettingsEnabled
  )
  const activeBaseUrl = computed(() =>
    usePrivateLlmSettings.value
      ? (settings.value.privateBaseUrl ?? settings.value.baseUrl)
      : settings.value.baseUrl
  )
  const activeModel = computed(() =>
    usePrivateLlmSettings.value
      ? (settings.value.privateModel ?? settings.value.model)
      : settings.value.model
  )
  const activeTemperature = computed(() =>
    usePrivateLlmSettings.value
      ? (settings.value.privateTemperature ?? settings.value.temperature)
      : settings.value.temperature
  )
  const activeMaxTokens = computed(() =>
    usePrivateLlmSettings.value
      ? (settings.value.privateMaxTokens ?? settings.value.maxTokens)
      : settings.value.maxTokens
  )
  const activeHistoryBudget = computed(() =>
    usePrivateLlmSettings.value
      ? (settings.value.privateHistoryBudget ?? settings.value.historyBudget)
      : settings.value.historyBudget
  )
  const activeUserName = computed(() => {
    const value =
      activeDataScope.value === 'private'
        ? (settings.value.privateUserName ?? settings.value.userName)
        : settings.value.userName
    return value.trim() || 'Protagonista'
  })
  const activeProtagonistPreferences = computed(() =>
    activeDataScope.value === 'private'
      ? (settings.value.privateProtagonistPreferences ?? settings.value.protagonistPreferences)
      : settings.value.protagonistPreferences
  )
  const loaded = ref(false)
  let saveQueue: Promise<void> = Promise.resolve()
  let systemThemeMedia: MediaQueryList | null = null

  function getSystemThemeMedia() {
    if (systemThemeMedia || typeof window === 'undefined' || !window.matchMedia) return systemThemeMedia
    systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
    if (systemThemeMedia.addEventListener) {
      systemThemeMedia.addEventListener('change', onSystemThemeChange)
    } else {
      systemThemeMedia.addListener?.(onSystemThemeChange)
    }
    return systemThemeMedia
  }

  function onSystemThemeChange() {
    if (settings.value.theme === 'system') applyTheme()
  }

  async function load() {
    if (loaded.value) return
    const stored = await readSettings()
    settings.value = { ...DEFAULTS, ...(stored ?? {}) }
    loaded.value = true
    applyTheme()
  }

  async function persist(patch: Partial<AppSettings>) {
    const saved = await writeSettings(patch)
    settings.value = {
      ...DEFAULTS,
      ...settings.value,
      ...saved,
      apiKey: '',
      privateApiKey: '',
      swarmAuthToken: ''
    }
    if ('theme' in patch) applyTheme()
    return settings.value
  }

  function save(patch: Partial<AppSettings>) {
    const result = saveQueue.then(
      () => persist(patch),
      () => persist(patch)
    )
    saveQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  function applyTheme() {
    if (typeof document === 'undefined') return
    const systemDark = getSystemThemeMedia()?.matches === true
    const dark = settings.value.theme === 'dark' || (settings.value.theme === 'system' && systemDark)
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  async function setActivePresetId(id: string | null) {
    return activeDataScope.value === 'private'
      ? save({ privateActivePresetId: id })
      : save({ activePresetId: id })
  }

  async function toggleTheme() {
    await save({ theme: settings.value.theme === 'dark' ? 'light' : 'dark' })
  }

  return {
    settings,
    activePresetId,
    activeUseChromeLlm,
    activeBaseUrl,
    activeModel,
    activeTemperature,
    activeMaxTokens,
    activeHistoryBudget,
    activeUserName,
    activeProtagonistPreferences,
    loaded,
    load,
    save,
    setActivePresetId,
    toggleTheme,
    applyTheme
  }
})
