export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/private')) return
  if (to.path === '/private/login') return

  const auth = useNsfwAuthStore()
  if (!auth.checked) await auth.refresh()
  if (!auth.isAuthenticated) {
    return navigateTo('/private/login')
  }
})
