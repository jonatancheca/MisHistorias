import { defineStore } from 'pinia'
import { setActiveDataScope, type DataScope } from '~/lib/db'

export const usePrivacyStore = defineStore('privacy', () => {
  const isPrivate = ref(false)
  const switching = ref(false)

  watch(
    isPrivate,
    (active) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('private-scope', active)
      }
    },
    { immediate: true }
  )

  async function switchScope(scope: DataScope) {
    const nextPrivate = scope === 'private'
    if (isPrivate.value === nextPrivate || switching.value) return

    switching.value = true
    const stories = useStoriesStore()
    const characters = useCharactersStore()
    const backgrounds = useBackgroundsStore()
    const sounds = useSoundsStore()
    const presets = usePresetsStore()

    try {
      await stories.stop()
      setActiveDataScope(scope)
      isPrivate.value = nextPrivate

      await stories.resetForScope()
      characters.resetForScope()
      backgrounds.resetForScope()
      sounds.resetForScope()
      presets.resetForScope()

      await Promise.all([
        stories.load(),
        characters.load(),
        backgrounds.load(),
        sounds.load(),
        presets.load()
      ])
      await navigateTo('/')
    } finally {
      switching.value = false
    }
  }

  async function activate() {
    await navigateTo('/private/login')
  }

  async function deactivate() {
    const auth = useNsfwAuthStore()
    if (auth.isAuthenticated) {
      await auth.logout()
    }
    if (isPrivate.value) {
      await switchScope('normal')
      return
    }
    await navigateTo('/')
  }

  return { isPrivate, switching, activate, deactivate, switchScope }
})
