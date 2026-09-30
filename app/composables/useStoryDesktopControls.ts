export function useStoryDesktopControls() {
  const desktop = ref(false)
  let query: MediaQueryList | null = null

  function sync() {
    desktop.value = query?.matches ?? false
  }

  onMounted(() => {
    query = window.matchMedia('(min-width: 640px) and (hover: hover) and (pointer: fine)')
    sync()
    query.addEventListener('change', sync)
  })

  onBeforeUnmount(() => query?.removeEventListener('change', sync))
  return desktop
}
