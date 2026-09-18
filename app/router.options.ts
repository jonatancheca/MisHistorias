import type { RouterConfig } from '@nuxt/schema'

export default {
  scrollBehavior(to, _from, savedPosition) {
    if (to.path === '/settings' && to.hash) return false
    if (savedPosition) return savedPosition

    if (to.hash && import.meta.client && document.querySelector(to.hash)) {
      return { el: to.hash }
    }

    return { left: 0, top: 0 }
  }
} satisfies RouterConfig
