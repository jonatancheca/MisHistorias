import { defineStore } from 'pinia'
import { setActiveDataScope, type DataScope } from '~/lib/db'

export const usePrivacyStore = defineStore('privacy', () => {
  const isPrivate = ref(false)
  const switching = ref(false)

  async function switchScope(scope: DataScope) {
    const nextPrivate = scope === 'private'
    if (isPrivate.value === nextPrivate || switching.value) return

    switching.value = true
    const stories = useStoriesStore()
    const characters = useCharactersStore()
    const backgrounds = useBackgroundsStore()
    const presets = usePresetsStore()

    try {
      await stories.stop()
      setActiveDataScope(scope)
      isPrivate.value = nextPrivate

      await stories.resetForScope()
      characters.resetForScope()
      backgrounds.resetForScope()
      presets.resetForScope()

      await Promise.all([stories.load(), characters.load(), backgrounds.load(), presets.load()])
      await navigateTo('/')
    } finally {
      switching.value = false
    }
  }

  function activate() {
    return switchScope('private')
  }

  function deactivate() {
    return switchScope('normal')
  }

  return { isPrivate, switching, activate, deactivate }
})
