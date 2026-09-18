import { defineStore } from 'pinia'
import { getActiveDataScope, setActiveDataScope, type DataScope } from '~/lib/db'

export type PrivacyMode = 'normal' | 'private' | 'demo'

export const usePrivacyStore = defineStore('privacy', () => {
  const mode = ref<PrivacyMode>('normal')
  const switching = ref(false)
  const isPrivate = computed(() => mode.value !== 'normal')
  const isPrivateMode = computed(() => mode.value === 'private')
  const isDemo = computed(() => mode.value === 'demo')

  watch(
    mode,
    (activeMode) => {
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('private-scope', activeMode === 'private')
        document.documentElement.classList.toggle('demo-scope', activeMode === 'demo')
      }
    },
    { immediate: true }
  )

  function scopeFor(nextMode: PrivacyMode): DataScope {
    return nextMode === 'normal' ? 'normal' : 'private'
  }

  async function switchMode(nextMode: PrivacyMode) {
    if (mode.value === nextMode || switching.value) return

    const router = useRouter()
    const currentPath = router.currentRoute.value.fullPath
    switching.value = true
    const stories = useStoriesStore()
    const characters = useCharactersStore()
    const backgrounds = useBackgroundsStore()
    const sounds = useSoundsStore()

    try {
      await stories.stop()
      const nextScope = scopeFor(nextMode)
      const scopeChanged = getActiveDataScope() !== nextScope
      setActiveDataScope(nextScope)
      mode.value = nextMode

      if (scopeChanged) {
        await stories.resetForScope()
        characters.resetForScope()
        backgrounds.resetForScope()
        sounds.resetForScope()
        useSwarmPromptsStore().resetForScope()

        await Promise.all([
          stories.load(),
          characters.load(),
          backgrounds.load(),
          sounds.load(),
        ])
      }

      if (nextMode === 'demo') {
        const path = router.currentRoute.value.path
        const storyMatch = path.match(/^\/stories\/([^/]+)$/)
        const characterMatch = path.match(/^\/characters\/([^/]+)$/)
        if (storyMatch?.[1] && storyMatch[1] !== 'new') {
          const story = stories.stories.find((item) => item.id === storyMatch[1])
          if (!story?.visibleInDemo) {
            await navigateTo('/')
            return
          }
        }
        if (characterMatch?.[1] && characterMatch[1] !== 'new') {
          const character = characters.byId(characterMatch[1])
          if (!character?.visibleInDemo) {
            await navigateTo('/characters')
            return
          }
        }
      }

      if (router.currentRoute.value.fullPath === currentPath) await navigateTo(currentPath)
    } finally {
      switching.value = false
    }
  }

  function activate() {
    return switchMode('private')
  }

  function activateDemo() {
    return switchMode('demo')
  }

  function toggleDemo() {
    return switchMode(isDemo.value ? 'normal' : 'demo')
  }

  function deactivate() {
    return switchMode('normal')
  }

  return {
    mode,
    isPrivate,
    isPrivateMode,
    isDemo,
    switching,
    activate,
    activateDemo,
    toggleDemo,
    deactivate
  }
})
