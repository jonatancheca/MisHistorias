import { defineStore } from 'pinia'
import type { AppSettings } from '#shared/types'
import { activeDataScope, readSettings, writeSettings } from '~/lib/db'
import { DEFAULT_USER_COLOR } from '~/lib/colors'

const DEFAULTS: AppSettings = {
  baseUrl: 'http://localhost:1234',
  apiKey: '',
  model: '',
  temperature: 0.8,
  maxTokens: 10000,
  historyBudget: 12000,
  activePresetId: null,
  privateActivePresetId: null,
  defaultPresetVersion: 0,
  privateDefaultPresetVersion: 0,
  theme: 'system',
  responseSpeed: 'high',
  mockMode: false,
  userName: 'Protagonista',
  userColor: DEFAULT_USER_COLOR,
  protagonistPreferences: ''
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS })
  const activePresetId = computed(() =>
    activeDataScope.value === 'private'
      ? settings.value.privateActivePresetId
      : settings.value.activePresetId
  )
  const loaded = ref(false)
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

  async function save(patch: Partial<AppSettings>) {
    settings.value = { ...settings.value, ...patch }
    await writeSettings(settings.value)
    if ('theme' in patch) applyTheme()
    return settings.value
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

  return { settings, activePresetId, loaded, load, save, setActivePresetId, toggleTheme, applyTheme }
})
