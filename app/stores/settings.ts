import { defineStore } from 'pinia'
import type { AppSettings } from '#shared/types'
import { readSettings, writeSettings } from '~/lib/db'
import { DEFAULT_USER_COLOR } from '~/lib/colors'

const DEFAULTS: AppSettings = {
  baseUrl: 'http://localhost:1234',
  apiKey: '',
  model: '',
  temperature: 0.8,
  maxTokens: 800,
  historyBudget: 12000,
  activePresetId: null,
  theme: 'light',
  userName: 'Usuario',
  userColor: DEFAULT_USER_COLOR
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS })
  const loaded = ref(false)

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
    const dark = settings.value.theme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }

  async function toggleTheme() {
    await save({ theme: settings.value.theme === 'dark' ? 'light' : 'dark' })
  }

  return { settings, loaded, load, save, toggleTheme, applyTheme }
})
