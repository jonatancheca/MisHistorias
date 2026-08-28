import { defineStore } from 'pinia'
import type { PromptPreset } from '#shared/types'
import { deletePreset, listPresets, newId, putPreset } from '~/lib/db'
import {
  DEFAULT_PRESET_CONTENT,
  DEFAULT_PRESET_NAME
} from '~/lib/defaultPreset'

export const usePresetsStore = defineStore('presets', () => {
  const presets = ref<PromptPreset[]>([])
  const loaded = ref(false)
  const hasCurrentDefaultPreset = computed(() => presets.value.some((preset) =>
    preset.name === DEFAULT_PRESET_NAME && preset.content === DEFAULT_PRESET_CONTENT
  ))

  function resetForScope() {
    presets.value = []
    loaded.value = false
  }

  async function load(force = false) {
    if (loaded.value && !force) return
    const settings = useSettingsStore()
    await settings.load()

    let all = await listPresets()
    if (all.length === 0) {
      const now = Date.now()
      const seed: PromptPreset = {
        id: newId(),
        name: DEFAULT_PRESET_NAME,
        content: DEFAULT_PRESET_CONTENT,
        createdAt: now,
        updatedAt: now
      }
      await putPreset(seed)
      all = [seed]
    }

    presets.value = all
    loaded.value = true

    const activeExists = presets.value.some((preset) => preset.id === settings.activePresetId)
    if (!activeExists && presets.value[0]) {
      await settings.setActivePresetId(presets.value[0].id)
    }
  }

  function byId(id: string | null) {
    if (!id) return null
    return presets.value.find((preset) => preset.id === id) ?? null
  }

  async function savePreset(input: { id?: string; name: string; content: string }) {
    const now = Date.now()
    const existing = input.id ? byId(input.id) : null
    const preset: PromptPreset = {
      id: existing?.id ?? newId(),
      name: input.name.trim() || 'Sin nombre',
      content: input.content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    await putPreset(preset)
    const index = presets.value.findIndex((item) => item.id === preset.id)
    if (index >= 0) presets.value[index] = preset
    else presets.value.push(preset)
    return preset
  }

  async function addCurrentDefaultPreset() {
    const preset = await savePreset({ name: DEFAULT_PRESET_NAME, content: DEFAULT_PRESET_CONTENT })
    await useSettingsStore().setActivePresetId(preset.id)
    return preset
  }

  async function removePreset(id: string) {
    await deletePreset(id)
    presets.value = presets.value.filter((preset) => preset.id !== id)
    const settings = useSettingsStore()
    if (settings.activePresetId === id) {
      await settings.setActivePresetId(presets.value[0]?.id ?? null)
    }
  }

  return {
    presets,
    loaded,
    hasCurrentDefaultPreset,
    load,
    byId,
    savePreset,
    addCurrentDefaultPreset,
    removePreset,
    resetForScope
  }
})
